'use client';

import { useEffect, useRef, useState } from 'react';

import { clock } from './clock';
import type { DiffusionState } from './types';

export type DiffusionStage = 'play' | 'vote' | 'over' | null;

export interface DiffusionClock {
  /** Ecoute en cours, fenetre de vote, ou termine. */
  stage: DiffusionStage;
  /** Millisecondes avant la fin de l'etape en cours. */
  remainingMs: number;
  seconds: number;
  /** Part restante de l'etape en cours, de 1 a 0. */
  ratio: number;
  /** Secondes deja ecoulees depuis l'ouverture : la position de lecture attendue. */
  elapsedS: number;
}

const IDLE: DiffusionClock = { stage: null, remainingMs: 0, seconds: 0, ratio: 1, elapsedS: 0 };

/**
 * Horloge d'un rendu en diffusion.
 *
 * Meme principe que le chrono de creation : le client ne recoit que des
 * instants et compte lui-meme, sur son horloge recalee. Deux telephones
 * affichent la meme seconde, et le lecteur sait a quelle position il devrait
 * en etre.
 */
export function useDiffusionClock(d: DiffusionState | null): DiffusionClock {
  const [tick, setTick] = useState<DiffusionClock>(IDLE);
  const raf = useRef(0);
  const last = useRef<DiffusionClock>(IDLE);

  const startedAt = d?.startedAt ?? null;
  const endsAt = d?.endsAt ?? null;
  const advanceAt = d?.advanceAt ?? null;
  const key = d?.current?.renditionId ?? null;

  useEffect(() => {
    if (!startedAt || !endsAt || !key) {
      last.current = IDLE;
      setTick(IDLE);
      return;
    }

    const publish = (next: DiffusionClock) => {
      const prev = last.current;
      if (
        next.stage === prev.stage
        && next.seconds === prev.seconds
        && Math.abs(next.ratio - prev.ratio) < 0.004
        && Math.abs(next.elapsedS - prev.elapsedS) < 0.25
      ) return;
      last.current = next;
      setTick(next);
    };

    const step = () => {
      const now = clock.now();
      const elapsedS = Math.max(0, (now - startedAt) / 1000);

      if (now < endsAt) {
        const remainingMs = endsAt - now;
        publish({
          stage: 'play',
          remainingMs,
          seconds: Math.ceil(remainingMs / 1000),
          ratio: Math.max(0, Math.min(1, remainingMs / (endsAt - startedAt))),
          elapsedS,
        });
      } else if (advanceAt === null) {
        // Manuel : la fenetre de vote reste ouverte tant que la regie n'avance pas.
        publish({ stage: 'vote', remainingMs: 0, seconds: 0, ratio: 1, elapsedS });
      } else if (now < advanceAt) {
        const remainingMs = advanceAt - now;
        publish({
          stage: 'vote',
          remainingMs,
          seconds: Math.ceil(remainingMs / 1000),
          ratio: Math.max(0, Math.min(1, remainingMs / Math.max(1, advanceAt - endsAt))),
          elapsedS,
        });
      } else {
        publish({ stage: 'over', remainingMs: 0, seconds: 0, ratio: 0, elapsedS });
      }

      raf.current = requestAnimationFrame(step);
    };

    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [startedAt, endsAt, advanceAt, key]);

  return tick;
}
