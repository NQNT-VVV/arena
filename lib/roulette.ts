/**
 * LA ROULETTE — la mise en phrase d'un tirage.
 *
 * Ce module ne decide de rien et ne declare aucune regle : le serveur tranche,
 * et chaque sort arrive avec l'etat de chacun de ses effets (`pointsApplied`,
 * `chronoApplied`). Il ne reste ici que de la presentation — mettre un effet en
 * mots, et dire ce que l'interface a le droit d'affirmer.
 *
 * Les deux fonctions de PREVISION sont l'exception, et elles ne devinent pas :
 * elles lisent `rouletteRules`, que `hostView` envoie. Prevenir avant un
 * tirage de ce que le mode ne pourra pas faire est le seul cas ou la page a
 * besoin de la regle — apres, elle lit ce qui s'est passe.
 */

import { humanDuration } from './format';
import { hex } from './hex';
import type { Phase, RouletteRules, Spin, SpinTarget } from './types';

/** Un effet du sort, et s'il a vraiment joue. */
export interface Effect {
  text: string;
  applied: boolean;
}

/**
 * Les effets d'un sort, un par un.
 *
 * Separes plutot que resumes : un sort peut couter des points et donner du
 * temps, et l'un des deux peut avoir joue sans l'autre. C'est exactement pour
 * cela que le serveur en rend deux etats.
 */
export function effectsOf(fate: {
  points: number;
  chronoMs: number;
  pointsApplied: boolean;
  chronoApplied: boolean;
}): Effect[] {
  const out: Effect[] = [];
  if (fate.points) {
    const n = Math.abs(fate.points);
    out.push({
      text: `${fate.points > 0 ? '+' : '−'}${n} POINT${n > 1 ? 'S' : ''}`,
      applied: fate.pointsApplied,
    });
  }
  if (fate.chronoMs) {
    out.push({
      text: `${fate.chronoMs > 0 ? '+' : '−'}${humanDuration(Math.abs(fate.chronoMs)).toUpperCase()} DE CHRONO`,
      applied: fate.chronoApplied,
    });
  }
  return out;
}

/**
 * Ce que l'interface a le droit de dire.
 *
 * Jamais « applique » quand rien ne s'est applique : un sort dont l'effet n'a
 * pas joue est une consigne, et c'est la personne qui doit la tenir. Un sort
 * sans effet mecanique en est une par nature.
 */
export function statusOf(effects: Effect[]): { text: string; short: string; advice: boolean } {
  if (!effects.length) return { text: 'CONSIGNE · A RESPECTER', short: 'A RESPECTER', advice: true };
  const played = effects.filter((e) => e.applied).length;
  if (played === effects.length) {
    return { text: 'APPLIQUE AUTOMATIQUEMENT', short: 'APPLIQUE', advice: false };
  }
  if (played === 0) {
    return { text: 'RIEN NE S’APPLIQUE · CONSIGNE A RESPECTER', short: 'A RESPECTER', advice: true };
  }
  return { text: 'EN PARTIE APPLIQUE · LE RESTE EST A RESPECTER', short: 'EN PARTIE', advice: true };
}

/** « UNE PERSONNE · UN SORT CHACUN ». */
export function modeOf(spin: Spin): string {
  const who = spin.target === 'one'
    ? 'UNE PERSONNE'
    : spin.target === 'all' ? 'TOUTE LA SALLE' : `${hex(spin.howMany)} PERSONNES`;
  if (spin.fates.length < 2) return who;
  return `${who} · ${spin.shared ? 'LE MEME SORT POUR TOUS' : 'UN SORT CHACUN'}`;
}

/* ------------------------------------------------------------------ */
/* Prevision, avant le tirage                                         */
/* ------------------------------------------------------------------ */

/**
 * Le chrono bougera-t-il, si on lance dans ce mode ?
 *
 * Les phases viennent du serveur. Reste la condition de mode — toute la salle,
 * le meme sort — que le serveur ne peut pas envoyer puisqu'elle porte sur un
 * choix que l'animateur n'a pas encore fait : l'horloge d'Arena est partagee,
 * et avancer le temps d'une seule personne n'existe pas. C'est la seule part de
 * la regle que cette page connait encore, et elle ne sert qu'a avertir.
 */
export function chronoWillApply(
  rules: RouletteRules | null,
  phase: Phase,
  target: SpinTarget,
  shared: boolean,
): boolean {
  return !!rules && rules.chronoPhases.includes(phase) && target === 'all' && shared;
}

/** Les points corrigeront-ils encore un score ? */
export function pointsWillApply(rules: RouletteRules | null, phase: Phase): boolean {
  return !!rules && rules.pointsPhases.includes(phase);
}

/** Le vote est-il encore aveugle ? Rien n'a ete entendu, donc tout se reconnait. */
export function isBlind(rules: RouletteRules | null, phase: Phase): boolean {
  return !!rules && rules.blindPhases.includes(phase);
}
