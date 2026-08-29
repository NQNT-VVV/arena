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

export type AssetKind = 'audio' | 'image' | 'video' | 'text' | 'other';

/** Element impose par l'animateur, tel que la page le recoit. */
export interface Asset {
  id: string;
  filename: string;
  bytes: number;
  mime: string;
  kind: AssetKind;
  /**
   * Consultable directement dans la page.
   *
   * Decide par le serveur a partir des octets reels, pas de l'extension. Un
   * fichier a `false` ne se telecharge que — il ne faut pas tenter de le
   * rendre dans une balise, le serveur refuserait de le servir avec un type
   * que le navigateur accepte d'interpreter.
   */
  inline: boolean;
  position: number;
  url: string;
}

export interface Counts {
  participants: number;
  connected: number;
  submitted: number;
  voted: number;
}

/**
 * Un rendu tel qu'il circule pendant la diffusion.
 *
 * Ni auteur, ni nom de fichier, ni identifiant interne. `renditionId` est
 * opaque et sert uniquement a voter — il change a chaque remplacement, donc
 * deux versions d'un meme rendu ne se relient pas.
 */
export interface RenditionCard {
  renditionId: string;
  kind: AssetKind;
  mime: string;
  inline: boolean;
  textBody: string | null;
  bytes: number;
  late: boolean;
  url: string | null;
}

export interface DiffusionState {
  index: number;
  total: number;
  current: RenditionCard | null;
  /** Combien ont deja note le rendu affiche. */
  voted: number;
  /** Combien devaient le noter : tout le monde sauf son auteur. */
  eligible: number;
  playMaxS: number;
}

export interface PodiumRow {
  position: number;
  /** Une ligne cachee ne porte rien d'autre : le classement ne circule pas avant son annonce. */
  hidden: boolean;
  rank?: number | null;
  score?: number | null;
  raw?: number;
  voters?: number;
  expected?: number;
  late?: boolean;
  unranked?: boolean;
  penalty?: number;
  criteria?: { id: string; label: string; average: number }[];
  author?: { id: string; pseudo: string; avatar: string } | null;
  rendition?: RenditionCard | null;
  filename?: string | null;
}

export interface PodiumState {
  total: number;
  /** Nombre de places devoilees, en partant du bas. */
  revealed: number;
  complete: boolean;
  rows: PodiumRow[];
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
  assets: Asset[];
  assetsZipUrl: string;
  diffusion: DiffusionState | null;
  podium: PodiumState | null;
  serverNow: number;
  isHost?: boolean;
  isScreen?: boolean;
}

export type SubmissionStatus = 'pending' | 'transcoding' | 'ready' | 'failed';

/**
 * Le rendu d'un participant, tel que lui seul le voit.
 *
 * Cette forme ne circule que sur le canal personnel. Ce qui sera diffuse a
 * tout le monde pendant la phase de vote est une autre forme, sans auteur ni
 * nom de fichier.
 */
export interface OwnSubmission {
  id: string;
  /** Sert a reconnaitre son propre rendu quand il passe en diffusion. */
  renditionId: string;
  filename: string | null;
  bytes: number;
  kind: AssetKind;
  inline: boolean;
  textBody: string | null;
  uploadedAt: number;
  /** Depose apres la fenetre de grace : le sort depend de la politique reglee. */
  late: boolean;
  status: SubmissionStatus;
  replacedCount: number;
  /** Lien signe, valable pour ce rendu et pour son auteur. Null pour un texte. */
  url: string | null;
}

/** Canal personnel : ce que le serveur ne dit qu'a un participant. */
export interface You {
  id: string;
  pseudo: string;
  avatar: string;
  isHost: boolean;
  disqualified: boolean;
  joinedAt: number;
  submission: OwnSubmission | null;
  /** Ses propres notes : { renditionId: { critereId: valeur } }. */
  votes: Record<string, Record<string, number>>;
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
