'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { Brand } from '@/components/Brand';
import { Chrono } from '@/components/Chrono';
import { JoinForm } from '@/components/JoinForm';
import { PhaseRail } from '@/components/PhaseRail';
import { identity } from '@/lib/identity';
import { humanDuration, humanThreshold, PHASE_LABELS } from '@/lib/format';
import { sfx } from '@/lib/sfx';
import { call } from '@/lib/socket';
import { toast } from '@/lib/toast';
import { MEDIA_LABELS, type SessionCard } from '@/lib/types';
import { useBattleSocket } from '@/lib/useBattleSocket';
import { usePhaseClock } from '@/lib/usePhaseClock';
import styles from './play.module.css';

export function PlayClient() {
  const params = useSearchParams();
  const code = (params.get('code') || '').toUpperCase();

  const [card, setCard] = useState<SessionCard | null>(null);
  const [pseudo, setPseudo] = useState('');
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Entree dans la session.
   *
   * Rejouee a chaque connexion. Si le navigateur a garde une identite, la
   * reprise est automatique : c'est ce qui fait qu'un rafraichissement, un
   * passage en veille ou un tunnel de metro ne coutent pas sa place.
   */
  const enter = useCallback(async (socket: Socket, withPseudo?: string) => {
    if (!code) return;
    const saved = identity.get(code);
    const name = withPseudo ?? saved?.pseudo;
    if (!name) return;

    const res = await call<{ token: string; participantId: string }>(socket, 'play:join', {
      code,
      pseudo: name,
      participantId: saved?.participantId,
      token: saved?.token,
    });

    if (!res.ok) {
      // Une identite refusee est une identite perimee : on l'efface pour que la
      // page repropose le formulaire au lieu de boucler sur le meme refus.
      if (saved) identity.clear(code);
      setError(res.error);
      setJoined(false);
      return;
    }

    identity.save(code, { participantId: res.participantId, token: res.token, pseudo: name });
    setError(null);
    setJoined(true);
  }, [code]);

  const { socket, state, you, connected } = useBattleSocket((s) => enter(s));

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

  useEffect(() => {
    const saved = code ? identity.get(code) : null;
    if (saved) setPseudo(saved.pseudo);
  }, [code]);

  const join = async () => {
    if (!socket) return;
    // Le clic sur « Entrer » est le geste qui debloque le son : sans lui, les
    // alertes de fin de temps ne sortiraient jamais du navigateur.
    sfx.unlock();
    setBusy(true);
    await enter(socket, pseudo.trim());
    setBusy(false);
  };

  const leave = () => {
    if (socket) void call(socket, 'play:leave');
    if (code) identity.clear(code);
    setJoined(false);
    setError(null);
  };

  /* ------------------------------ rendu ----------------------------- */

  if (!code) {
    return (
      <div className={styles.gate}>
        <Brand />
        <h1>Rejoindre une battle</h1>
        <p className="muted">Saisis le code annonce par l&apos;animateur.</p>
        <JoinForm className="col" inputClassName={styles.codeInput} />
      </div>
    );
  }

  if (card && !card.exists) {
    return (
      <div className={styles.gate}>
        <Brand />
        <h1>Code inconnu</h1>
        <p className="muted">La session <b>{code}</b> n&apos;existe pas, ou elle est terminee.</p>
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
            ? `${MEDIA_LABELS[card.mediaType].icon} Rendu attendu : ${MEDIA_LABELS[card.mediaType].label.toLowerCase()}`
            : 'Chargement…'}
        </p>
        {card && !card.open && (
          <p className="pill" style={{ color: '#ffb4b4' }}>Les inscriptions sont fermees.</p>
        )}
        <div className="field" style={{ width: '100%' }}>
          <label htmlFor="pseudo">Ton pseudo</label>
          <input
            id="pseudo" className="input" value={pseudo} maxLength={22}
            placeholder="Comment on t’appelle ?"
            autoComplete="nickname"
            onChange={(e) => setPseudo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void join(); }}
          />
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <button
          className="btn primary lg block"
          disabled={busy || pseudo.trim().length < 2 || !connected}
          onClick={join}
        >
          {connected ? 'Entrer' : 'Connexion…'}
        </button>
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
          <span className="faint" style={{ fontSize: 12 }}>{PHASE_LABELS[phase]}</span>
        </span>
        {you && (
          <span className="pill">
            <span aria-hidden="true">{you.avatar}</span>
            <span className="ellipsis" style={{ maxWidth: 90 }}>{you.pseudo}</span>
          </span>
        )}
        {!connected && <span className="pill live"><span className="dot" /> Hors ligne</span>}
      </header>

      <div className="shell narrow">
        <PhaseRail phase={phase} />

        {you?.disqualified && (
          <p className={styles.error}>
            Tu as ete mis hors classement par l&apos;animateur. Tu peux continuer a suivre la session.
          </p>
        )}

        <section className={`card pad ${styles.stage}`}>{renderStage()}</section>

        <section className="card pad col">
          <h2 className="section-title">Consigne</h2>
          <p className="brief">{state.brief}</p>
          <div className="row wrap faint" style={{ fontSize: 12.5 }}>
            <span>{MEDIA_LABELS[state.mediaType].icon} {MEDIA_LABELS[state.mediaType].label}</span>
            <span>•</span>
            <span>{humanDuration(state.config.durationMs)}</span>
            <span>•</span>
            <span>note sur {state.config.scale}</span>
          </div>
        </section>

        <section className="card pad col">
          <h2 className="section-title">Dans l&apos;arene ({state.counts.participants})</h2>
          {state.roster.length === 0
            ? <p className="empty">Tu es le premier.</p>
            : (
              <div className="roster">
                {state.roster.map((p) => (
                  <div key={p.id} className={`roster-row ${p.connected ? '' : 'off'} ${p.disqualified ? 'dq' : ''}`}>
                    <span className="avatar" aria-hidden="true">{p.avatar}</span>
                    <span className="who grow">
                      <span className="pseudo ellipsis">{p.pseudo}{p.id === you?.id ? ' (toi)' : ''}</span>
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

  function renderStage() {
    switch (phase) {
      case 'config':
      case 'lobby':
        return (
          <div className={styles.waiting}>
            <span className={styles.bigIcon} aria-hidden="true">{MEDIA_LABELS[state!.mediaType].icon}</span>
            <h2>En attente du depart</h2>
            <p className="muted">
              Lis la consigne, prepare ton materiel. L&apos;animateur lance le chrono quand tout le monde est la.
            </p>
            <p className="faint" style={{ fontSize: 12.5 }}>
              Tu auras {humanDuration(state!.config.durationMs)} pour creer.
            </p>
          </div>
        );
      case 'creation':
        return (
          <>
            <Chrono clock={chrono} />
            <p className="muted" style={{ textAlign: 'center' }}>
              {chrono.paused
                ? 'L’animateur a mis le chrono en pause.'
                : 'Tu peux deposer ton rendu des qu’il est pret, sans attendre la fin.'}
            </p>
          </>
        );
      case 'upload':
        return (
          <>
            <Chrono clock={chrono} hint="Derniere ligne droite" />
            <p className="muted" style={{ textAlign: 'center' }}>
              Le temps de creation est ecoule. Il reste la fenetre de grace pour finaliser ton depot.
            </p>
          </>
        );
      case 'diffusion':
        return (
          <div className={styles.waiting}>
            <span className={styles.bigIcon} aria-hidden="true">🕶️</span>
            <h2>Diffusion en cours</h2>
            <p className="muted">Les rendus defilent en aveugle. La notation arrive avec la suite du chantier.</p>
          </div>
        );
      case 'results':
        return (
          <div className={styles.waiting}>
            <span className={styles.bigIcon} aria-hidden="true">🏆</span>
            <h2>Resultats</h2>
            <p className="muted">Le classement s&apos;affiche ici une fois la notation branchee.</p>
          </div>
        );
      default:
        return (
          <div className={styles.waiting}>
            <span className={styles.bigIcon} aria-hidden="true">📦</span>
            <h2>Session terminee</h2>
            <p className="muted">Merci d&apos;avoir joue.</p>
          </div>
        );
    }
  }
}
