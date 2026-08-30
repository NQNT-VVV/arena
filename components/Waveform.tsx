'use client';

import { useEffect, useRef, useState } from 'react';

import styles from './Waveform.module.css';

/**
 * Forme d'onde, a partir des cretes calculees par le serveur.
 *
 * Aucun decodage cote client : huit cents nombres suffisent a dessiner une
 * silhouette, et ils pesent quelques kilo-octets quelle que soit la duree du
 * morceau. La tete de lecture suit `progress`, qui vient de l'horloge
 * synchronisee — pas de l'element audio, dont la position peut deriver.
 */
export function Waveform({
  peaksUrl,
  progress,
  large = false,
}: {
  peaksUrl: string;
  /** Part deja ecoutee, de 0 a 1. */
  progress: number;
  large?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    fetch(peaksUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && Array.isArray(data)) setPeaks(data); })
      .catch(() => { if (!cancelled) setPeaks(null); });
    return () => { cancelled = true; };
  }, [peaksUrl]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !peaks) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (!width || !height) return;
      if (el.width !== width * dpr || el.height !== height * dpr) {
        el.width = width * dpr;
        el.height = height * dpr;
      }
      const ctx = el.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Une barre par colonne de pixels au maximum : au-dela, on echantillonne.
      const bars = Math.min(peaks.length, Math.floor(width / 3));
      const step = peaks.length / bars;
      const barWidth = width / bars;
      const mid = height / 2;
      const played = Math.floor(bars * Math.max(0, Math.min(1, progress)));

      for (let i = 0; i < bars; i++) {
        // Crete maximale de la tranche : une moyenne ecraserait les transitoires,
        // et c'est justement eux qui font reconnaitre un morceau a l'oeil.
        let peak = 0;
        const from = Math.floor(i * step);
        const to = Math.max(from + 1, Math.floor((i + 1) * step));
        for (let j = from; j < to && j < peaks.length; j++) if (peaks[j] > peak) peak = peaks[j];

        const h = Math.max(2, peak * (height - 4));
        const x = i * barWidth;
        ctx.fillStyle = i < played ? 'rgba(139, 92, 246, .95)' : 'rgba(255, 255, 255, .22)';
        ctx.beginPath();
        ctx.roundRect(x + barWidth * 0.18, mid - h / 2, barWidth * 0.64, h, 1.5);
        ctx.fill();
      }

      // Tete de lecture.
      if (progress > 0 && progress < 1) {
        const x = width * progress;
        ctx.fillStyle = 'rgba(34, 211, 238, .95)';
        ctx.fillRect(x - 1, 0, 2, height);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => observer.disconnect();
  }, [peaks, progress]);

  return (
    <canvas
      ref={canvas}
      className={`${styles.wave} ${large ? styles.large : ''} ${peaks ? '' : styles.loading}`}
      aria-hidden="true"
    />
  );
}
