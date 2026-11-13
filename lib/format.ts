/** Constantes et mises en forme partagees par les pages. */

/**
 * LE VOCABULAIRE — un mot par notion, sur toutes les surfaces et dans les
 * messages du serveur.
 *
 *   createurs    ceux qui deposent un rendu et concourent
 *   spectateurs  ceux qui notent sans deposer
 *                (les deux ensemble : « tout le monde », « createurs et
 *                spectateurs » — jamais participants, inscrits, sujets)
 *   animateur    celui qui tient la regie
 *   session      la partie et son code (jamais « salle » : la salle, c'est le
 *                public devant l'ecran)
 *   rendu        ce qu'un createur depose (jamais « creation », qui est la phase)
 *   depot        la phase `upload`, entre la fin du chrono et la diffusion ;
 *                le « delai de grace » est le temps qu'elle laisse
 *   ecarter / reintegrer   la decision de l'animateur sur quelqu'un
 *   hors delai   un rendu arrive apres le delai — et rien d'autre
 *   hors classement        le sort d'un rendu hors delai, selon le reglage
 *
 * On tutoie : createurs, spectateurs et animateur. Le pluriel ne reste que la
 * ou l'on parle a la salle entiere, sur l'ecran de projection.
 */

import type { MediaType, Phase } from './types';

/** Doit rester aligne sur `CODE_LENGTH` dans server/util.js. */
export const CODE_LENGTH = 6;

/**
 * LES PHASES — une seule table.
 *
 * Il y en avait deux, a deux endroits : le nom court du rail et la phrase
 * d'etat des en-tetes. « Depot » d'un cote, « Depot des rendus » de l'autre,
 * et rien pour garantir qu'on renommait les deux. L'ordre de la table est
 * celui du rail.
 */
export const PHASES: { phase: Phase; label: string; etat: string }[] = [
  { phase: 'config', label: 'Réglages', etat: 'En préparation' },
  { phase: 'lobby', label: 'Lobby', etat: 'Lobby ouvert' },
  { phase: 'creation', label: 'Création', etat: 'Création en cours' },
  { phase: 'upload', label: 'Dépôt', etat: 'Dépôt des rendus' },
  { phase: 'diffusion', label: 'Diffusion', etat: 'Diffusion et vote' },
  { phase: 'results', label: 'Résultats', etat: 'Résultats' },
  { phase: 'archived', label: 'Terminée', etat: 'Session terminée' },
];

/** La phrase d'etat d'une phase, pour les en-tetes. */
export const PHASE_LABELS = Object.fromEntries(PHASES.map((p) => [p.phase, p.etat])) as Record<Phase, string>;

/** Les etapes du rail : une session terminee les a toutes traversees, elle n'en est pas une. */
export const PHASE_STEPS = PHASES.filter((p) => p.phase !== 'archived');

/** Duree lisible : « 1 h 30 », « 45 min », « 90 s ». */
export function humanDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 90) return `${total} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** Seuil d'alerte lisible : « 10 min », « 30 s ». */
export function humanThreshold(seconds: number): string {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ['ko', 'Mo', 'Go'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export const ACCEPTED_HINT: Record<MediaType, string> = {
  audio: 'MP3, WAV, FLAC, M4A, OGG…',
  image: 'PNG, JPG, WEBP, GIF…',
  video: 'MP4, MOV, WEBM, MKV…',
  text: 'Texte saisi directement, ou TXT / MD',
  file: 'Tout format',
};
