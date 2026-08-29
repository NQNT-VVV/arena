/**
 * Miroir des charges utiles produites par `server/views.js`.
 *
 * Toute modification la-bas se repercute ici : `npm run typecheck` rattrape les
 * champs oublies avant qu'une page ne rende `undefined` en pleine soiree.
 */

export type Phase = 'config' | 'lobby' | 'creation' | 'upload' | 'diffusion' | 'results' | 'archived';
export type MediaType = 'audio' | 'image' | 'video' | 'text' | 'file';
export type LatePolicy = 'reject' | 'unranked' | 'penalty';

export interface Criterion {
  id: string;
  label: string;
  weight: number;
}

export interface SessionConfig {
  durationMs: number;
  graceMs: number;
  /** Seuils d'alerte sonore, en secondes restantes, tries du plus grand au plus petit. */
  alerts: number[];
  endSound: boolean;
  playMaxS: number;
  fadeOutS: number;
  scale: number;
  defaultVote: number;
  criteria: Criterion[];
  latePolicy: LatePolicy;
  latePenalty: number;
  hostVotes: boolean;
  autoAdvance: boolean;
  allowedExt: string[];
  maxFileBytes: number;
}

/**
 * Horloge de session.
 *
 * Que des instants absolus, en millisecondes serveur. Le client les compare a
 * `clock.now()`, jamais a `Date.now()` brut : c'est la difference entre tous
 * les ecrans a la meme seconde et chacun le sien.
 */
export interface ClockState {
  startedAt: number | null;
  createEndAt: number | null;
  graceEndAt: number | null;
  pausedAt: number | null;
  remainingMs: number | null;
  durationMs: number;
  graceMs: number;
  alerts: number[];
}

export interface RosterEntry {
  id: string;
  pseudo: string;
  avatar: string;
  connected: boolean;
  disqualified: boolean;
  /** Renseignes pour la regie seulement. */
  joinedAt?: number;
  lastSeenAt?: number;
  hasSubmitted?: boolean;
}

export interface Counts {
  participants: number;
  connected: number;
  submitted: number;
  voted: number;
}

export interface BattleState {
  code: string;
  name: string;
  phase: Phase;
  mediaType: MediaType;
  brief: string;
  config: SessionConfig;
  clock: ClockState;
  counts: Counts;
  roster: RosterEntry[];
  /** Renseignes par les increments a venir. */
  assets: unknown[];
  diffusion: unknown | null;
  podium: unknown | null;
  serverNow: number;
  isHost?: boolean;
  isScreen?: boolean;
}

/** Canal personnel : ce que le serveur ne dit qu'a un participant. */
export interface You {
  id: string;
  pseudo: string;
  avatar: string;
  isHost: boolean;
  disqualified: boolean;
  joinedAt: number;
  submission: unknown | null;
  votes: Record<string, number>;
}

/** Carte de visite renvoyee par `GET /api/session/:code`. */
export interface SessionCard {
  exists: boolean;
  code?: string;
  name?: string;
  mediaType?: MediaType;
  phase?: Phase;
  open?: boolean;
  participants?: number;
}

/** Reponse d'un `socket.emit` avec accuse de reception. */
export type Ack<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; error: string };

/** Identite conservee dans le navigateur pour survivre a un rafraichissement. */
export interface SavedIdentity {
  participantId: string;
  token: string;
  pseudo: string;
}

export const MEDIA_LABELS: Record<MediaType, { label: string; icon: string; hint: string }> = {
  audio: { label: 'Audio', icon: '\u{1F3A7}', hint: 'Morceau, beat, sound design' },
  image: { label: 'Image', icon: '\u{1F5BC}\u{FE0F}', hint: 'Montage, cover, affiche' },
  video: { label: 'Video', icon: '\u{1F3AC}', hint: 'Montage, edit, motion' },
  text:  { label: 'Texte', icon: '\u{270D}\u{FE0F}', hint: 'Ecriture, punchlines, pitch' },
  file:  { label: 'Libre', icon: '\u{1F4E6}', hint: 'N’importe quel fichier' },
};

export const PHASE_STEPS: { phase: Phase; label: string }[] = [
  { phase: 'config', label: 'Reglages' },
  { phase: 'lobby', label: 'Lobby' },
  { phase: 'creation', label: 'Creation' },
  { phase: 'upload', label: 'Depot' },
  { phase: 'diffusion', label: 'Diffusion' },
  { phase: 'results', label: 'Resultats' },
];
