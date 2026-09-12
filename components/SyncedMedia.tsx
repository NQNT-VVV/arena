'use client';

import { useEffect, useRef, useState } from 'react';

import { clock } from '@/lib/clock';
import styles from './SyncedMedia.module.css';

/**
 * Lecteur cale sur l'horloge du serveur.
 *
 * Il ne demarre pas « quand la page l'a recu » mais a la position que dicte
 * l'instant d'ouverture : quelqu'un qui arrive avec quatre secondes de retard
 * entend la cinquieme seconde, comme tout le monde. Il s'arrete a l'instant de
 * fin, avec un fondu, et se recale s'il derive.
 *
 * Un seul element media, jamais remplace. Sur iOS, un element que l'on a
 * lance a la main garde le droit de jouer tout seul ensuite ; un element neuf
 * le perd. Changer la source d'un lecteur unique, c'est ce qui permet au
 * deuxieme rendu de demarrer sans nouveau geste.
 *
 * Quand le navigateur refuse le demarrage — aucun geste encore sur la page —
 * un bouton le propose. Un seul clic suffit pour toute la soiree.
 */
export function SyncedMedia({
  src,
  kind,
  startedAt,
  endsAt,
  fadeSeconds,
  enabled,
  large = false,
}: {
  src: string;
  kind: 'audio' | 'video';
  startedAt: number;
  endsAt: number;
  fadeSeconds: number;
  /** Faux : le lecteur reste muet et ne demarre rien — une enceinte s'en charge ailleurs. */
  enabled: boolean;
  large?: boolean;
}) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [over, setOver] = useState(false);

  /** Position attendue, en secondes, a cet instant. */
  const expected = () => Math.max(0, (clock.now() - startedAt) / 1000);

  const tryPlay = async () => {
    const el = ref.current;
    if (!el || !enabled) return;
    try {
      await el.play();
      setBlocked(false);
    } catch {
      // Politique de lecture automatique : il faut un geste. On le demande.
      setBlocked(true);
    }
  };

  // Nouvelle source, ou nouvelle ouverture du meme rendu : on se cale et on part.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOver(false);
    el.volume = 1;

    const seekAndPlay = () => {
      const at = expected();
      if (clock.now() >= endsAt) { setOver(true); return; }
      // Au-dela de la duree du fichier, il n'y a rien a entendre : on laisse le
      // silence jusqu'a la fin de la fenetre.
      if (Number.isFinite(el.duration) && at >= el.duration) { setOver(true); return; }
      try { el.currentTime = at; } catch { /* metadonnees pas encore la */ }
      if (enabled) void tryPlay();
    };

    if (el.readyState >= 1) seekAndPlay();
    else el.addEventListener('loadedmetadata', seekAndPlay, { once: true });
    return () => el.removeEventListener('loadedmetadata', seekAndPlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, startedAt, enabled]);

  // Boucle : fondu, arret a l'instant de fin, recalage en cas de derive.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let lastCorrection = 0;

    const step = () => {
      const now = clock.now();
      const left = (endsAt - now) / 1000;

      if (left <= 0) {
        if (!el.paused) el.pause();
        setOver(true);
        return; // fin : plus rien a faire jusqu'a la prochaine ouverture
      }

      // Fondu sur les dernieres secondes. iOS ignore l'ecriture du volume :
      // la coupure y reste nette, l'arret fonctionne quand meme.
      el.volume = fadeSeconds > 0 && left < fadeSeconds ? Math.max(0, Math.min(1, left / fadeSeconds)) : 1;

      // Recalage : une mise en veille, un onglet en arriere-plan, un reseau
      // lent font deriver la lecture. Au-dela d'une seconde, on se realigne —
      // pas en dessous, un saut permanent serait pire que le decalage.
      if (enabled && !el.paused && el.readyState >= 3 && now - lastCorrection > 2000) {
        const drift = el.currentTime - expected();
        if (Math.abs(drift) > 1) {
          el.currentTime = expected();
          lastCorrection = now;
        }
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, startedAt, endsAt, fadeSeconds, enabled]);

  // Son coupe sur cet appareil : on arrete, sans perdre la position attendue.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled && !el.paused) el.pause();
  }, [enabled]);

  const unlock = async () => {
    const el = ref.current;
    if (!el) return;
    try { el.currentTime = expected(); } catch { /* pas encore pret */ }
    await tryPlay();
  };

  const media = kind === 'video' ? (
    <video
      ref={ref as React.RefObject<HTMLVideoElement>}
      className={`${styles.video} ${large ? styles.large : ''}`}
      src={src}
      controls
      playsInline
      preload="auto"
      muted={!enabled}
    />
  ) : (
    <audio
      ref={ref as React.RefObject<HTMLAudioElement>}
      className={styles.audio}
      src={src}
      controls
      preload="auto"
      muted={!enabled}
    />
  );

  return (
    <div className={styles.wrap}>
      {media}
      {enabled && blocked && !over && (
        <button className={`btn primary ${large ? 'lg' : ''} ${styles.unlock}`} onClick={unlock}>
          🔊 Lancer l&apos;ecoute
        </button>
      )}
      {!enabled && (
        <span className={styles.note}>Son coupe sur cet appareil.</span>
      )}
      {over && enabled && (
        <span className={styles.note}>Ecoute terminee.</span>
      )}
    </div>
  );
}
