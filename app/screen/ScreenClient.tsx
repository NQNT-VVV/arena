'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { Brand } from '@/components/Brand';
import { DiffusionStage } from '@/components/DiffusionStage';
import { Podium } from '@/components/Podium';
import { Chrono } from '@/components/Chrono';
import { JoinForm } from '@/components/JoinForm';
import { QrCode } from '@/components/QrCode';
import { humanDuration, PHASE_LABELS } from '@/lib/format';
import { call } from '@/lib/socket';
import { MEDIA_LABELS } from '@/lib/types';
import { useBattleSocket } from '@/lib/useBattleSocket';
import { usePhaseClock } from '@/lib/usePhaseClock';
import styles from './screen.module.css';

/**
 * Grand ecran.
 *
 * Aucun controle, aucune donnee nominative de plus que chez un participant :
 * cette page finit en partage d'ecran Discord ou dans OBS, parfois devant des
 * gens qui ne participent pas. Elle n'a que ce qu'il faut pour etre lue a cinq
 * metres.
 */
export function ScreenClient() {
  const params = useSearchParams();
  const code = (params.get('code') || '').toUpperCase();
  const [error, setError] = useState<string | null>(null);

  const attach = useCallback(async (socket: Socket) => {
    if (!code) return;
    const res = await call(socket, 'screen:attach', { code });
    setError(res.ok ? null : res.error);
  }, [code]);

  const { state, connected } = useBattleSocket(attach);
  const chrono = usePhaseClock(state);

  const inviteUrl = useMemo(
    () => (code && typeof window !== 'undefined' ? `${window.location.origin}/j/${code}` : ''),
    [code],
  );

  // Un videoprojecteur ne doit pas se mettre en veille au milieu d'une battle.
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) { void next.release(); return; }
        lock = next;
      } catch { /* refuse par le navigateur ou onglet en arriere-plan */ }
    };
    void acquire();

    // Le verrou saute des que l'onglet passe en arriere-plan : on le reprend au retour.
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, []);

  if (!code) {
    return (
      <div className="screen-stage">
        <Brand href={null} />
        <h1 className="title">Ecran de projection</h1>
        <p className="muted">Saisis le code de la session a afficher.</p>
        <div style={{ width: 'min(340px, 90vw)' }}>
          <JoinForm className="col" inputClassName={styles.codeInput} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen-stage">
        <Brand href={null} />
        <h1 className="title">{error}</h1>
        <p className="muted">Code demande : <b>{code}</b></p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="screen-stage">
        <span className="pill"><span className="dot" /> {connected ? 'Chargement…' : 'Connexion…'}</span>
      </div>
    );
  }

  const media = MEDIA_LABELS[state.mediaType];

  return (
    <div className="screen-stage">
      <div className={styles.head}>
        <Brand href={null} compact />
        <span className="pill">{media.icon} {media.label}</span>
        <span className="pill">{PHASE_LABELS[state.phase]}</span>
        {!connected && <span className="pill live"><span className="dot" /> Hors ligne</span>}
      </div>

      <h1 className="title">{state.name}</h1>

      {(state.phase === 'config' || state.phase === 'lobby') && (
        <>
          <p className={styles.invite}>Rejoignez sur <b>{inviteUrl.replace(/^https?:\/\//, '')}</b></p>
          <span className="join-code code-chip">{state.code}</span>
          {inviteUrl && <QrCode text={inviteUrl} className="screen-qr" />}
          <p className={styles.count}>
            <b>{state.counts.participants}</b> participant{state.counts.participants > 1 ? 's' : ''}
            {state.counts.participants > 0 && ` • ${state.counts.connected} en ligne`}
          </p>
          <p className="muted">
            {humanDuration(state.config.durationMs)} de creation
            {state.assets.length > 0 && ` • ${state.assets.length} element${state.assets.length > 1 ? 's' : ''} impose${state.assets.length > 1 ? 's' : ''}`}
          </p>
        </>
      )}

      {(state.phase === 'creation' || state.phase === 'upload') && (
        <>
          <Chrono clock={chrono} />
          <p className={styles.brief}>{state.brief}</p>
          <p className={styles.count}>
            <b>{state.counts.submitted}</b> rendu{state.counts.submitted > 1 ? 's' : ''} sur {state.counts.participants}
          </p>
        </>
      )}

      {state.phase === 'diffusion' && state.diffusion && (
        <div className={styles.wide}>
          {/* Aucun controle et aucun vote : cet ecran est regarde, pas touche. */}
          <DiffusionStage diffusion={state.diffusion} config={state.config} votes={{}} isMine={false} large />
        </div>
      )}

      {(state.phase === 'results' || state.phase === 'archived') && state.podium && (
        <div className={styles.wide}>
          <span className={styles.bigIcon} aria-hidden="true">🏆</span>
          <Podium podium={state.podium} large />
        </div>
      )}
    </div>
  );
}
