'use client';

import { useEffect, useRef, useState } from 'react';

import { clock } from './clock';
import type { BattleState } from './types';

export type ChronoTone = 'calm' | 'warn' | 'danger' | 'over' | 'paused';

export interface PhaseClock {
  /** Quelle echeance court : le temps de creation, ou la fenetre de grace. */
  kind: 'creation' | 'grace' | null;
  remainingMs: number;
  seconds: number;
  /** Deja formate : « 42:07 », ou « 1:12:30 » au-dela de l'heure. */
  label: string;
  /** Part de temps restante, de 1 a 0. */
  ratio: number;
  tone: ChronoTone;
  running: boolean;
  paused: boolean;
}

const IDLE: PhaseClock = {
  kind: null, remainingMs: 0, seconds: 0, label: '--:--',
  ratio: 1, tone: 'calm', running: false, paused: false,
};

function format(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Compte a rebours pilote par les horodatages du serveur.
 *
 * Le client ne recoit jamais « il reste douze minutes » mais « la creation
 * s'arrete a tel instant ». Il soustrait ce que dit `clock.now()`, c'est-a-dire
 * son horloge locale corrigee de sa derive mesuree contre le serveur. Deux
 * telephones desynchronises d'une seconde affichent quand meme la meme.
 *
 * `onAlert` est appele au franchissement d'un seuil, `onEnd` au passage a zero.
 * La detection se fait par comparaison avec la valeur precedente plutot que par
 * une liste de seuils deja joues : quand l'animateur rallonge le temps, le
 * compte a rebours repasse au-dessus du seuil, et l'alerte doit se redeclencher
 * a la seconde traversee. Une liste de « deja joue » l'aurait avalee.
 */
export function usePhaseClock(
  state: BattleState | null,
  handlers: { onAlert?: (secondsLeft: number) => void; onEnd?: () => void } = {},
): PhaseClock {
  const [tick, setTick] = useState<PhaseClock>(IDLE);
  const raf = useRef(0);
  const last = useRef<PhaseClock>(IDLE);
  const previousMs = useRef<number | null>(null);

  // Les callbacks changent a chaque rendu de la page ; les garder dans une
  // reference evite de relancer la boucle d'animation pour autant.
  const cbs = useRef(handlers);
  cbs.current = handlers;

  /**
   * Ne redessine que si l'affichage bouge vraiment.
   *
   * Sans ce filtre, la boucle rend soixante fois par seconde une interface qui
   * ne change qu'une fois par seconde — sur la regie, cela veut dire reparcourir
   * la liste des participants a chaque image.
   */
  const publish = (next: PhaseClock) => {
    const prev = last.current;
    if (
      next.seconds === prev.seconds
      && next.tone === prev.tone
      && next.kind === prev.kind
      && next.paused === prev.paused
      && next.running === prev.running
      && Math.abs(next.ratio - prev.ratio) < 0.004
    ) return;
    last.current = next;
    setTick(next);
  };

  const phase = state?.phase;
  const c = state?.clock;
  const createEndAt = c?.createEndAt ?? null;
  const graceEndAt = c?.graceEndAt ?? null;
  const pausedAt = c?.pausedAt ?? null;
  const frozenMs = c?.remainingMs ?? null;
  const durationMs = c?.durationMs ?? 0;
  const graceMs = c?.graceMs ?? 0;
  const alertsKey = (c?.alerts ?? []).join(',');

  useEffect(() => {
    const isCreation = phase === 'creation';
    const isGrace = phase === 'upload';
    if (!isCreation && !isGrace) {
      previousMs.current = null;
      publish(IDLE);
      return;
    }

    const kind = isCreation ? 'creation' : 'grace';
    const total = Math.max(1, isCreation ? durationMs : graceMs);
    const alerts = alertsKey ? alertsKey.split(',').map(Number) : [];
    const endAt = isCreation ? createEndAt : graceEndAt;
    const paused = isCreation && !!pausedAt;

    // Les couleurs suivent la duree de la phase : trente secondes ne veulent pas
    // dire la meme chose sur une battle de cinq minutes et sur une de deux heures.
    const warnAt = Math.min(120_000, total * 0.2);
    const dangerAt = Math.min(30_000, total * 0.05);

    const step = () => {
      const remainingMs = paused
        ? Math.max(0, frozenMs ?? 0)
        : Math.max(0, (endAt ?? 0) - clock.now());

      // Franchissements : uniquement quand le temps descend.
      const before = previousMs.current;
      previousMs.current = remainingMs;
      if (before !== null && before > remainingMs) {
        // Au retour d'un onglet mis en veille, plusieurs seuils peuvent avoir
        // ete traverses d'un coup. On ne joue que le plus urgent : une rafale
        // de bips ne renseigne personne.
        let crossed: number | null = null;
        for (const t of alerts) {
          const ms = t * 1000;
          if (before > ms && remainingMs <= ms) crossed = crossed === null ? t : Math.min(crossed, t);
        }
        if (crossed !== null) cbs.current.onAlert?.(crossed);
        if (before > 0 && remainingMs <= 0) cbs.current.onEnd?.();
      }

      let tone: ChronoTone = 'calm';
      if (paused) tone = 'paused';
      else if (remainingMs <= 0) tone = 'over';
      else if (remainingMs <= dangerAt) tone = 'danger';
      else if (remainingMs <= warnAt) tone = 'warn';

      publish({
        kind,
        remainingMs,
        seconds: Math.ceil(remainingMs / 1000),
        label: format(remainingMs),
        ratio: Math.max(0, Math.min(1, remainingMs / total)),
        tone,
        running: !paused && remainingMs > 0,
        paused,
      });

      raf.current = requestAnimationFrame(step);
    };

    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [phase, createEndAt, graceEndAt, pausedAt, frozenMs, durationMs, graceMs, alertsKey]);

  return tick;
}
