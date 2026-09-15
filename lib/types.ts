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
  /** Pendant la diffusion, le serveur passe-t-il seul au rendu suivant ? */
  autoNext: boolean;
  /** Secondes laissees pour noter apres la fin de l'ecoute. */
  voteWindowS: number;
  /** Les telephones jouent-ils le son ? Faux quand une enceinte suffit. */
  playerAudio: boolean;
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
  /** Vient juger sans creer : on ne l'attend pas au depot. */
  spectator: boolean;
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
  /** Ceux qui sont la pour juger, pas pour creer. */
  spectators: number;
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
  /** Duree reelle mesuree par le serveur, ou null. */
  durationMs: number | null;
  /**
   * Un extrait re-encode existe : deja coupe a la duree d'ecoute, deja fondu,
   * sans metadonnee. Faux = l'original est servi tel quel et la page applique
   * elle-meme la coupure et le fondu.
   */
  transcoded: boolean;
  /** L'extrait de diffusion. Jamais l'original. */
  url: string | null;
  /** Cretes de la forme d'onde (JSON, ~800 valeurs entre 0 et 1), ou null. */
  peaksUrl: string | null;
  thumbUrl: string | null;
}

export interface DiffusionState {
  index: number;
  total: number;
  current: RenditionCard | null;
  /** Combien ont deja note le rendu affiche. */
  voted: number;
  /** Combien devaient le noter : tout le monde sauf son auteur. */
  eligible: number;
  /**
   * Horloge du rendu, en instants absolus serveur.
   *
   * L'ecoute a demarre a `startedAt` pour tout le monde : un client qui arrive
   * en cours se cale a la bonne seconde. Elle s'arrete a `endsAt`. Le serveur
   * passe au suivant a `advanceAt` — null quand la regie a coupe l'automatique.
   */
  startedAt: number | null;
  endsAt: number | null;
  advanceAt: number | null;
  autoNext: boolean;
  playMaxS: number;
  voteWindowS: number;
  playerAudio: boolean;
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
  /**
   * Le sort tire a la roulette, entier signe.
   *
   * A cote de `penalty` et jamais melange avec lui : une penalite est une regle
   * annoncee, un sort est un hasard assume. Les confondre a l'affichage
   * reviendrait a cacher lequel des deux a joue.
   */
  fate?: number;
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

/* ------------------------------------------------------------------ */
/* LA ROULETTE                                                         */
/* ------------------------------------------------------------------ */

/**
 * Une case de roue.
 *
 * Elle ne circule que sur demande (`host:wheel-slots`) : la liste des roues ne
 * porte que le compte, et une soiree n'a aucune raison de transporter les
 * quarante cases des roues qu'on n'ouvre pas.
 */
export interface WheelSlot {
  id: string;
  wheelId: string;
  label: string;
  detail: string;
  /** Zero = la case ne sort jamais, mais son texte reste. */
  weight: number;
  /** Effet sur le score, signe. */
  points: number;
  /** Effet sur le chrono partage, signe, en millisecondes. */
  chronoMs: number;
  position: number;
}

/** Une roue de sorts : nommee, persistante, preparee entre deux soirees. */
export interface Wheel {
  id: string;
  name: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  /** Nombre de cases seulement. La liste se demande. */
  slots?: number;
}

export type SpinTarget = 'one' | 'some' | 'all';

/** Le sort d'une personne, recopie au moment du tirage et jamais reecrit. */
export interface Fate {
  /** Null quand la personne a quitte la session : son pseudo, lui, survit. */
  participantId: string | null;
  pseudo: string;
  label: string;
  detail: string;
  points: number;
  chronoMs: number;
  /*
   * Un etat par effet.
   *
   * Ils n'obeissent pas a la meme regle — les points ne corrigent plus un
   * classement devoile, le chrono ne bouge que pour la salle entiere pendant
   * qu'il court — et un drapeau unique obligeait les pages a redeviner laquelle
   * des deux avait joue. Faux veut dire « consigne a respecter ».
   */
  pointsApplied: boolean;
  chronoApplied: boolean;
  position: number;
}

/** Un tirage, tel que les trois surfaces le recoivent. La graine n'y est pas. */
export interface Spin {
  id: string;
  wheelName: string;
  target: SpinTarget;
  howMany: number;
  /** Vrai = une seule case pour tout le monde. */
  shared: boolean;
  phase: Phase;
  at: number;
  /** Dans l'ordre de `position` : c'est l'ordre du devoilement. */
  fates: Fate[];
}

/**
 * LA ROULETTE, vue de tout le monde.
 *
 * `spins` est public et doit rester affiche : une roue qu'on peut relancer en
 * secret n'a aucune autorite.
 */
export interface RouletteState {
  spins: number;
  last: Spin | null;
}

/** Son propre sort, sur le canal personnel. */
export interface YouFate {
  spinId: string;
  wheelName: string;
  label: string;
  detail: string;
  points: number;
  chronoMs: number;
  pointsApplied: boolean;
  chronoApplied: boolean;
  at: number;
}

/**
 * Accuse de `host:spin` : ce que le tirage a fait, et ce qu'il n'a pas fait.
 *
 * Ces trois-la ne sont nulle part ailleurs — ni dans l'etat commun, ni dans la
 * vue de la regie — et sans elles le panneau laisserait croire qu'un malus a
 * joue alors qu'il reste une consigne.
 */
/**
 * Les regles du tirage, envoyees par le serveur plutot que recopiees ici.
 *
 * La regie doit pouvoir prevenir AVANT un tirage de ce que le mode choisi ne
 * pourra pas faire. Elle a donc besoin des memes ensembles de phases que le
 * serveur — et un miroir declare a la main finit par mentir. Present sur
 * `hostView` seulement : l'ecran et le telephone lisent des etats deja
 * tranches, ils n'ont aucune regle a appliquer.
 */
export interface RouletteRules {
  /** Phases ou les points corrigent encore un score. */
  pointsPhases: Phase[];
  /** Phases ou le chrono court encore. */
  chronoPhases: Phase[];
  /** Phases ou le vote est encore aveugle : rien n'a ete entendu. */
  blindPhases: Phase[];
  pointsMax: number;
  chronoMaxMs: number;
}

export interface SpinAck {
  /** Le chrono a-t-il vraiment bouge, et de combien. */
  chronoMs: number;
  chronoApplicable: boolean;
  pointsApplicables: boolean;
  /** La roue avait moins de cases que de personnes : elle a recommence un tour. */
  epuise: boolean;
  spins: number;
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
  chain: ChainState;
  roulette: RouletteState;
  serverNow: number;
  isHost?: boolean;
  isScreen?: boolean;
  /** Regie seulement : rendus recus mais pas encore prets a diffuser. */
  pendingSubmissions?: number;
  /** Regie seulement : les roues ne dependent d'aucune session. */
  wheels?: Wheel[];
  /** Regie seulement : les regles du tirage, pour prevenir avant de lancer. */
  rouletteRules?: RouletteRules;
  /**
   * Regie seulement : la graine du dernier tirage.
   *
   * Elle n'est pas dans la vue commune — elle sert a rejouer un tirage
   * conteste, ce qui est une conversation entre l'animateur et la salle, pas
   * une ligne d'affichage.
   */
  lastSeed?: string | null;
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
  transcoded: boolean;
  durationMs: number | null;
  /** Motif d'un transcodage rate : le fichier passera tel quel. */
  error: string | null;
  replacedCount: number;
  /** Lien signe, valable pour ce rendu et pour son auteur. Null pour un texte. */
  url: string | null;
}

/** Canal personnel : ce que le serveur ne dit qu'a un participant. */
/**
 * LA CHAINE, vue de tout le monde.
 *
 * Pendant la creation, seulement le decompte et le tour : le texte n'apparait
 * qu'une fois la creation finie, sinon il n'y aurait rien a decouvrir.
 */
export interface ChainState {
  lines: number;
  turn: { id: string; pseudo: string | null } | null;
  turnEndsAt: number | null;
  turnMs: number;
  open: boolean;
  revealed: { pseudo: string; body: string; at: number }[] | null;
}

/** Ce qu'un spectateur voit de la chaine, et lui seul : la ligne a prolonger. */
export interface YouChain {
  mine: boolean;
  last: string | null;
  lastBy: string | null;
  position: number;
  max: number;
}

export interface You {
  id: string;
  pseudo: string;
  avatar: string;
  isHost: boolean;
  disqualified: boolean;
  /** Vient juger sans creer : ne depose rien, ne peut pas gagner, mais vote. */
  spectator: boolean;
  joinedAt: number;
  submission: OwnSubmission | null;
  /** Ses propres notes : { renditionId: { critereId: valeur } }. */
  votes: Record<string, Record<string, number>>;
  /** Null pour un createur : la chaine ne le concerne pas. */
  chain: YouChain | null;
  /** Son propre sort, pour que le telephone l'affiche en grand. Null s'il n'en a pas. */
  fate: YouFate | null;
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

/**
 * Types de rendu. L'« icone » n'est plus un pictogramme mais un code systeme :
 * AGARTHA numerote, il ne decore pas.
 */
export const MEDIA_LABELS: Record<MediaType, { label: string; icon: string; hint: string }> = {
  audio: { label: 'AUDIO', icon: '0x01', hint: 'MORCEAU, BEAT, SOUND DESIGN' },
  image: { label: 'IMAGE', icon: '0x02', hint: 'MONTAGE, COVER, AFFICHE' },
  video: { label: 'VIDEO', icon: '0x03', hint: 'MONTAGE, EDIT, MOTION' },
  text:  { label: 'TEXTE', icon: '0x04', hint: 'ECRITURE, PUNCHLINES, PITCH' },
  file:  { label: 'LIBRE', icon: '0x05', hint: 'N’IMPORTE QUEL FICHIER' },
};

export const PHASE_STEPS: { phase: Phase; label: string }[] = [
  { phase: 'config', label: 'REGLAGES' },
  { phase: 'lobby', label: 'LOBBY' },
  { phase: 'creation', label: 'CREATION' },
  { phase: 'upload', label: 'DEPOT' },
  { phase: 'diffusion', label: 'DIFFUSION' },
  { phase: 'results', label: 'RESULTATS' },
];

/** Ce que `GET /api/podium/me` rend : le hub, et qui y est connecte. */
export interface PodiumIdentity {
  hubUrl: string | null;
  pid?: string;
  pseudo?: string;
  avatar?: string;
}

/** Variation d'Elo renvoyee par le hub apres le classement, par participant. */
export interface PodiumRating {
  participantId: string;
  pseudo: string;
  before: number;
  after: number;
  delta: number;
  tier: string | null;
}
