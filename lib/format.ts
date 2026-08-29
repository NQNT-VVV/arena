/** Constantes et mises en forme partagees par les pages. */

import type { MediaType, Phase } from './types';

/** Doit rester aligne sur `CODE_LENGTH` dans server/util.js. */
export const CODE_LENGTH = 6;

export const PHASE_LABELS: Record<Phase, string> = {
  config: 'En preparation',
  lobby: 'Lobby ouvert',
  creation: 'Creation en cours',
  upload: 'Depot des rendus',
  diffusion: 'Diffusion et vote',
  results: 'Resultats',
  archived: 'Session terminee',
};

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
  audio: 'mp3, wav, flac, m4a, ogg…',
  image: 'png, jpg, webp, gif…',
  video: 'mp4, mov, webm, mkv…',
  text: 'texte saisi directement, ou txt / md',
  file: 'tout format',
};
