'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { audioPref } from '@/lib/audioPref';
import { Brand } from '@/components/Brand';
import { DiffusionStage } from '@/components/DiffusionStage';
import { ChaineLue } from '@/components/Chaine';
import { Podium } from '@/components/Podium';
import { RouletteScreen } from '@/components/Roulette';
import { Chrono } from '@/components/Chrono';
import { JoinForm } from '@/components/JoinForm';
import { QrCode } from '@/components/QrCode';
import { humanDuration, PHASE_LABELS } from '@/lib/format';
import { hex } from '@/lib/hex';
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
 *
 * C'est l'ecran que tout le monde regarde : il porte l'univers. Barre systeme
 * en haut, code de session en Archivo display, quarante pour cent de vide.
 */
export function ScreenClient() {
  const params = useSearchParams();
  const code = (params.get('code') || '').toUpperCase();
  const [error, setError] = useState<string | null>(null);
  // Le grand ecran joue le son par defaut : c'est souvent lui qui est branche
  // sur l'enceinte, ou capture dans le partage d'ecran.
  const [audio, setAudio] = useState(true);
  useEffect(() => { const saved = audioPref.get('screen'); if (saved !== null) setAudio(saved); }, []);
  const chooseAudio = (on: boolean) => { audioPref.set('screen', on); setAudio(on); };

  const attach = useCallback(async (socket: Socket) => {
    if (!code) return;
    const res = await call(socket, 'screen:attach', { code });
    setError(res.ok ? null : res.error);
  }, [code]);

  const { state, connected, ratings } = useBattleSocket(attach);
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
        <h1 className="title">ECRAN DE PROJECTION</h1>
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
        <h1 className="title">{error.toUpperCase()}</h1>
        <p className="muted">CODE DEMANDE · <b>{code}</b></p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="screen-stage">
        <span className="pill"><span className="dot" /> {connected ? 'CHARGEMENT' : 'CONNEXION'}</span>
      </div>
    );
  }

  const media = MEDIA_LABELS[state.mediaType];

  return (
    <div className="screen-stage">
      <div className={styles.head}>
        <span>SALLE {state.code}</span>
        <span>RENDU {media.icon} · {media.label}</span>
        <span>{PHASE_LABELS[state.phase]}</span>
        {/* Le compte des tirages est sur l'ecran de la salle, pas seulement en
            regie : une roue qu'on relance en secret n'a aucune autorite. */}
        {state.roulette.spins > 0 && <span>TIRAGES {hex(state.roulette.spins)}</span>}
        <span className="seats" aria-label={`${state.counts.connected} sujets en ligne sur ${state.counts.participants}`}>
          {Array.from({ length: Math.max(state.counts.participants, 1) }, (_, i) => (
            <span key={i} className={i < state.counts.connected ? 'on' : ''} />
          ))}
        </span>
        {!connected && <span className="live">HORS LIGNE · RECONNEXION</span>}
      </div>

      <h1 className="title">{state.name}</h1>

      {(state.phase === 'config' || state.phase === 'lobby') && (
        <>
          <p className={styles.invite}>REJOIGNEZ SUR <b>{inviteUrl.replace(/^https?:\/\//, '')}</b></p>
          <span className={styles.joinCode}>{state.code}</span>
          {inviteUrl && <QrCode text={inviteUrl} className="screen-qr" />}
          <p className={styles.count}>
            SUJETS <b>{hex(state.counts.participants)}</b>
            {state.counts.participants > 0 && ` · ${hex(state.counts.connected)} EN LIGNE`}
          </p>
          <p className="muted">
            {humanDuration(state.config.durationMs).toUpperCase()} DE CREATION
            {state.assets.length > 0 && ` · ${hex(state.assets.length)} ELEMENT(S) IMPOSE(S)`}
          </p>
        </>
      )}

      {(state.phase === 'creation' || state.phase === 'upload') && (
        <>
          <Chrono clock={chrono} />
          <p className={styles.brief}>{state.brief}</p>
          <p className={styles.count}>
            RENDUS <b>{hex(state.counts.submitted)}</b> / {hex(state.counts.participants)}
          </p>
        </>
      )}

      {state.phase === 'diffusion' && state.diffusion && (
        <div className={styles.wide}>
          {/* Aucun controle et aucun vote : cet ecran est regarde, pas touche. */}
          <DiffusionStage
            diffusion={state.diffusion}
            config={state.config}
            votes={{}}
            isMine={false}
            large
            audio={audio}
            onToggleAudio={chooseAudio}
          />
        </div>
      )}

      {(state.phase === 'results' || state.phase === 'archived') && state.podium && (
        <div className={styles.wide}>
          <span className={styles.bigIcon}>CLASSEMENT FINAL · {hex(state.podium.total ?? 0)} RENDUS</span>
          <Podium podium={state.podium} large ratings={ratings} />
        </div>
      )}

      {/* LA ROULETTE. Le devoilement passe par un voile, puis le tirage reste
          sur la page : c'est la consigne en cours, on doit pouvoir la relire. */}
      {state.roulette.last && (
        <div className={styles.wide}>
          <RouletteScreen roulette={state.roulette} roster={state.roster} />
        </div>
      )}

      {/* Ce que les spectateurs ont ecrit pendant la creation. Sur l'ecran de
          la salle, quelqu'un finit toujours par le lire a voix haute. */}
      {(state.phase === 'results' || state.phase === 'archived') && (
        <div className={styles.wide}><ChaineLue chain={state.chain} /></div>
      )}
    </div>
  );
}
