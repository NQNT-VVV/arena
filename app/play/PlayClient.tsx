'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { hexOf } from '@/lib/hex';
import { Icon } from '@/components/Icon';
import { AssetPack } from '@/components/AssetPack';
import { Brand } from '@/components/Brand';
import { ClassementGeneral } from '@/components/ClassementGeneral';
import { MonExtrait } from '@/components/MonExtrait';
import { Pads } from '@/components/Pads';
import { DiffusionStage } from '@/components/DiffusionStage';
import { Podium } from '@/components/Podium';
import { OwnFate } from '@/components/Roulette';
import { Chaine, ChaineLue } from '@/components/Chaine';
import { Chrono } from '@/components/Chrono';
import { JoinForm } from '@/components/JoinForm';
import { PhaseRail } from '@/components/PhaseRail';
import { SubmissionBox } from '@/components/SubmissionBox';
import { audioPref } from '@/lib/audioPref';
import { identity } from '@/lib/identity';
import { fetchPodiumIdentity } from '@/lib/podium';
import { humanDuration, humanThreshold, PHASE_LABELS } from '@/lib/format';
import { sfx } from '@/lib/sfx';
import { call } from '@/lib/socket';
import { toast } from '@/lib/toast';
import { MEDIA_LABELS, type BattleState, type PodiumIdentity, type SavedIdentity, type SessionCard } from '@/lib/types';
import { useBattleSocket } from '@/lib/useBattleSocket';
import { usePhaseClock } from '@/lib/usePhaseClock';
import styles from './play.module.css';

export function PlayClient() {
  const params = useSearchParams();
  const code = (params.get('code') || '').toUpperCase();
  /**
   * Le lien decide du role.
   *
   * L'animateur envoie « /s/CODE » a qui vient juger : la page s'ouvre alors du
   * bon cote, sans qu'on ait a expliquer lequel des deux boutons choisir. Le
   * choix reste modifiable tant qu'on n'est pas entre.
   */
  const inviteAsSpectator = params.get('role') === 'spectateur';

  const [card, setCard] = useState<SessionCard | null>(null);
  const [pseudo, setPseudo] = useState('');
  const [joined, setJoined] = useState(false);
  /** Identite courante, pour signer les depots. */
  const [me, setMe] = useState<SavedIdentity | null>(null);
  /**
   * Le son sur ce telephone. Null tant que la personne n'a rien choisi : on
   * applique alors le reglage de la session — l'animateur sait si une
   * enceinte joue deja dans la piece.
   */
  const [audioChoice, setAudioChoice] = useState<boolean | null>(null);
  useEffect(() => { setAudioChoice(audioPref.get('play')); }, []);
  const chooseAudio = (on: boolean) => { audioPref.set('play', on); setAudioChoice(on); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Entree dans la session.
   *
   * Rejouee a chaque connexion. Si le navigateur a garde une identite, la
   * reprise est automatique : c'est ce qui fait qu'un rafraichissement, un
   * passage en veille ou un tunnel de metro ne coutent pas sa place.
   */
  const enter = useCallback(async (socket: Socket, withPseudo?: string, asSpectator = false) => {
    if (!code) return;
    const saved = identity.get(code);
    const name = withPseudo ?? saved?.pseudo;
    if (!name) return;

    const res = await call<{ token: string; participantId: string }>(socket, 'play:join', {
      code,
      pseudo: name,
      participantId: saved?.participantId,
      token: saved?.token,
      // Ignore a la reprise : le serveur retrouve le role choisi a l'entree.
      spectator: asSpectator,
    });

    if (!res.ok) {
      // Une identite refusee est une identite perimee : on l'efface pour que la
      // page repropose le formulaire au lieu de boucler sur le meme refus.
      if (saved) identity.clear(code);
      setError(res.error);
      setJoined(false);
      return;
    }

    const saved2: SavedIdentity = { participantId: res.participantId, token: res.token, pseudo: name };
    identity.save(code, saved2);
    setMe(saved2);
    setError(null);
    setJoined(true);
  }, [code]);

  /*
   * La reconnexion automatique repasse le role de l'invitation.
   *
   * Le serveur retrouve le role d'un participant qu'il connait encore. Mais si
   * sa ligne a disparu — depart pendant le lobby, purge — il recree, et sans
   * cette valeur il recreait un createur. Un spectateur se retrouvait alors
   * avec une zone de depot parfaitement legitime.
   */
  const { socket, state, you, connected, ratings } = useBattleSocket((s) => enter(s, undefined, inviteAsSpectator));

  /*
   * L'animateur a relance : on suit.
   *
   * Le serveur a reinscrit chacun dans la nouvelle session avec le meme jeton ;
   * il ne manque au navigateur que le nouveau code et le nouvel identifiant.
   * On les range comme une identite ordinaire, puis on change de page : la
   * reprise automatique fait le reste, role compris.
   */
  useEffect(() => {
    if (!socket || !code) return;
    const suivre = ({ code: suite, participantId }: { code?: string; participantId?: string | null }) => {
      if (!suite || suite === code) return;
      const actuelle = identity.get(code);
      if (actuelle && participantId) identity.save(suite, { ...actuelle, participantId });
      window.location.replace(`/play?code=${encodeURIComponent(suite)}`);
    };
    socket.on('session:moved', suivre);
    return () => { socket.off('session:moved', suivre); };
  }, [socket, code]);

  const chrono = usePhaseClock(state, {
    onAlert: (s) => {
      sfx.alert(s);
      toast(`Plus que ${humanThreshold(s)}`, s <= 60 ? 'err' : 'info');
      // Un telephone dans une poche ne montre rien : la vibration porte plus
      // loin que la couleur du chrono.
      navigator.vibrate?.(s <= 60 ? [90, 60, 90] : 60);
    },
    onEnd: () => { sfx.end(); navigator.vibrate?.([160, 80, 160]); },
  });

  // Carte de visite de la session avant d'entrer : le participant doit pouvoir
  // verifier qu'il ne s'est pas trompe de code.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    fetch(`/api/session/${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((data: SessionCard) => { if (!cancelled) setCard(data); })
      .catch(() => { if (!cancelled) setCard({ exists: false }); });
    return () => { cancelled = true; };
  }, [code]);

  /**
   * Pseudo propose a l'entree.
   *
   * L'identite gardee pour cette session passe d'abord : c'est la personne qui
   * revient. Sinon, le compte Podium connecte dans ce navigateur, si le jeu y
   * est branche. Le champ reste modifiable : le pseudo en jeu n'est qu'un
   * affichage, le rattachement au compte se fait par le cookie, cote serveur.
   */
  const [hub, setHub] = useState<PodiumIdentity | null>(null);
  useEffect(() => {
    const saved = code ? identity.get(code) : null;
    if (saved) setPseudo(saved.pseudo);
    let cancelled = false;
    void fetchPodiumIdentity().then((me) => {
      if (cancelled || !me) return;
      setHub(me);
      if (!saved && me.pseudo) setPseudo((current) => current || me.pseudo!);
    });
    return () => { cancelled = true; };
  }, [code]);

  /**
   * Le role se choisit ici, et une seule fois.
   *
   * Un spectateur ne depose rien mais note comme les autres : sa voix compte
   * autant. C'est pour cela qu'il doit etre la avant la diffusion — les votants
   * absents comptent pour la note par defaut, et des juges arrivant en retard
   * fausseraient tous les rendus deja passes.
   */
  const join = async (asSpectator = false) => {
    if (!socket) return;
    // Le clic sur « Entrer » est le geste qui debloque le son : sans lui, les
    // alertes de fin de temps ne sortiraient jamais du navigateur.
    sfx.unlock();
    setBusy(true);
    await enter(socket, pseudo.trim(), asSpectator);
    setBusy(false);
  };

  /**
   * Une note.
   *
   * Le rendu vise est celui affiche par l'etat commun, mais la comparaison
   * « est-ce le mien ? » se fait avec le canal personnel : l'etat partage ne
   * contient aucun lien entre un rendu et son auteur, et c'est bien ainsi.
   */
  const vote = async (criterionId: string, value: number) => {
    const current = state?.diffusion?.current;
    if (!socket || !current) return;
    const res = await call(socket, 'play:vote', { renditionId: current.renditionId, criterionId, value });
    if (!res.ok) { toast(res.error, 'err'); return; }
    sfx.vote();
  };

  const leave = () => {
    /*
     * Une fois la partie lancee, on ne « quitte » plus vraiment.
     *
     * Le serveur garde la ligne du participant des que le chrono est parti :
     * effacer son identite ici l'enfermait dehors (« pseudo deja pris », puis
     * « inscriptions fermees ») et laissait un fantome qui pesait la note par
     * defaut sur tous les rendus. On garde donc sa place a son nom : il ferme
     * la page, et le meme lien le ramene.
     */
    const lancee = !!state && state.phase !== 'config' && state.phase !== 'lobby';
    if (lancee) {
      if (window.confirm('La partie est lancée : ta place reste à ton nom. Tu pourras revenir avec le même lien, sur ce navigateur. Fermer la page ?')) {
        window.location.assign('/');
      }
      return;
    }
    if (socket) void call(socket, 'play:leave');
    if (code) identity.clear(code);
    setJoined(false);
    setMe(null);
    setError(null);
  };

  /* ------------------------------ rendu ----------------------------- */

  if (!code) {
    return (
      <div className={styles.gate}>
        <Brand />
        <h1>Rejoindre une battle</h1>
        <p className="muted">Saisis le code annoncé par l’animateur.</p>
        <JoinForm className="col" inputClassName={styles.codeInput} />
      </div>
    );
  }

  if (card && !card.exists) {
    return (
      <div className={styles.gate}>
        <Brand />
        <h1>Code inconnu</h1>
        <p className="muted">La session <b>{code}</b> n’existe pas, ou elle est terminée.</p>
        <JoinForm className="col" inputClassName={styles.codeInput} />
      </div>
    );
  }

  if (!joined || !state) {
    return (
      <div className={styles.gate}>
        <Brand />
        <span className="pill"><span className="code-chip">{code}</span></span>
        <h1>{card?.name ?? '…'}</h1>
        <p className="muted">
          {card?.mediaType
            ? `Rendu attendu · ${MEDIA_LABELS[card.mediaType].label}`
            : 'Chargement'}
        </p>
        {card && !card.open && (
          <p className="pill err"><span>Inscriptions fermées</span></p>
        )}
        <div className="field" style={{ width: '100%' }}>
          <label htmlFor="pseudo">Ton pseudo</label>
          <input
            id="pseudo" className="input" value={pseudo} maxLength={22}
            placeholder="Comment on t’appelle ?"
            autoComplete="nickname"
            onChange={(e) => setPseudo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void join(inviteAsSpectator); }}
          />
          {hub?.pid && (
            <span className="pill ok" style={{ alignSelf: 'flex-start' }}>
              Connecté via Podium · ta partie comptera au classement
            </span>
          )}
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.roles}>
          {inviteAsSpectator && (
            <p className="pill" style={{ alignSelf: 'flex-start' }}>
              <Icon name="oeil" />Invitation spectateur
            </p>
          )}
          <button
            className={inviteAsSpectator ? 'btn lg block' : 'btn primary lg block'}
            disabled={busy || pseudo.trim().length < 2 || !connected} aria-busy={busy}
            onClick={() => void join(false)}
          >
            {connected ? 'Je participe' : 'Connexion'}
          </button>
          <button
            className={inviteAsSpectator ? 'btn primary lg block' : 'btn lg block'}
            disabled={busy || pseudo.trim().length < 2 || !connected} aria-busy={busy}
            onClick={() => void join(true)}
          >
            <Icon name="oeil" />Je regarde et je note
          </button>
          <p className={styles.roleHint}>
            Spectateur : tu ne déposes rien et tu ne peux pas gagner, mais ta note compte comme
            celle des autres. À choisir maintenant, ça ne se change plus.
          </p>
        </div>
      </div>
    );
  }

  const phase = state.phase;

  return (
    <>
      <header className="topbar">
        <Brand compact />
        <span className="grow">
          <span className="session-name ellipsis">{state.name}</span>
          <span className="meta">
            {PHASE_LABELS[phase]}
            {state.manche.rounds > 1 ? ` • manche ${state.manche.round}/${state.manche.rounds}` : ''}
          </span>
        </span>
        {/* Le spectateur se signale dans sa propre pastille, par l'oeil : une
            seconde pastille « SPECTATEUR » ecrasait, a 390 px, le nom de la
            session en « R. » et son etat en une lettre par ligne. */}
        {you && (
          <span className="pill" title={you.spectator ? 'Spectateur : tu notes, tu ne déposes rien' : undefined}>
            {you.spectator && <Icon name="oeil" />}
            <span aria-hidden="true">{you.avatar}</span>
            <span className="ellipsis" style={{ maxWidth: 90 }}>{you.pseudo}</span>
            {you.spectator && <span className="sr-only">, spectateur</span>}
          </span>
        )}
        {!connected && <span className="pill live"><span className="dot" /> Hors ligne</span>}
      </header>

      <div className="shell narrow">
        <PhaseRail phase={phase} />

        {you?.disqualified && (
          <p className={styles.error}>
            <span>Hors classement, décision de l’animateur. Tu peux continuer à suivre la session.</span>
          </p>
        )}

        {/* Son sort, en grand et sans minuterie : il doit rester lisible
            pendant qu'on cree, pas passer comme un message. */}
        <OwnFate fate={you?.fate ?? null} />

        {/* Rebuild The Track : l'extrait passe avant tout le reste pendant la
            creation — c'est la consigne, et elle est differente pour chacun. */}
        {you?.extrait && (phase === 'creation' || phase === 'upload') && (
          <MonExtrait extrait={you.extrait} round={state.manche.round} rounds={state.manche.rounds} />
        )}

        <section className={`card pad ${styles.stage}`}>{renderStage()}</section>

        {/* En Rebuild, l'extrait EST la consigne : une carte « aucune consigne »
            ou « aucun element » vide ne ferait que repousser l'essentiel. */}
        {!(state.config.mode === 'rebuild' && !state.brief.trim()) && (
        <section className="card pad col">
          <h2 className="section-title">Consigne</h2>
          <p className="brief">{state.brief}</p>
          <div className="row wrap meta">
            <span>{MEDIA_LABELS[state.mediaType].label}</span>
            <span>·</span>
            <span>{humanDuration(state.config.durationMs).toUpperCase()}</span>
            <span>·</span>
            <span>Note sur {state.config.scale}</span>
          </div>
        </section>
        )}

        {!(state.config.mode === 'rebuild' && state.assets.length === 0) && (
        <section className="card pad col">
          <h2 className="section-title">Éléments imposés</h2>
          <AssetPack
            assets={state.assets}
            zipUrl={state.assets.length ? state.assetsZipUrl : undefined}
            emptyLabel="Aucun élément imposé · la consigne seule fait foi"
          />
        </section>
        )}

        <section className="card pad col">
          <h2 className="section-title">Dans l’arène ({state.counts.participants})</h2>
          {state.roster.length === 0
            ? <p className="empty">Tu es le premier.</p>
            : (
              <div className="roster">
                {state.roster.map((p) => (
                  <div key={p.id} className={`roster-row ${p.connected ? '' : 'off'} ${p.disqualified ? 'dq' : ''}`}>
                    <span className="avatar" aria-hidden="true">{p.avatar}</span>
                    <span className="who grow">
                      <span className="pseudo ellipsis">{p.pseudo}{p.id === you?.id ? ' · vous' : ''}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
        </section>

        <footer className={styles.footer}>
          <button className="btn xs ghost" onClick={leave}>Quitter la session</button>
        </footer>
      </div>
    </>
  );

  /**
   * Zone de depot.
   *
   * Rendue par `you` et non par l'etat commun : le rendu d'un participant ne
   * transite que par son canal personnel, et cette regle vaut aussi cote
   * interface — un composant qui irait le chercher dans l'etat partage
   * trouverait un jour celui de quelqu'un d'autre.
   */
  function renderSubmission() {
    if (!me || you?.disqualified) return null;
    /*
     * Tant que le canal personnel n'a rien dit, on n'ouvre rien.
     *
     * `you` arrive une fraction de seconde apres l'etat commun. En affichant la
     * zone de depot par defaut, un spectateur la voyait pendant cet intervalle —
     * et en permanence si le canal tardait. Le defaut doit etre la surface qui
     * en donne le moins, pas l'inverse.
     */
    if (!you) return null;
    /*
     * Un spectateur n'a rien a deposer. On lui donne la chaine.
     *
     * Le cadavre exquis remplit l'attente sans la transformer en competition :
     * il ne rapporte aucun point et n'entre dans aucun classement. Seul, sans
     * personne a qui passer la main, on retombe sur l'ecran d'attente simple.
     */
    if (you.spectator) {
      return you.chain
        ? (
          <Chaine
            socket={socket}
            chain={state!.chain}
            you={you.chain}
            attendus={state!.counts.participants}
            rendus={state!.counts.submitted}
          />
        )
        : <SpectatorWait state={state!} />;
    }
    return (
      <SubmissionBox
        code={state!.code}
        identity={me}
        mediaType={state!.mediaType}
        config={state!.config}
        submission={you?.submission ?? null}
        closingAt={state!.clock.graceEndAt ?? state!.clock.createEndAt}
        graceEndAt={phase === 'upload' ? state!.clock.graceEndAt : null}
      />
    );
  }

  function renderStage() {
    switch (phase) {
      case 'config':
      case 'lobby':
        return (
          <div className={styles.waiting}>
            <span className={styles.bigIcon} aria-hidden="true">{MEDIA_LABELS[state!.mediaType].icon}</span>
            <h2>En attente du départ</h2>
            {/*
              * Un spectateur n'a ni consigne a lire ni materiel a preparer : lui
              * annoncer un temps « pour creer » et lui tendre les elements de
              * travail lui promettrait un role qu'il n'a pas.
              */}
            {you?.spectator ? (
              <>
                <p className="muted">
                  Tu suis cette session sans y concourir. L’animateur lance le chrono quand tout le monde est là.
                </p>
                <p className="meta">
                  Les créateurs auront {humanDuration(state!.config.durationMs)}. Ton tour vient à la diffusion.
                </p>
              </>
            ) : (
              <>
                <p className="muted">
                  {state!.config.mode === 'rebuild'
                    ? 'Tu recevras ton extrait au lancement : son tempo, sa tonalité, et le fichier à reconstruire.'
                    : 'Lis la consigne, prépare ton matériel. L’animateur lance le chrono quand tout le monde est là.'}
                </p>
                <p className="meta">
                  Tu auras {humanDuration(state!.config.durationMs)} pour créer.
                </p>
                {state!.assets.length > 0 && (
                  <a className="btn sm" href={state!.assetsZipUrl}>
                    <Icon name="telecharge" />Récupérer les {state!.assets.length} éléments
                  </a>
                )}
              </>
            )}
          </div>
        );
      case 'creation':
        return (
          <>
            <Chrono clock={chrono} />
            <p className="muted" style={{ textAlign: 'center' }}>
              {chrono.paused
                ? 'L’animateur a mis le chrono en pause.'
                : you?.spectator
                  ? 'Les créateurs travaillent. Tu noteras leurs rendus à la diffusion.'
                  : 'Dépôt possible dès que le rendu est prêt, sans attendre la fin.'}
            </p>
            {renderSubmission()}
            {/*
              * Pendant que les createurs travaillent, un spectateur n'a rien a
              * faire : le mini-jeu est pour lui, et pour lui seul — un createur
              * n'a pas a etre distrait de son chrono.
              */}
            {you?.spectator && <Pads />}
          </>
        );
      case 'upload':
        return (
          <>
            <Chrono clock={chrono} hint="Dernière ligne droite" />
            <p className="muted" style={{ textAlign: 'center' }}>
              {you?.spectator
                ? 'Le temps de création est écoulé. La diffusion va commencer.'
                : 'Le temps de création est écoulé. Il reste la fenêtre de grâce pour finaliser ton dépôt.'}
            </p>
            {renderSubmission()}
            {you?.spectator && <Pads />}
          </>
        );
      case 'diffusion': {
        const d = state!.diffusion;
        if (!d) return null;
        const current = d.current;
        return (
          <>
          <DiffusionStage
            diffusion={d}
            config={state!.config}
            votes={current ? (you?.votes?.[current.renditionId] ?? {}) : {}}
            isMine={!!current && you?.submission?.renditionId === current.renditionId}
            canVote={!you?.disqualified}
            onVote={vote}
            audio={audioChoice ?? d.playerAudio}
            onToggleAudio={chooseAudio}
          />
          {/* La chaine se lit pendant que les rendus defilent : c'est le
              moment ou le jeu d'attente devient un moment de la soiree. */}
          <ChaineLue chain={state!.chain} />
          </>
        );
      }
      case 'results':
      case 'archived':
        // Terminer la session ne retire rien : le podium, la reecoute et le
        // telechargement restent sur les telephones comme sur le grand ecran.
        if (!state!.podium) {
          return (
            <div className={styles.waiting}>
              <h2>Session terminée</h2>
              <p className="muted">Merci d’avoir joué.</p>
              {state!.general && (
                <ClassementGeneral general={state!.general} rounds={state!.manche.rounds} mineId={you?.id ?? null} />
              )}
            </div>
          );
        }
        return state!.podium ? (
          <div className={styles.results}>
            <h2>{phase === 'archived' ? 'Session terminée — le classement' : 'Classement'}</h2>
            {state!.podium.complete || phase === 'archived'
              ? null
              : <p className="meta">L’animateur dévoile les places une par une.</p>}
            <Podium replay podium={state!.podium} meId={you?.id} ratings={ratings} />
            {state!.general && (
              <>
                <h2>Classement général</h2>
                <ClassementGeneral general={state!.general} rounds={state!.manche.rounds} mineId={you?.id ?? null} />
              </>
            )}
            <ChaineLue chain={state!.chain} />
          </div>
        ) : null;
      default:
        return (
          <div className={styles.waiting}>
            <Icon name="depot" size="xl" className={styles.bigIcon} />
            <h2>Session terminée</h2>
            <p className="muted">Session archivée. Merci d’avoir joué.</p>
            {state!.general && (
              <ClassementGeneral general={state!.general} rounds={state!.manche.rounds} mineId={you?.id ?? null} />
            )}
          </div>
        );
    }
  }
}

/**
 * Ce que voit un spectateur pendant que les autres creent.
 *
 * Il n'a rien a deposer et rien a attendre de lui-meme : on lui dit ou en est
 * la session, ce qu'on attend de lui, et quand son tour viendra.
 */
function SpectatorWait({ state }: { state: BattleState }) {
  const attendus = state.counts.participants;
  const rendus = state.counts.submitted;
  return (
    <section className="card pad" style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <div className="meta" style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <span>Rôle · spectateur</span>
        <span>{hexOf(rendus, attendus)} ont rendu</span>
      </div>
      <h2 style={{ font: 'var(--t-h2)', letterSpacing: 'var(--ls-display)' }}>Tu ne crées pas</h2>
      <p className="muted">
        Tu suis la session sans y concourir. Quand la diffusion commencera, les rendus défileront en
        aveugle et tu noteras comme tout le monde : ta voix compte autant que celle des créateurs.
      </p>
      <div className="meta" style={{ borderTop: 'var(--border)', paddingTop: 'var(--sp-3)' }}>
        Rien à faire d’ici là. Laisse la page ouverte.
      </div>
    </section>
  );
}
