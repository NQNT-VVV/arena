'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { Icon } from '@/components/Icon';
import { AssetPack } from '@/components/AssetPack';
import { AssetUploader } from '@/components/AssetUploader';
import { Brand } from '@/components/Brand';
import { ClassementGeneral } from '@/components/ClassementGeneral';
import { EtapesRegie } from '@/components/EtapesRegie';
import { ExtraitsRegie } from '@/components/ExtraitsRegie';
import { DiffusionStage } from '@/components/DiffusionStage';
import { Podium } from '@/components/Podium';
import { RouletteHost } from '@/components/RouletteHost';
import { Chrono } from '@/components/Chrono';
import { PhaseRail } from '@/components/PhaseRail';
import { QrCode } from '@/components/QrCode';
import { humanBytes, humanDuration, humanThreshold, PHASE_LABELS } from '@/lib/format';
import { audioPref } from '@/lib/audioPref';
import { hostKeys } from '@/lib/identity';
import { sfx } from '@/lib/sfx';
import { call } from '@/lib/socket';
import { copyToClipboard } from '@/lib/storage';
import { ManchesPassees } from '@/components/ManchesPassees';
import { toast } from '@/lib/toast';
import { MEDIA_LABELS, type Asset, type LatePolicy, type MediaType, type SessionMode } from '@/lib/types';
import { useBattleSocket } from '@/lib/useBattleSocket';
import { usePhaseClock } from '@/lib/usePhaseClock';
import styles from './host.module.css';

/** Seuils proposes en un clic. L'animateur en coche autant qu'il veut. */
const ALERT_CHOICES = [900, 600, 300, 120, 60, 30];

const LATE_POLICIES: { id: LatePolicy; label: string; hint: string }[] = [
  { id: 'reject', label: 'Refusés', hint: 'Passé l’heure, le dépôt est bloqué.' },
  { id: 'unranked', label: 'Hors classement', hint: 'Le rendu passe en diffusion mais ne concourt pas.' },
  { id: 'penalty', label: 'Pénalisés', hint: 'Le rendu concourt, avec une note amputée.' },
];

interface Draft {
  name: string;
  mediaType: MediaType;
  brief: string;
  durationMin: number;
  graceMin: number;
  playMaxS: number;
  voteWindowS: number;
  autoNext: boolean;
  playerAudio: boolean;
  alerts: number[];
  scale: number;
  defaultVote: number;
  latePolicy: LatePolicy;
  latePenalty: number;
  autoAdvance: boolean;
  mode: SessionMode;
  rounds: number;
}

const EMPTY_DRAFT: Draft = {
  name: '',
  mediaType: 'audio',
  brief: '',
  durationMin: 60,
  graceMin: 2,
  playMaxS: 45,
  voteWindowS: 15,
  autoNext: true,
  playerAudio: true,
  alerts: [600, 120, 60, 30],
  scale: 5,
  defaultVote: 3,
  latePolicy: 'reject',
  latePenalty: 1,
  autoAdvance: false,
  mode: 'battle',
  rounds: 1,
};

const MODES: { id: SessionMode; label: string; hint: string }[] = [
  { id: 'battle', label: 'Beat Battle', hint: 'Tout le monde crée sur la même consigne et les mêmes éléments.' },
  {
    id: 'rebuild',
    label: 'Rebuild The Track',
    hint: 'Chacun reçoit un extrait différent — tempo et tonalité affichés — et le reconstruit.',
  },
];

export function HostClient() {
  const [code, setCode] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  // La regie est muette par defaut : l'animateur a presque toujours le grand
  // ecran ouvert a cote, et deux lecteurs decales d'un dixieme font un echo.
  const [audio, setAudio] = useState(false);
  useEffect(() => { const saved = audioPref.get('host'); if (saved !== null) setAudio(saved); }, []);
  const chooseAudio = (on: boolean) => { audioPref.set('host', on); setAudio(on); };

  /**
   * Reprise de la regie.
   *
   * Rejouee a chaque connexion, y compris apres une coupure : le serveur voit
   * une socket neuve, qui doit se re-annoncer pour recevoir les etats.
   */
  const attach = useCallback(async (socket: Socket) => {
    const known = code ?? hostKeys.last();
    const token = known ? hostKeys.get(known) : null;
    if (!known || !token) {
      setBooted(true);
      return;
    }
    const res = await call<{ code: string }>(socket, 'host:attach', { code: known, hostToken: token });
    if (res.ok) {
      setCode(res.code);
    } else {
      /*
       * Un refus explicite — session purgee, jeton d'une autre installation —
       * fait repartir de zero. Un simple delai, non : le serveur ne garde que
       * l'empreinte du jeton, et l'effacer ici sur une coupure de reseau
       * laissait la session sans animateur, joueurs bloques dans la phase.
       * La prochaine reconnexion retentera toute seule.
       */
      if (!res.timedOut) hostKeys.clear(known);
      toast(res.timedOut ? 'Connexion instable : la régie se rattache dès que le serveur répond.' : res.error, 'err');
    }
    setBooted(true);
  }, [code]);

  const { socket, state, connected, ratings } = useBattleSocket(attach);

  const chrono = usePhaseClock(state, {
    onAlert: (s) => { sfx.alert(s); toast(`Plus que ${humanThreshold(s)}`, 'info'); },
    onEnd: () => sfx.end(),
  });

  // Le contexte audio ne demarre qu'apres un geste : sans ce declencheur, les
  // alertes de la regie resteraient muettes toute la soiree.
  useEffect(() => {
    const wake = () => sfx.unlock();
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  // Quand la session existe deja, le formulaire reflete ses reglages reels.
  useEffect(() => {
    if (!state) return;
    setDraft((d) => ({
      ...d,
      name: state.name,
      mediaType: state.mediaType,
      brief: state.brief,
      durationMin: Math.round(state.config.durationMs / 60000),
      graceMin: Math.round(state.config.graceMs / 60000),
      playMaxS: state.config.playMaxS,
      voteWindowS: state.config.voteWindowS,
      autoNext: state.config.autoNext,
      playerAudio: state.config.playerAudio,
      alerts: state.config.alerts,
      scale: state.config.scale,
      defaultVote: state.config.defaultVote,
      latePolicy: state.config.latePolicy,
      latePenalty: state.config.latePenalty,
      autoAdvance: state.config.autoAdvance,
      mode: state.config.mode ?? 'battle',
      rounds: state.config.rounds ?? 1,
    }));
  }, [state?.code, state?.phase]);

  const inviteUrl = useMemo(
    () => (code && typeof window !== 'undefined' ? `${window.location.origin}/j/${code}` : ''),
    [code],
  );
  /**
   * Le lien de ceux qui viennent juger sans creer.
   *
   * Deux liens plutot qu'un seul avec une case a cocher : l'animateur envoie
   * l'un a ses createurs, l'autre a qui veut seulement voter, et personne n'a
   * de choix a comprendre en arrivant.
   */
  const spectatorUrl = useMemo(
    () => (code && typeof window !== 'undefined' ? `${window.location.origin}/s/${code}` : ''),
    [code],
  );

  const act = async (event: string, payload: Record<string, unknown> = {}) => {
    if (!socket) return false;
    setBusy(true);
    /*
     * Ouvrir le lobby ou lancer enregistre d'abord ce qui est a l'ecran.
     *
     * « Enregistrer les reglages » est tout en bas du formulaire, ces deux
     * boutons tout en haut : une duree ou une consigne corrigee puis un clic
     * sur « Ouvrir le lobby » revenait en silence aux valeurs du serveur — et
     * une fois la creation lancee, les reglages sont figes.
     */
    if ((event === 'host:publish' || event === 'host:start') && state && (state.phase === 'config' || state.phase === 'lobby')) {
      const enregistre = await call(socket, 'host:configure', {
        name: draft.name, mediaType: draft.mediaType, brief: draft.brief, config: draftToConfig(draft),
      });
      if (!enregistre.ok) {
        setBusy(false);
        toast(enregistre.error, 'err');
        return false;
      }
    }
    const res = await call(socket, event, payload);
    setBusy(false);
    if (!res.ok) toast(res.error, 'err');
    return res.ok;
  };

  const draftToConfig = (d: Draft) => ({
    durationMs: d.durationMin * 60_000,
    graceMs: d.graceMin * 60_000,
    playMaxS: d.playMaxS,
    voteWindowS: d.voteWindowS,
    autoNext: d.autoNext,
    playerAudio: d.playerAudio,
    alerts: d.alerts,
    scale: d.scale,
    defaultVote: d.defaultVote,
    latePolicy: d.latePolicy,
    latePenalty: d.latePenalty,
    autoAdvance: d.autoAdvance,
    mode: d.mode,
    rounds: d.rounds,
  });

  const create = async () => {
    if (!socket) return;
    setBusy(true);
    const res = await call<{ code: string; hostToken: string }>(socket, 'host:create', {
      name: draft.name,
      mediaType: draft.mediaType,
      brief: draft.brief,
      config: draftToConfig(draft),
    });
    setBusy(false);
    if (!res.ok) {
      toast(res.error, 'err');
      return;
    }
    hostKeys.save(res.code, res.hostToken);
    hostKeys.setLast(res.code);
    setCode(res.code);
    sfx.phase();
  };

  /**
   * Retrait d'un element.
   *
   * Passe par HTTP et non par la socket : c'est la meme ressource que le
   * depot, et la faire vivre a deux endroits garantit qu'un jour les deux
   * divergeront.
   */
  const dropAsset = async (asset: Asset) => {
    if (!code) return;
    const res = await fetch(`/api/session/${code}/assets/${asset.id}`, {
      method: 'DELETE',
      headers: { 'X-Arena-Token': hostKeys.get(code) ?? '' },
    });
    const body = await res.json().catch(() => ({ error: 'Réponse illisible.' }));
    if (!res.ok) toast(body.error || 'Retrait impossible.', 'err');
    else toast('Élément retiré', 'ok');
  };

  /**
   * Nouvelle edition.
   *
   * Les reglages et la consigne sont repris, la socket bascule sur la nouvelle
   * session : on se retrouve devant le formulaire, pret a changer ce qui doit
   * l'etre. Trente secondes pour relancer, c'etait le cahier des charges.
   */
  const duplicate = async (copyAssets: boolean) => {
    if (!socket || !code) return;
    setBusy(true);
    const res = await call<{ code: string; hostToken: string }>(socket, 'host:duplicate', { copyAssets });
    setBusy(false);
    if (!res.ok) { toast(res.error, 'err'); return; }
    hostKeys.save(res.code, res.hostToken);
    hostKeys.setLast(res.code);
    setCode(res.code);
    sfx.phase();
    toast(`Nouvelle édition ${res.code} créée`, 'ok');
    window.scrollTo({ top: 0 });
  };

  /**
   * Telechargement de l'archive.
   *
   * Passe par une requete et un blob, pas par un lien : un `<a href>` ne sait
   * pas porter l'entete du jeton d'animateur, et mettre le jeton dans l'URL le
   * ferait atterrir dans l'historique du navigateur et les journaux du serveur.
   */
  const download = async (format: 'json' | 'csv') => {
    if (!code) return;
    const res = await fetch(`/api/session/${code}/results.${format}`, {
      headers: { 'X-Arena-Token': hostKeys.get(code) ?? '' },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast(body.error || 'Export impossible.', 'err');
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `${code}-classement.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveConfig = () => act('host:configure', {
    name: draft.name,
    mediaType: draft.mediaType,
    brief: draft.brief,
    config: draftToConfig(draft),
  });

  const quit = () => {
    // Quitter efface le jeton de ce navigateur : en pleine partie, plus personne
    // ne pourrait piloter. On le fait dire avant de le faire.
    const enCours = state && !['config', 'archived'].includes(state.phase);
    if (enCours && !window.confirm('Quitter la régie ? La session continuera sans animateur : plus personne ne pourra la piloter depuis ce navigateur.')) return;
    if (code) hostKeys.clear(code);
    hostKeys.clear('last');
    setCode(null);
    setDraft(EMPTY_DRAFT);
    window.location.reload();
  };

  /* ------------------------------ rendu ----------------------------- */

  if (!booted) {
    return <div className={styles.boot}><span className="pill"><span className="dot" /> Connexion…</span></div>;
  }

  if (!code || !state) return renderCreate();

  const phase = state.phase;
  const editable = phase === 'config' || phase === 'lobby';

  return (
    <>
      <header className="topbar">
        <Brand compact />
        <span className="grow">
          <span className="session-name">{state.name}</span>
          <span className="meta">
            {PHASE_LABELS[phase]}
            {state.manche.rounds > 1 ? ` • manche ${state.manche.round}/${state.manche.rounds}` : ''}
          </span>
        </span>
        <span className={`pill ${connected ? 'ok' : ''}`}>
          <span className="dot" /> {connected ? 'En ligne' : 'Reconnexion…'}
        </span>
        <span className="pill">
          <span className="code-chip">{state.code}</span>
        </span>
        <a className="btn sm ghost" href="/guide" target="_blank" rel="noreferrer">Guide</a>
        <button className="btn sm ghost" onClick={quit}>Quitter</button>
      </header>

      <div className="shell">
        <PhaseRail phase={phase} />

        <EtapesRegie state={state} />

        <section className={styles.grid}>
          <div className={`card pad ${styles.stage}`}>
            <Chrono clock={chrono} />
            {renderControls()}
          </div>

          <div className="col">
            <div className={`card pad ${styles.invite}`}>
              <h2 className="section-title">Inviter</h2>
              <div className={styles.codeBig}><span className="code-chip">{state.code}</span></div>
              {inviteUrl && <QrCode text={inviteUrl} className="screen-qr" />}
              <div className={styles.linkBlock}>
                <span className="meta">Pour créer</span>
                <div className="row">
                  <input className="input grow" readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Lien pour les créateurs" />
                  <button
                    className="btn sm" aria-label="Copier le lien des créateurs"
                    onClick={() => { void copyToClipboard(inviteUrl); toast('Lien créateur copié', 'ok'); }}
                  >
                    <Icon name="copier" />Copier
                  </button>
                </div>
              </div>
              <div className={styles.linkBlock}>
                <span className="meta">Pour juger sans créer</span>
                <div className="row">
                  <input className="input grow" readOnly value={spectatorUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Lien pour les spectateurs" />
                  <button
                    className="btn sm" aria-label="Copier le lien des spectateurs"
                    onClick={() => { void copyToClipboard(spectatorUrl); toast('Lien spectateur copié', 'ok'); }}
                  >
                    <Icon name="copier" />Copier
                  </button>
                </div>
                <p className="meta" style={{ textTransform: 'none', letterSpacing: 'var(--ls-prose)' }}>
                  Un spectateur ne dépose rien et ne peut pas gagner, mais il note comme les autres.
                  Pendant la création, les spectateurs écrivent une histoire à tour de rôle ; elle se
                  lit à la diffusion.
                  À envoyer avant le début de la diffusion : après, on ne rejoint plus.
                </p>
              </div>
              <a className="btn sm block" href={`/screen?code=${state.code}`} target="_blank" rel="noreferrer">
                <Icon name="ecran" />Ouvrir l’écran de projection
              </a>
            </div>

            <div className="stats">
              <div className="stat"><span className="v">{state.counts.participants}</span><span className="k">Créateurs</span></div>
              <div className="stat"><span className="v">{state.counts.spectators}</span><span className="k">Spectateurs</span></div>
              <div className="stat"><span className="v">{state.counts.connected + state.counts.spectatorsConnected}</span><span className="k">En ligne</span></div>
              <div className="stat"><span className="v">{state.counts.submitted}</span><span className="k">Rendus</span></div>
            </div>
          </div>
        </section>

        {/* Rebuild The Track : les extraits avant tout le reste. Avant la
            soiree, c'est ce que la regie vient preparer ; pendant une manche,
            c'est la qu'on change l'extrait de quelqu'un. */}
        {state.config.mode === 'rebuild' && (
          <ExtraitsRegie
            code={state.code}
            token={hostKeys.get(state.code)}
            extraits={state.extraits ?? []}
            attributions={state.attributions ?? []}
            roster={state.roster}
            phase={phase}
            manche={state.manche}
            act={act}
          />
        )}

        {/* LA ROULETTE. Au-dessus du reste : les roues se preparent avant la
            session, et pendant la creation c'est ce que la regie vient
            chercher. */}
        <RouletteHost
          socket={socket}
          wheels={state.wheels ?? []}
          roulette={state.roulette}
          rules={state.rouletteRules ?? null}
          lastSeed={state.lastSeed ?? null}
          phase={phase}
          roster={state.roster}
        />

        {phase === 'diffusion' && state.diffusion && (
          <section className="card pad col">
            <h2 className="section-title">Rendu diffusé</h2>
            {/* La regie voit exactement ce que voit la salle : aucun auteur,
                aucun nom de fichier. Elle partage souvent son ecran. */}
            <DiffusionStage
              diffusion={state.diffusion}
              config={state.config}
              votes={{}}
              isMine={false}
              audio={audio}
              onToggleAudio={chooseAudio}
            />
          </section>
        )}

        {(phase === 'results' || phase === 'archived') && state.podium && (
          <section className="card pad col">
            <h2 className="section-title">
              Classement{state.manche.rounds > 1 ? ` — manche ${state.manche.round}` : ''}
            </h2>
            <Podium replay podium={state.podium} ratings={ratings} />
          </section>
        )}

        {state.general && (
          <section className="card pad col">
            <h2 className="section-title">Classement général</h2>
            <ClassementGeneral general={state.general} rounds={state.manche.rounds} />
          </section>
        )}

        {state.passees && state.passees.length > 0 && (
          <section className="card pad col">
            <ManchesPassees passees={state.passees} />
          </section>
        )}


        <section className="card pad col">
          <h2 className="section-title">Consigne</h2>
          <p className="brief">{state.brief}</p>
          <div className="row wrap faint">
            <span>{MEDIA_LABELS[state.mediaType].label}</span>
            <span>•</span>
            <span>{humanDuration(state.config.durationMs)} de création</span>
            <span>•</span>
            <span>{humanDuration(state.config.graceMs)} de grâce</span>
            <span>•</span>
            <span>note sur {state.config.scale}</span>
            {state.config.alerts.length > 0 && (
              <>
                <span>•</span>
                <span>alertes à {state.config.alerts.map(humanThreshold).join(', ')}</span>
              </>
            )}
          </div>
        </section>

        <section className="card pad col">
          <h2 className="section-title">
            Éléments imposés
            {state.assets.length > 0 && (
              <span className="faint" style={{ letterSpacing: 0, textTransform: 'none' }}>
                {state.assets.length} • {humanBytes(state.assets.reduce((n, a) => n + a.bytes, 0))}
              </span>
            )}
          </h2>
          <p className="meta">
            Samples, screenshots, rushes, templates. Les créateurs les consultent directement
            dans leur page et peuvent récupérer le pack complet.
          </p>
          <AssetUploader
            code={state.code}
            token={hostKeys.get(state.code)}
            disabled={!state.rules?.assetAdd}
            hint="Ou glisse-les ici — plusieurs à la fois"
          />
          <AssetPack
            assets={state.assets}
            zipUrl={state.assets.length ? state.assetsZipUrl : undefined}
            onRemove={state.rules?.assetRemove ? dropAsset : undefined}
            emptyLabel="Aucun élément pour l’instant. Une session peut très bien s’en passer : une consigne seule suffit."
          />
        </section>

        {editable && <section className="card pad col">{renderForm(true)}</section>}

        <section className="card pad col">
          <h2 className="section-title">
            Créateurs ({state.counts.participants})
            {state.counts.spectators > 0 && ` · Spectateurs (${state.counts.spectators})`}
          </h2>
          {state.roster.length === 0
            ? <p className="empty">Personne pour l’instant. Partage le code ou le QR.</p>
            : (
              <div className="roster">
                {state.roster.map((p) => (
                  <div
                    key={p.id}
                    className={`roster-row ${p.connected ? '' : 'off'} ${p.disqualified ? 'dq' : ''} ${p.hasSubmitted ? styles.submitted : ''}`}
                  >
                    <span className="avatar" aria-hidden="true">{p.avatar}</span>
                    <span className="who grow">
                      <span className="pseudo ellipsis">{p.pseudo}</span>
                      <span className="sub">
                        {p.spectator && 'spectateur · '}
                        {p.hasSubmitted ? 'a rendu' : (p.connected ? 'en ligne' : 'déconnecté')}
                      </span>
                    </span>
                    <button
                      className="btn xs ghost"
                      title={p.disqualified
                        ? 'Réintégrer : il note à nouveau, et son rendu concourt s’il a été diffusé'
                        : 'Écarter : il ne note plus et son rendu sort du classement'}
                      onClick={() => act('host:disqualify', { participantId: p.id, on: !p.disqualified })}
                    >
                      {p.disqualified ? 'Réintégrer' : 'Écarter'}
                    </button>
                  </div>
                ))}
              </div>
            )}
        </section>
      </div>
    </>
  );

  /* --------------------------- sous-rendus -------------------------- */

  function renderControls() {
    const btn = (label: string, event: string, payload?: Record<string, unknown>, cls = 'btn') => (
      <button className={cls} disabled={busy} aria-busy={busy} onClick={() => act(event, payload ?? {})}>{label}</button>
    );

    switch (phase) {
      case 'config':
        return (
          <div className={styles.controls}>
            <p className="muted">
              Règle la session ci-dessous, puis ouvre le lobby pour que créateurs et spectateurs puissent entrer.
              {' '}Pense à mettre la consigne à jour si c’est une nouvelle édition.
            </p>
            {btn('Ouvrir le lobby', 'host:publish', {}, 'btn primary lg')}
          </div>
        );
      case 'lobby':
        return (
          <div className={styles.controls}>
            <p className="muted">
              {state!.counts.participants === 0
                ? 'En attente des créateurs.'
                : `${state!.counts.participants} créateur(s) dans la session. Le chrono part dès que tu lances.`}
            </p>
            <div className="row wrap">
              {btn('Revenir aux réglages', 'host:unpublish')}
              {btn(state!.manche.rounds > 1 ? '▶ Lancer la manche 1' : '▶ Lancer la création', 'host:start', {}, 'btn primary lg')}
            </div>
          </div>
        );
      case 'creation':
        return (
          <div className={styles.controls}>
            <div className="row wrap">
              {btn('− 5 min', 'host:add-time', { deltaMs: -5 * 60_000 }, 'btn sm')}
              {btn('+ 1 min', 'host:add-time', { deltaMs: 60_000 }, 'btn sm')}
              {btn('+ 5 min', 'host:add-time', { deltaMs: 5 * 60_000 }, 'btn sm')}
              {btn('+ 15 min', 'host:add-time', { deltaMs: 15 * 60_000 }, 'btn sm')}
            </div>
            <div className="row wrap">
              {chrono.paused
                ? btn('▶ Reprendre', 'host:resume', {}, 'btn good')
                : btn('⏸ Pause', 'host:pause', {}, 'btn')}
              {btn('Clore la création', 'host:close-creation', {}, 'btn primary')}
            </div>
          </div>
        );
      case 'upload': {
        const pending = state!.pendingSubmissions ?? 0;
        return (
          <div className={styles.controls}>
            <p className="muted">
              Dépôt. {state!.counts.submitted} rendu(s) reçu(s) pour {state!.counts.participants} créateur(s).
              {pending > 0 && <> <b>{pending}</b> en cours de traitement.</>}
            </p>
            <div className="row wrap">
              {btn('+ 2 min', 'host:add-time', { deltaMs: 2 * 60_000 }, 'btn sm')}
              <button
                className="btn primary lg"
                disabled={busy || pending > 0} aria-busy={busy}
                title={pending > 0 ? 'Le serveur prépare encore des extraits' : undefined}
                onClick={() => act('host:start-diffusion')}
              >
                {pending > 0 ? 'Préparation des extraits…' : 'Lancer la diffusion'}
              </button>
            </div>
          </div>
        );
      }
      case 'diffusion': {
        const d = state!.diffusion;
        const last = !d || d.index >= d.total - 1;
        const everyone = !!d && d.eligible > 0 && d.voted >= d.eligible;
        return (
          <div className={styles.controls}>
            <p className="muted">
              {d && d.total > 0
                ? <>Rendu <b>{d.index + 1}</b> sur {d.total} — <b>{d.voted}</b> / {d.eligible} ont noté</>
                : 'Aucun rendu à diffuser.'}
            </p>
            <div className="row wrap">
              <button className="btn sm" disabled={busy || !d || d.index === 0} aria-busy={busy} onClick={() => act('host:diffusion-prev')}>
                <Icon name="precedent" />Précédent
              </button>
              <button className="btn sm" disabled={busy || !d?.current} aria-busy={busy} title="Relancer ce rendu depuis le début, pour tout le monde" onClick={() => act('host:diffusion-replay')}>
                <Icon name="chrono" />Rejouer ce rendu
              </button>
              <button
                className={`btn ${everyone ? 'good' : ''}`}
                disabled={busy || last} aria-busy={busy}
                onClick={() => act('host:diffusion-next')}
              >
                Suivant<Icon name="suivant" />
              </button>
            </div>
            <label className="switch" title="Le serveur passe seul au rendu suivant après l’écoute et la fenêtre de vote">
              <input
                type="checkbox"
                checked={!!d?.autoNext}
                disabled={busy} aria-busy={busy}
                onChange={(e) => act('host:auto-next', { on: e.target.checked })}
              />
              <span className="track" />
              <span>
                {d?.autoNext ? 'Enchaînement automatique' : 'Enchaînement manuel — coupé pour commenter'}
              </span>
            </label>
            {/*
              * Irreversible : les rendus pas encore passes seraient classes avec
              * la seule note par defaut, sans que personne les ait ecoutes.
              */}
            <button
              className={`btn ${last ? 'primary' : ''}`} disabled={busy} aria-busy={busy}
              onClick={() => {
                const reste = (d?.total ?? 0) - (d?.index ?? 0) - 1;
                if (reste > 0 && !window.confirm(`Il reste ${reste} rendu(s) à passer : ils seraient classés sans avoir été écoutés, et on ne revient pas en arrière. Afficher les résultats quand même ?`)) return;
                void act('host:results', {});
              }}
            >
              Afficher les résultats
            </button>
            {!last && (
              <span className="meta">
                Il reste {(d?.total ?? 0) - (d?.index ?? 0) - 1} rendu(s) à passer.
              </span>
            )}
          </div>
        );
      }
      case 'results': {
        const p = state!.podium;
        return (
          <div className={styles.controls}>
            <p className="muted">
              {p?.complete
                ? 'Classement entièrement dévoilé.'
                : <>Dévoile du dernier au premier — <b>{p?.revealed ?? 0}</b> / {p?.total ?? 0}</>}
            </p>
            <div className="row wrap">
              <button className="btn primary" disabled={busy || !!p?.complete} aria-busy={busy} onClick={() => act('host:reveal')}>
                Dévoiler la place suivante
              </button>
              <button className="btn sm" disabled={busy || !!p?.complete} aria-busy={busy} onClick={() => act('host:reveal', { all: true })}>
                Tout dévoiler
              </button>
            </div>
            <div className="row wrap">
              <button className="btn sm ghost" onClick={() => download('csv')}><Icon name="telecharge" />CSV</button>
              <button className="btn sm ghost" onClick={() => download('json')}><Icon name="telecharge" />JSON</button>
              {btn('Terminer la session', 'host:archive', {}, 'btn sm ghost')}
            </div>
            {renderNextRound()}
            {/* Pas de « nouvelle edition » tant qu'il reste des manches : en
                pleine partie, ce bouton a cote de « manche suivante » ne
                servirait qu'a relancer une session par erreur. */}
            {state!.manche.derniere && renderNextEdition()}
          </div>
        );
      }
      default:
        return (
          <div className={styles.controls}>
            <p className="muted">Session archivée.</p>
            <div className="row wrap">
              <button className="btn sm ghost" onClick={() => download('csv')}><Icon name="telecharge" />CSV</button>
              <button className="btn sm ghost" onClick={() => download('json')}><Icon name="telecharge" />JSON</button>
            </div>
            {renderNextEdition()}
          </div>
        );
    }
  }

  /**
   * La manche suivante, et sa duree.
   *
   * La duree se regle ICI, au moment de lancer : c'est la consigne — « reglage
   * de la duree avant chaque manche » — et les reglages generaux sont figes
   * depuis le premier lancement. Le bouton attend que tout le classement soit
   * devoile : la manche se fige a ce moment-la.
   */
  function renderNextRound() {
    const m = state!.manche;
    if (m.rounds <= 1) return null;
    if (m.derniere) {
      return (
        <p className="meta" style={{ textTransform: 'none', letterSpacing: 'var(--ls-prose)' }}>
          Dernière manche : le classement général ci-dessous est le classement final.
        </p>
      );
    }
    const pret = !!state!.podium?.complete;
    return (
      <div className={styles.nextEdition}>
        <span className="section-title">Manche {m.round + 1}/{m.rounds}</span>
        <label className="field">
          <span className="meta">Consigne de la manche {m.round + 1}</span>
          <textarea
            className="input" rows={3} value={draft.brief} maxLength={4000}
            onChange={(e) => setDraft((d) => ({ ...d, brief: e.target.value }))}
          />
        </label>
        <div className="row wrap">
          <label className="field" style={{ minWidth: 160 }}>
            <span className="meta">Durée de création (minutes)</span>
            <input
              className="input" type="number" min={1} max={720} value={draft.durationMin}
              onChange={(e) => setDraft((d) => ({ ...d, durationMin: Number(e.target.value) }))}
            />
          </label>
          <button
            className="btn primary"
            disabled={busy || !pret}
            aria-busy={busy}
            title={pret ? undefined : 'Dévoile tout le classement d’abord'}
            onClick={() => act('host:next-round', { durationMs: draft.durationMin * 60_000, brief: draft.brief })}
          >
            Lancer la manche {m.round + 1}
          </button>
        </div>
        <span className="meta">
          {pret
            ? (state!.config.mode === 'rebuild'
              ? 'Rendus, votes et chrono repartent de zéro ; chacun reçoit un nouvel extrait.'
              : 'Rendus, votes et chrono repartent de zéro ; créateurs et spectateurs restent.')
            : 'Dévoile tout le classement : la manche est figée à ce moment-là.'}
          {' '}Consigne et éléments imposés se changent d’ici là : la consigne ci-dessus, le pack dans « Éléments imposés ».
        </span>
      </div>
    );
  }

  /** Relancer : memes reglages, meme consigne, pack repris ou non. */
  function renderNextEdition() {
    const hasAssets = (state?.assets.length ?? 0) > 0;
    return (
      <div className={styles.nextEdition}>
        <span className="section-title">Rejouer avec tout le monde</span>
        <div className="row wrap">
          <button className="btn good" disabled={busy} aria-busy={busy} onClick={() => duplicate(true)}>
            <Icon name="chrono" />Nouvelle édition{hasAssets ? ' avec le même pack' : ''}
          </button>
          {hasAssets && (
            <button className="btn sm ghost" disabled={busy} aria-busy={busy} onClick={() => duplicate(false)}>
              Nouvelle édition sans les éléments
            </button>
          )}
        </div>
        <span className="meta">
          Réglages et consigne repris, et tout le monde suit : créateurs, spectateurs et écran de projection
          basculent tout seuls sur la nouvelle session. Rendus et votes repartent de zéro.
        </span>
      </div>
    );
  }

  function renderCreate() {
    return (
      <>
        <header className="topbar">
          <Brand />
          <span className="grow" />
        </header>
        <div className="shell narrow">
          <header>
            <h1 >Nouvelle session</h1>
            <p className="muted">Tout reste modifiable tant que la création n’a pas démarré.</p>
            <p className="muted">
              Première fois ? <a href="/guide" target="_blank" rel="noreferrer">Le guide de l’animateur</a> explique
              une soirée du début à la fin, en cinq minutes de lecture.
            </p>
          </header>
          <section className="card pad col">{renderForm(false)}</section>
        </div>
      </>
    );
  }

  /**
   * Le formulaire de session.
   *
   * Six reglages visibles, ceux qu'un animateur choisit vraiment : le nom, le
   * mode, le nombre de manches, la duree, le type de rendu, la consigne. Les
   * dix autres ont des valeurs par defaut qui conviennent a la plupart des
   * soirees ; ils sont ranges sous « Reglages avances », fermes. Les montrer
   * tous d'emblee faisait de la creation d'une session un questionnaire.
   */
  function renderForm(existing: boolean) {
    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
    // Un remake se rend en son : choisir Rebuild regle le type de rendu, qui
    // reste modifiable juste en dessous.
    const choisirMode = (mode: SessionMode) => setDraft((d) => ({ ...d, mode, ...(mode === 'rebuild' ? { mediaType: 'audio' as MediaType } : {}) }));
    const rebuild = draft.mode === 'rebuild';

    return (
      <>
        <h2 className="section-title">{existing ? 'Réglages' : 'La session'}</h2>

        <div className="field">
          <label htmlFor="name">Nom de la session</label>
          <input
            id="name" className="input" value={draft.name} maxLength={60}
            placeholder={rebuild ? 'Rebuild The Track #1' : 'Beat Battle #12'}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>

        <div className="field">
          <label>Mode</label>
          <div className="seg">
            {MODES.map((m) => (
              <button key={m.id} type="button" aria-pressed={draft.mode === m.id} onClick={() => choisirMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <span className="meta">{MODES.find((m) => m.id === draft.mode)?.hint}</span>
        </div>

        <div className={styles.two}>
          <div className="field">
            <label htmlFor="rounds">Nombre de manches</label>
            <input
              id="rounds" className="input" type="number" min={1} max={10} value={draft.rounds}
              onChange={(e) => set('rounds', Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            />
            <span className="meta">
              {draft.rounds > 1
                ? 'Même code et même écran pour toutes. Le classement général fait la moyenne.'
                : 'Une seule manche : son classement est le classement final.'}
            </span>
          </div>
          <div className="field">
            <label htmlFor="duration">Durée de création (minutes)</label>
            <input
              id="duration" className="input" type="number" min={1} max={720} value={draft.durationMin}
              onChange={(e) => set('durationMin', Number(e.target.value))}
            />
            <span className="meta">
              {draft.rounds > 1 ? 'Pour la manche 1. Tu la règles de nouveau avant chaque manche.' : 'Le chrono part au lancement.'}
            </span>
          </div>
        </div>

        <div className="field">
          <label>Type de rendu attendu</label>
          <div className="media-choice">
            {(Object.keys(MEDIA_LABELS) as MediaType[]).map((type) => (
              <button
                key={type} type="button"
                aria-pressed={draft.mediaType === type}
                onClick={() => set('mediaType', type)}
              >
                <Icon name={MEDIA_LABELS[type].icon} />
                {MEDIA_LABELS[type].label}
              </button>
            ))}
          </div>
          <span className="meta">{MEDIA_LABELS[draft.mediaType].hint}</span>
        </div>

        <div className="field">
          <label htmlFor="brief">{rebuild ? 'Consigne (facultative)' : 'Consigne'}</label>
          <textarea
            id="brief" className="input" rows={rebuild ? 3 : 5} value={draft.brief} maxLength={4000}
            placeholder={rebuild
              ? 'Rien n’est obligatoire ici : l’extrait de chacun fait office de consigne.\nPar exemple : garder le tempo de l’original.'
              : 'Les 5 samples du pack sont obligatoires.\nAucun autre son externe.\nDurée libre.'}
            onChange={(e) => set('brief', e.target.value)}
          />
          <span className="meta">Affichée en permanence aux créateurs.</span>
        </div>

        <details className={styles.avance}>
          <summary>Réglages avancés — les valeurs par défaut conviennent à la plupart des soirées</summary>
          <div className={styles.avanceCorps}>
            <div className={styles.two}>
              <div className="field">
                <label htmlFor="grace">Délai de grâce pour le dépôt (minutes)</label>
                <input
                  id="grace" className="input" type="number" min={0} max={30} value={draft.graceMin}
                  onChange={(e) => set('graceMin', Number(e.target.value))}
                />
                <span className="meta">Le temps laissé après le chrono pour finir de déposer.</span>
              </div>
              <div className="field">
                <label htmlFor="playMax">Durée d’écoute par rendu (secondes)</label>
                <input
                  id="playMax" className="input" type="number" min={5} max={600} value={draft.playMaxS}
                  onChange={(e) => set('playMaxS', Number(e.target.value))}
                />
                <span className="meta">Au-delà, l’extrait est coupé en fondu.</span>
              </div>
            </div>

            <div className={styles.two}>
              <div className="field">
                <label htmlFor="voteWindow">Fenêtre de vote après l’écoute (secondes)</label>
                <input
                  id="voteWindow" className="input" type="number" min={0} max={300} value={draft.voteWindowS}
                  onChange={(e) => set('voteWindowS', Number(e.target.value))}
                />
                <span className="meta">Sautée dès que tout le monde a noté.</span>
              </div>
              <div className="field">
                <label htmlFor="scale">Barème (note maximale)</label>
                <input
                  id="scale" className="input" type="number" min={2} max={100} value={draft.scale}
                  onChange={(e) => set('scale', Number(e.target.value))}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="defaultVote">Note par défaut</label>
              <input
                id="defaultVote" className="input" type="number" min={0} max={draft.scale} step={0.5} value={draft.defaultVote}
                onChange={(e) => set('defaultVote', Number(e.target.value))}
              />
              <span className="meta">Appliquée quand un votant saute un rendu.</span>
            </div>

            <label className="switch">
              <input type="checkbox" checked={draft.autoNext} onChange={(e) => set('autoNext', e.target.checked)} />
              <span className="track" />
              <span>Passer seul au rendu suivant après l’écoute et la fenêtre de vote</span>
            </label>

            <label className="switch">
              <input type="checkbox" checked={draft.playerAudio} onChange={(e) => set('playerAudio', e.target.checked)} />
              <span className="track" />
              <span>Jouer le son sur les téléphones des créateurs et des spectateurs</span>
            </label>
            <span className="faint" style={{ marginTop: 'calc(-1 * var(--sp-2))' }}>
              À couper si une enceinte ou le partage d’écran diffuse déjà pour tout le monde.
            </span>

            <div className="field">
              <label>Alertes sonores</label>
              <div className="row wrap">
                {ALERT_CHOICES.map((sec) => {
                  const on = draft.alerts.includes(sec);
                  return (
                    <button
                      key={sec} type="button"
                      className={`btn xs ${on ? 'good' : 'ghost'}`}
                      aria-pressed={on}
                      onClick={() => set('alerts', on ? draft.alerts.filter((a) => a !== sec) : [...draft.alerts, sec].sort((a, b) => b - a))}
                    >
                      {humanThreshold(sec)}
                    </button>
                  );
                })}
              </div>
              <span className="meta">
                Un signal sonore et un changement de couleur du chrono à chaque seuil coché.
              </span>
            </div>

            <div className="field">
              <label>Dépôts hors délai</label>
              <div className="seg">
                {LATE_POLICIES.map((lp) => (
                  <button
                    key={lp.id} type="button"
                    aria-pressed={draft.latePolicy === lp.id}
                    onClick={() => set('latePolicy', lp.id)}
                  >
                    {lp.label}
                  </button>
                ))}
              </div>
              <span className="meta">
                {LATE_POLICIES.find((lp) => lp.id === draft.latePolicy)?.hint}
              </span>
            </div>

            <label className="switch">
              <input
                type="checkbox" checked={draft.autoAdvance}
                onChange={(e) => set('autoAdvance', e.target.checked)}
              />
              <span className="track" />
              <span>Enchaîner sur la diffusion dès la fin du délai de grâce</span>
            </label>
          </div>
        </details>

        {existing
          ? <button className="btn primary" disabled={busy} aria-busy={busy} onClick={saveConfig}>Enregistrer les réglages</button>
          : <button className="btn primary lg block" disabled={busy || draft.name.trim().length < 2} aria-busy={busy} onClick={create}>
              Créer la session
            </button>}
      </>
    );
  }
}
