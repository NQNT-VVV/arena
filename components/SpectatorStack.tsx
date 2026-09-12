'use client';

import { useEffect, useRef, useState } from 'react';

import type { SpectatorStackEntry } from '@/lib/types';
import styles from './SpectatorStack.module.css';

type Props = {
  entries: SpectatorStackEntry[];
  meId: string;
  onStack: () => Promise<void>;
};

/**
 * Petit jeu de precision sans dependance : on touche l'ecran pour poser la
 * brique mobile. Le score partage reste calcule par le serveur.
 */
export function SpectatorStack({ entries, meId, onStack }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  const directionRef = useRef(1);
  const [offset, setOffset] = useState(0);
  const [base, setBase] = useState(0);
  const [level, setLevel] = useState(0);
  const [fallen, setFallen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const width = Math.max(42, 116 - level * 5);

  useEffect(() => {
    if (fallen || sending) return;
    const tick = (now: number) => {
      const previous = lastRef.current ?? now;
      lastRef.current = now;
      const rail = railRef.current?.clientWidth ?? 280;
      const max = Math.max(0, rail - width);
      let next = offset + directionRef.current * (now - previous) * (0.16 + level * 0.006);
      if (next >= max) { next = max; directionRef.current = -1; }
      if (next <= 0) { next = 0; directionRef.current = 1; }
      setOffset(next);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); lastRef.current = null; };
  }, [fallen, sending, width, level, offset]);

  const stack = async () => {
    if (fallen || sending) return;
    const overlap = Math.min(base + width, offset + width) - Math.max(base, offset);
    if (overlap < width * 0.42) {
      setFallen(true);
      return;
    }
    setSending(true);
    try {
      await onStack();
      setBase(offset);
      setLevel((value) => value + 1);
    } catch {
      setError('La pose n’a pas ete comptee. Reessaie.');
    } finally {
      setSending(false);
    }
  };

  const restart = () => {
    directionRef.current = 1;
    setOffset(0); setBase(0); setLevel(0); setFallen(false); setError(null);
  };
  const mine = entries.find((entry) => entry.id === meId)?.score ?? 0;

  return (
    <section className={styles.game} aria-label="Mini-jeu d'empilement des spectateurs">
      <div className={styles.heading}>
        <div><span className={styles.kicker}>Entre spectateurs</span><h2>Tour d&apos;empilement</h2></div>
        <strong>{mine} brique{mine > 1 ? 's' : ''}</strong>
      </div>
      <p className="muted">Tape quand la brique passe au-dessus de la tour. Chaque pose reussie compte pour le classement.</p>
      <div className={styles.board} ref={railRef}>
        <div className={styles.tower} style={{ transform: `translateX(${base}px)`, width }} />
        <button
          className={styles.block}
          type="button"
          aria-label="Poser la brique"
          disabled={sending || fallen}
          onClick={() => void stack()}
          style={{ transform: `translateX(${offset}px)`, width }}
        >
          {sending ? '…' : 'POSER'}
        </button>
        {fallen && <button type="button" className={styles.restart} onClick={restart}>La tour tombe — rejouer</button>}
      </div>
      <ol className={styles.ranking}>
        {entries.length === 0 ? <li>En attente d&apos;un autre spectateur…</li> : entries.slice(0, 5).map((entry, index) => (
          <li key={entry.id} className={entry.id === meId ? styles.me : ''}>
            <span>{index + 1}. {entry.avatar} {entry.pseudo}</span><b>{entry.score}</b>
          </li>
        ))}
      </ol>
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
