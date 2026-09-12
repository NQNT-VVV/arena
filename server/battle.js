'use strict';

/**
 * Le coeur : sessions, machine a etats, chrono.
 *
 * Deux principes gouvernent ce fichier.
 *
 * 1. Le temps appartient au serveur. Une session ne stocke jamais « il reste
 *    douze minutes » mais « la creation s'arrete a tel instant ». Une duree se
 *    perime pendant son trajet reseau et se falsifie en avancant l'horloge du
 *    telephone ; un instant absolu ne se negocie pas.
 *
 * 2. L'etat vit en memoire et se recopie en base a chaque mutation. La memoire
 *    donne la vitesse de diffusion dont une soiree a besoin, la base donne la
 *    survie au redemarrage dont deux heures de travail televerse ont besoin.
 */

const { EventEmitter } = require('events');

const config = require('./config');
const repo = require('./repo');
const storage = require('./storage');
const views = require('./views');
const {
  uuid, uniqueCode, newToken, hashToken, tokenMatches,
  pickAvatar, cleanPseudo, cleanText, clamp, shuffle,
} = require('./util');

/* ------------------------------------------------------------------ */
/* Machine a etats                                                     */
/* ------------------------------------------------------------------ */

const PHASES = ['config', 'lobby', 'creation', 'upload', 'diffusion', 'results', 'archived'];

/**
 * Transitions autorisees.
 *
 * Le tableau est la specification : si une transition n'y figure pas, elle est
 * refusee, y compris a la regie. `archived` est joignable depuis partout —
 * l'animateur doit toujours pouvoir arreter une soiree qui derape.
 *
 * `lobby -> config` existe pour la raison inverse : tant que personne n'a
 * commence, revenir sur un reglage rate ne doit pas obliger a tout refaire.
 */
const TRANSITIONS = {
  config:    ['lobby', 'archived'],
  lobby:     ['config', 'creation', 'archived'],
  creation:  ['upload', 'archived'],
  upload:    ['diffusion', 'archived'],
  diffusion: ['results', 'archived'],
  results:   ['archived'],
  archived:  [],
};

const MEDIA_TYPES = new Set(['audio', 'image', 'video', 'text', 'file']);
const LATE_POLICIES = new Set(['reject', 'unranked', 'penalty']);

/**
 * Erreur destinee au client : son message est affichable tel quel.
 *
 * Le code HTTP distingue trois refus que le client ne traite pas pareil :
 * 403 « ce n'est pas vous l'animateur » invite a verifier son lien, 409 « pas
 * a ce moment-la » invite a attendre, 404 « ca n'existe pas ». Tout replier
 * sur 403 obligerait l'interface a lire le message pour deviner.
 */
class BattleError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'BattleError';
    this.expected = true;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Validation des reglages                                             */
/* ------------------------------------------------------------------ */

const MIN_DURATION_MS = 60 * 1000;
const MAX_DURATION_MS = 12 * 60 * 60 * 1000;
const MAX_GRACE_MS = 30 * 60 * 1000;
const MAX_ALERTS = 8;
const MAX_CRITERIA = 6;

/**
 * Reglages venus du reseau.
 *
 * Tout est borne, y compris ce que seul l'animateur peut envoyer : un champ
 * texte laisse a un humain finit toujours par contenir autre chose que ce
 * qu'on attendait, et une duree de creation de neuf ans arme un `setTimeout`
 * que Node tronque silencieusement.
 */
/** Nombre venu du reseau, ou repli si ce n'en est pas un. */
const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function sanitizeConfig(raw = {}, base = config.defaults) {
  const merged = { ...base, ...raw };
  const scale = clamp(Math.round(num(merged.scale, base.scale)), 2, 100);

  const alerts = [...new Set(
    (Array.isArray(merged.alerts) ? merged.alerts : base.alerts)
      .map((n) => Math.trunc(Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0),
  )].sort((a, b) => b - a).slice(0, MAX_ALERTS);

  const criteria = (Array.isArray(merged.criteria) ? merged.criteria : [])
    .slice(0, MAX_CRITERIA)
    .map((c, i) => ({
      id: cleanPseudo(c?.id || `c${i + 1}`, 24) || `c${i + 1}`,
      label: cleanPseudo(c?.label || `Critere ${i + 1}`, 48) || `Critere ${i + 1}`,
      weight: clamp(Number(c?.weight) || 1, 0.1, 10),
    }));

  const playMaxS = clamp(Math.round(num(merged.playMaxS, base.playMaxS)), 5, 600);

  return {
    durationMs: clamp(Math.round(num(merged.durationMs, base.durationMs)), MIN_DURATION_MS, MAX_DURATION_MS),
    graceMs: clamp(Math.round(num(merged.graceMs, base.graceMs)), 0, MAX_GRACE_MS),
    alerts,
    endSound: merged.endSound !== false,
    playMaxS,
    // Un fondu plus long que l'extrait ne veut rien dire.
    fadeOutS: clamp(Math.round(num(merged.fadeOutS, base.fadeOutS)), 0, Math.min(10, playMaxS)),
    scale,
    defaultVote: clamp(num(merged.defaultVote, base.defaultVote), 0, scale),
    criteria,
    latePolicy: LATE_POLICIES.has(merged.latePolicy) ? merged.latePolicy : base.latePolicy,
    latePenalty: clamp(num(merged.latePenalty, base.latePenalty), 0, scale),
    hostVotes: merged.hostVotes === true,
    autoAdvance: merged.autoAdvance === true,
    autoNext: merged.autoNext !== false,
    voteWindowS: clamp(Math.round(num(merged.voteWindowS, base.voteWindowS)), 0, 300),
    playerAudio: merged.playerAudio !== false,
    allowedExt: (Array.isArray(merged.allowedExt) ? merged.allowedExt : [])
      .map((e) => String(e).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8))
      .filter(Boolean)
      .slice(0, 30),
    maxFileBytes: clamp(
      Math.round(num(merged.maxFileBytes, config.limits.maxFileBytes)),
      1024 * 1024,
      config.limits.maxFileBytes,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Session vivante                                                     */
/* ------------------------------------------------------------------ */

/**
 * Miroir en memoire d'une ligne `session`, plus la presence reseau.
 *
 * Les mutations passent par `patch()` : memoire et base bougent ensemble, ce
 * qui evite la classe de bugs ou l'ecran affiche un etat que la base ignore.
 */
class LiveSession {
  constructor(row, participants = []) {
    Object.assign(this, row);
    this.participants = new Map(participants.map((p) => [p.id, p]));
    this.submissions = new Map();
    /** participantId -> Set(socketId) ; un participant peut avoir deux onglets. */
    this.presence = new Map();
    this.hostSockets = new Set();
    this.screenSockets = new Set();
  }

  patch(fields) {
    Object.assign(this, fields);
    repo.updateSession(this.id, fields);
    return this;
  }

  isOnline(participantId) {
    const set = this.presence.get(participantId);
    return !!set && set.size > 0;
  }

  get hostOnline() {
    return this.hostSockets.size > 0;
  }

  /**
   * Nombre de personnes qui doivent noter un rendu : tout le monde, sauf son
   * auteur et les mis hors classement. C'est le denominateur du compteur
   * « X / Y ont note » et le seuil de l'avancement anticipe.
   */
  eligibleVoters(submission) {
    const voters = [...this.participants.values()].filter((p) => !p.isHost && !p.disqualified);
    const authorVotes = submission && voters.some((p) => p.id === submission.participantId);
    return Math.max(0, voters.length - (authorVotes ? 1 : 0));
  }

  /** Instant ou l'ecoute du rendu en cours s'arrete, ou null hors diffusion. */
  renditionEndsAt() {
    return this.diffusionEndsAt ?? null;
  }

  /** Rendu affiche par la diffusion, ou null. */
  currentSubmission() {
    const id = (this.order ?? [])[this.cursor];
    return id ? repo.submission(id) : null;
  }

  /** Duree restante de creation, en millisecondes. Fait autorite. */
  remaining(now = Date.now()) {
    if (this.pausedAt) return Math.max(0, this.remainingMs ?? 0);
    if (!this.createEndAt) return 0;
    return Math.max(0, this.createEndAt - now);
  }
}

/* ------------------------------------------------------------------ */
/* Serveur                                                             */
/* ------------------------------------------------------------------ */

const roomAll = (code) => `s:${code}`;
const roomHost = (code) => `s:${code}:host`;
const roomScreen = (code) => `s:${code}:screen`;

class BattleServer {
  constructor(io) {
    this.io = io;
    /**
     * Evenements de session, pour les modules optionnels.
     *
     * Le coeur ne sait pas qu'un module Discord existe : il annonce ce qui se
     * passe, et qui veut ecoute. C'est ce qui permet d'ajouter une integration
     * sans toucher a une seule ligne de la machine a etats.
     */
    this.events = new EventEmitter();
    /** code -> LiveSession */
    this.sessions = new Map();
    /** code -> Timeout */
    this.timers = new Map();
    this.boot();
  }

  /**
   * Reprise apres redemarrage.
   *
   * Les sessions non archivees reviennent en memoire et leurs echeances sont
   * rearmees. Une echeance deja depassee pendant l'arret declenche
   * immediatement : mieux vaut une phase qui rattrape son retard qu'un chrono
   * fige sur un ecran de participant.
   */
  boot() {
    for (const row of repo.liveSessions()) {
      const live = new LiveSession(row, repo.participants(row.id));
      this.sessions.set(live.code, live);
      this.arm(live);
    }
  }

  /* --------------------------- lecture --------------------------- */

  get(code) {
    if (!code) return null;
    return this.sessions.get(String(code).toUpperCase().trim()) || null;
  }

  require(code) {
    const s = this.get(code);
    if (!s) throw new BattleError("Cette session n'existe pas ou plus.", 404);
    return s;
  }

  /** Session dont l'appelant detient le jeton de regie. */
  requireHost(code, token) {
    const s = this.require(code);
    if (!tokenMatches(token, s.hostTokenHash)) {
      throw new BattleError("Vous n'etes pas l'animateur de cette session.", 403);
    }
    return s;
  }

  /* --------------------------- creation -------------------------- */

  createSession({ name, mediaType, brief, config: rawConfig } = {}) {
    if (this.sessions.size >= config.limits.maxSessions) {
      throw new BattleError('Le serveur heberge deja trop de sessions ouvertes.');
    }

    const cleanName = cleanPseudo(name, 60) || 'Battle sans nom';
    const type = MEDIA_TYPES.has(mediaType) ? mediaType : config.defaults.mediaType;
    const hostToken = newToken();
    const now = Date.now();

    const row = repo.createSession({
      id: uuid(),
      code: uniqueCode((c) => repo.codeTaken(c)),
      name: cleanName,
      hostTokenHash: hashToken(hostToken),
      phase: 'config',
      mediaType: type,
      brief: cleanText(brief, config.limits.maxBriefChars),
      config: sanitizeConfig(rawConfig),
      createdAt: now,
    });

    const live = new LiveSession(row, []);
    this.sessions.set(live.code, live);
    repo.logEvent(live.id, 'session:created', { name: cleanName, mediaType: type });

    // Le jeton n'est renvoye qu'ici : la base n'en garde que l'empreinte.
    return { session: live, hostToken };
  }

  /** Reglages modifiables tant que la battle n'a pas commence. */
  configure(code, token, patch = {}) {
    const s = this.requireHost(code, token);
    if (s.phase !== 'config' && s.phase !== 'lobby') {
      throw new BattleError('Les reglages se figent au lancement de la creation.');
    }
    const fields = {};
    if (patch.name !== undefined) fields.name = cleanPseudo(patch.name, 60) || s.name;
    if (patch.brief !== undefined) fields.brief = cleanText(patch.brief, config.limits.maxBriefChars);
    if (patch.mediaType !== undefined && MEDIA_TYPES.has(patch.mediaType)) fields.mediaType = patch.mediaType;
    if (patch.config !== undefined) fields.config = sanitizeConfig(patch.config, s.config);
    s.patch(fields);
    repo.logEvent(s.id, 'session:configured', Object.keys(fields));
    this.publish(s);
    return s;
  }

  /* ------------------------- participants ------------------------ */

  /**
   * Phases ou un inconnu peut encore entrer.
   *
   * Passe la fermeture des televersements, on refuse : quelqu'un qui arrive
   * pour la seule phase de vote n'a rien cree, et rien ne le distingue d'un
   * second onglet ouvert pour faire monter une note. Les participants deja
   * connus, eux, se reconnectent a n'importe quel moment.
   */
  static JOINABLE = new Set(['config', 'lobby', 'creation', 'upload']);

  /**
   * `podiumPid` vient du serveur, jamais du client : c'est le compte Podium lu
   * dans le cookie signe du handshake. Null pour qui joue sans compte.
   */
  join(code, { pseudo, participantId, token, podiumPid = null } = {}) {
    const s = this.require(code);

    // Retour d'un participant connu : un rafraichissement de page, un tunnel.
    if (participantId && token) {
      const known = s.participants.get(participantId);
      if (known && tokenMatches(token, known.tokenHash)) {
        const now = Date.now();
        known.lastSeenAt = now;
        repo.touchParticipant(known.id, now);
        // Connecte au hub entre-temps : le lien se fait a la reprise, une fois.
        if (podiumPid && !known.podiumPid && repo.setPodiumPid(known.id, podiumPid)) known.podiumPid = podiumPid;
        return { session: s, participant: known, token, resumed: true };
      }
    }

    if (!BattleServer.JOINABLE.has(s.phase)) {
      throw new BattleError('Les inscriptions sont fermees pour cette session.');
    }
    if (s.participants.size >= config.limits.maxParticipants) {
      throw new BattleError('Cette session est complete.');
    }

    const name = cleanPseudo(pseudo);
    if (name.length < 2) throw new BattleError('Choisissez un pseudo d’au moins deux caracteres.');
    if (repo.participantByPseudo(s.id, name)) {
      throw new BattleError('Ce pseudo est deja pris dans cette session.');
    }

    const fresh = newToken();
    const taken = new Set([...s.participants.values()].map((p) => p.avatar));
    const now = Date.now();
    const participant = repo.addParticipant({
      id: uuid(),
      sessionId: s.id,
      pseudo: name,
      avatar: pickAvatar(taken),
      tokenHash: hashToken(fresh),
      isHost: false,
      joinedAt: now,
      podiumPid: podiumPid || null,
    });

    s.participants.set(participant.id, participant);
    repo.logEvent(s.id, 'participant:joined', { pseudo: name });
    // Pas de diffusion ici : la socket n'est pas encore enregistree, et l'etat
    // montrerait le nouvel arrivant deja inscrit mais deja hors ligne. C'est
    // `attachParticipant()` qui diffuse, une fois la presence connue.
    return { session: s, participant, token: fresh, resumed: false };
  }

  leave(code, participantId) {
    const s = this.get(code);
    if (!s) return;
    const p = s.participants.get(participantId);
    if (!p) return;
    // Avant le depart des chronos on efface vraiment ; apres, la personne a
    // peut-etre deja televerse et son rendu doit garder un auteur.
    if (s.phase === 'config' || s.phase === 'lobby') {
      s.participants.delete(participantId);
      s.presence.delete(participantId);
      repo.removeParticipant(participantId);
      repo.logEvent(s.id, 'participant:left', { pseudo: p.pseudo });
      this.publish(s);
    }
  }

  setDisqualified(code, token, participantId, on) {
    const s = this.requireHost(code, token);
    const p = s.participants.get(participantId);
    if (!p) throw new BattleError('Participant introuvable.', 404);
    p.disqualified = !!on;
    repo.setDisqualified(participantId, on);
    repo.logEvent(s.id, on ? 'participant:disqualified' : 'participant:requalified', { pseudo: p.pseudo });
    this.publish(s);
    return s;
  }

  /* ---------------------------- rendus --------------------------- */

  /**
   * Phases ou un participant peut deposer.
   *
   * `creation` en fait partie, et c'est voulu : on ne force personne a attendre
   * la fin pour televerser. Quelqu'un qui a fini en vingt minutes depose et
   * s'en va, quitte a remplacer son fichier plus tard s'il se ravise.
   */
  static SUBMIT_PHASES = new Set(['creation', 'upload']);

  /** Participant authentifie par son jeton. */
  requireParticipant(code, participantId, token) {
    const session = this.require(code);
    const participant = session.participants.get(String(participantId || ''));
    if (!participant || !tokenMatches(token, participant.tokenHash)) {
      throw new BattleError('Identifiez-vous pour deposer votre rendu.', 403);
    }
    return { session, participant };
  }

  /**
   * Autorise un depot, et dit sous quelles conditions.
   *
   * Le retard est constate par l'horloge du serveur, jamais annonce par le
   * client. C'est la seule facon d'avoir la meme regle pour tout le monde.
   */
  openSubmissionSlot(code, participantId, token) {
    const { session, participant } = this.requireParticipant(code, participantId, token);

    if (!BattleServer.SUBMIT_PHASES.has(session.phase)) {
      throw new BattleError(
        session.phase === 'lobby' || session.phase === 'config'
          ? 'La creation n’a pas encore commence.'
          : 'Les depots sont clos pour cette session.',
      );
    }
    if (participant.disqualified) {
      throw new BattleError('Vous avez ete mis hors classement par l’animateur.', 403);
    }

    const late = !!(session.graceEndAt && Date.now() > session.graceEndAt);
    if (late && session.config.latePolicy === 'reject') {
      throw new BattleError('Le temps est ecoule : les depots hors delai sont refuses.');
    }

    return {
      session,
      participant,
      late,
      maxBytes: session.config.maxFileBytes,
      allowedExt: session.config.allowedExt,
      existing: repo.submissionOf(session.id, participant.id),
    };
  }

  /** Enregistre ou remplace le rendu d'un participant. */
  saveSubmission(session, participant, data, existing) {
    const now = Date.now();
    const payload = {
      id: existing?.id ?? uuid(),
      sessionId: session.id,
      participantId: participant.id,
      renditionId: uuid(),
      uploadedAt: now,
      ...data,
    };
    const saved = existing ? repo.replaceSubmission(payload) : repo.addSubmission(payload);
    repo.logEvent(session.id, existing ? 'submission:replaced' : 'submission:received', {
      participantId: participant.id, bytes: saved.originalBytes, late: saved.late,
    });
    return saved;
  }

  /** Retrait par son auteur, tant que les depots sont ouverts. */
  withdrawSubmission(code, participantId, token) {
    const { session, participant } = this.requireParticipant(code, participantId, token);
    if (!BattleServer.SUBMIT_PHASES.has(session.phase)) {
      throw new BattleError('Trop tard pour retirer un rendu.');
    }
    const existing = repo.submissionOf(session.id, participant.id);
    if (!existing) throw new BattleError('Vous n’avez rien depose.', 404);
    repo.removeSubmission(existing.id);
    repo.logEvent(session.id, 'submission:withdrawn', { participantId: participant.id });
    return { session, participant, removed: existing };
  }

  /* ---------------------------- assets --------------------------- */

  /**
   * Phases ou l'animateur peut encore deposer un element.
   *
   * `creation` en fait partie : oublier un sample et s'en apercevoir dix
   * minutes apres le depart arrive, et interdire l'ajout obligerait a relancer
   * toute la session. Les participants recoivent le nouvel element en direct.
   */
  static ASSET_ADD_PHASES = new Set(['config', 'lobby', 'creation']);

  /**
   * Phases ou il peut en retirer un.
   *
   * Volontairement plus etroit que l'ajout : retirer une contrainte alors que
   * des gens ont deja construit dessus invalide leur travail.
   */
  static ASSET_REMOVE_PHASES = new Set(['config', 'lobby']);

  /** Verifie qu'un depot d'element est possible, et dit ce qu'il reste comme place. */
  openAssetSlot(code, token) {
    const session = this.requireHost(code, token);
    if (!BattleServer.ASSET_ADD_PHASES.has(session.phase)) {
      throw new BattleError('Les elements ne se deposent plus une fois la creation terminee.');
    }
    const totals = repo.assetTotals(session.id);
    const slots = config.limits.maxAssets - totals.n;
    const budget = config.limits.maxAssetsBytes - totals.bytes;
    if (slots <= 0) throw new BattleError(`Pas plus de ${config.limits.maxAssets} elements par session.`, 413);
    if (budget <= 0) throw new BattleError('Le poids total des elements est atteint.', 413);
    return { session, slots, budget, nextPosition: totals.lastPosition + 1 };
  }

  recordAsset(session, asset) {
    const saved = repo.addAsset({ ...asset, sessionId: session.id, createdAt: Date.now() });
    repo.logEvent(session.id, 'asset:added', { filename: saved.filename, bytes: saved.bytes });
    return saved;
  }

  removeAsset(code, token, assetId) {
    const session = this.requireHost(code, token);
    if (!BattleServer.ASSET_REMOVE_PHASES.has(session.phase)) {
      throw new BattleError('Un element ne se retire plus une fois la creation lancee.');
    }
    const asset = repo.asset(assetId);
    if (!asset || asset.sessionId !== session.id) throw new BattleError('Element introuvable.', 404);
    repo.removeAsset(assetId);
    repo.logEvent(session.id, 'asset:removed', { filename: asset.filename });
    return { session, asset };
  }

  /* ---------------------------- phases --------------------------- */

  /**
   * Unique porte d'entree des changements de phase.
   *
   * Toute transition passe ici, y compris celles declenchees par une echeance :
   * une seule verification du tableau `TRANSITIONS`, un seul point de journal,
   * un seul rearmement du chrono.
   */
  setPhase(session, to, extra = {}) {
    const allowed = TRANSITIONS[session.phase] || [];
    if (!allowed.includes(to)) {
      throw new BattleError(`Impossible de passer de « ${session.phase} » a « ${to} ».`);
    }
    const from = session.phase;
    session.patch({ phase: to, ...extra });
    repo.logEvent(session.id, 'phase', { from, to });
    this.arm(session);
    this.publish(session);
    this.events.emit('phase', { session, from, to });
    return session;
  }

  /** CONFIGURATION -> LOBBY : la session devient rejoignable. */
  publishSession(code, token) {
    return this.setPhase(this.requireHost(code, token), 'lobby');
  }

  /** LOBBY -> CONFIGURATION : retour aux reglages. */
  unpublish(code, token) {
    return this.setPhase(this.requireHost(code, token), 'config');
  }

  /** LOBBY -> CREATION : le chrono part. */
  start(code, token) {
    const s = this.requireHost(code, token);
    const now = Date.now();
    return this.setPhase(s, 'creation', {
      startedAt: now,
      createEndAt: now + s.config.durationMs,
      pausedAt: null,
      remainingMs: null,
    });
  }

  pause(code, token) {
    const s = this.requireHost(code, token);
    if (s.phase !== 'creation') throw new BattleError('Il n’y a de chrono a mettre en pause que pendant la creation.');
    if (s.pausedAt) return s;
    const now = Date.now();
    s.patch({ pausedAt: now, remainingMs: Math.max(0, s.createEndAt - now), createEndAt: null });
    repo.logEvent(s.id, 'clock:paused', { remainingMs: s.remainingMs });
    this.arm(s);
    this.publish(s);
    return s;
  }

  resume(code, token) {
    const s = this.requireHost(code, token);
    if (s.phase !== 'creation' || !s.pausedAt) return s;
    const now = Date.now();
    s.patch({ createEndAt: now + (s.remainingMs ?? 0), pausedAt: null, remainingMs: null });
    repo.logEvent(s.id, 'clock:resumed', { createEndAt: s.createEndAt });
    this.arm(s);
    this.publish(s);
    return s;
  }

  /**
   * Ajout ou retrait de temps.
   *
   * Fonctionne aussi sur la fenetre de grace : « je vous laisse deux minutes de
   * plus pour finir vos televersements » est la meme intention que « je rallonge
   * la creation », et l'animateur ne devrait pas avoir a savoir dans quelle
   * phase il se trouve pour l'exprimer.
   */
  addTime(code, token, deltaMs) {
    const s = this.requireHost(code, token);
    const delta = clamp(Math.round(Number(deltaMs) || 0), -MAX_DURATION_MS, MAX_DURATION_MS);
    if (!delta) return s;
    const now = Date.now();

    if (s.phase === 'creation') {
      if (s.pausedAt) s.patch({ remainingMs: Math.max(0, (s.remainingMs ?? 0) + delta) });
      else s.patch({ createEndAt: Math.max(now, s.createEndAt + delta) });
    } else if (s.phase === 'upload') {
      s.patch({ graceEndAt: Math.max(now, (s.graceEndAt ?? now) + delta) });
    } else {
      throw new BattleError('Le temps ne se modifie que pendant la creation ou la fenetre de grace.');
    }

    repo.logEvent(s.id, 'clock:adjusted', { deltaMs: delta, phase: s.phase });
    this.arm(s);
    this.publish(s);
    return s;
  }

  /** CREATION -> UPLOAD. Declenche par l'echeance, ou force par la regie. */
  closeCreation(session) {
    const now = Date.now();
    return this.setPhase(session, 'upload', {
      createEndAt: session.createEndAt ?? now,
      pausedAt: null,
      remainingMs: null,
      graceEndAt: now + session.config.graceMs,
    });
  }

  forceCloseCreation(code, token) {
    return this.closeCreation(this.requireHost(code, token));
  }

  /**
   * UPLOAD -> DIFFUSION.
   *
   * L'ordre de passage est tire ici, une fois pour toutes, et conserve : il
   * doit etre le meme sur les trois surfaces et survivre a un redemarrage.
   * Le retirer a chaque affichage ferait defiler les rendus dans un ordre
   * different sur le grand ecran et sur les telephones.
   */
  startDiffusion(code, token) {
    return this.startDiffusionInternal(this.requireHost(code, token));
  }

  /**
   * Fenetre du rendu qui s'ouvre maintenant.
   *
   * L'ecoute demarre a cet instant pour tout le monde — un retardataire
   * reprend a la bonne seconde, pas au debut. Puis vient une fenetre de vote,
   * et enfin le passage au suivant, si la regie l'a laisse en automatique.
   * Deux instants absolus suffisent ; le client compte tout seul.
   */
  renditionTiming(session, submission, now = Date.now()) {
    // La duree d'ecoute est plafonnee par le reglage, mais aussi par le rendu
    // lui-meme quand le transcodage l'a mesure : un morceau de trente secondes
    // ne fait pas ecouter quinze secondes de silence.
    const measured = submission?.renditions?.durationMs;
    const timed = submission && (submission.kind === 'audio' || submission.kind === 'video');
    const playMs = session.config.playMaxS * 1000;
    const listenMs = timed && measured ? Math.min(playMs, Math.max(1000, measured)) : playMs;
    const endsAt = now + listenMs;
    return {
      diffusionStartedAt: now,
      diffusionEndsAt: endsAt,
      diffusionAdvanceAt: session.config.autoNext ? endsAt + session.config.voteWindowS * 1000 : null,
    };
  }

  /**
   * Positionne la diffusion sur un rendu et rouvre sa fenetre.
   *
   * Sert aussi bien au clic de la regie qu'a l'avancement automatique : une
   * seule facon de changer de rendu, un seul point de journal, un seul
   * rearmement du chrono.
   */
  seek(session, index, { restart = false } = {}) {
    const total = (session.order ?? []).length;
    if (!total) throw new BattleError('Aucun rendu a diffuser.');
    const next = clamp(Math.trunc(index), 0, total - 1);
    if (next === session.cursor && !restart) return session;

    const submission = repo.submission((session.order ?? [])[next]);
    session.patch({ cursor: next, ...this.renditionTiming(session, submission) });
    repo.logEvent(session.id, restart ? 'diffusion:replay' : 'diffusion:cursor', { index: next });
    this.arm(session);
    this.publish(session);
    return session;
  }

  requireDiffusion(code, token) {
    const s = this.requireHost(code, token);
    if (s.phase !== 'diffusion') throw new BattleError('La diffusion n’est pas en cours.');
    return s;
  }

  /** Deplacement dans la file, pilote par la regie. */
  moveCursor(code, token, { delta, index } = {}) {
    const s = this.requireDiffusion(code, token);
    const target = Number.isFinite(index) ? Math.trunc(index) : s.cursor + Math.trunc(delta ?? 0);
    return this.seek(s, target);
  }

  /** Relance le rendu en cours depuis le debut, pour tout le monde. */
  replayRendition(code, token) {
    const s = this.requireDiffusion(code, token);
    return this.seek(s, s.cursor, { restart: true });
  }

  /**
   * Bascule entre avancement automatique et manuel, en pleine diffusion.
   *
   * L'animateur qui veut commenter un rendu coupe l'automatique ; quand il le
   * remet, la fenetre du rendu en cours est recalculee depuis son ouverture —
   * avec trois secondes de battement si elle est deja depassee, pour que la
   * bascule ne fasse pas sauter le rendu sous les yeux de la salle.
   */
  setAutoNext(code, token, on) {
    const s = this.requireHost(code, token);
    if (s.phase !== 'upload' && s.phase !== 'diffusion') {
      throw new BattleError('Ce reglage se change pendant la diffusion.');
    }
    const enabled = on !== false;
    const patch = { config: { ...s.config, autoNext: enabled } };
    if (s.phase === 'diffusion' && s.diffusionEndsAt) {
      patch.diffusionAdvanceAt = enabled
        ? Math.max(Date.now() + 3000, s.diffusionEndsAt + s.config.voteWindowS * 1000)
        : null;
    }
    s.patch(patch);
    repo.logEvent(s.id, 'diffusion:auto', { on: enabled });
    this.arm(s);
    this.publish(s);
    return s;
  }

  /**
   * Une note.
   *
   * Trois refus, tous cote serveur : on ne note pas son propre rendu, on ne
   * note pas un rendu qui n'est pas encore passe, et on ne note pas hors du
   * bareme. Griser le bouton dans la page ne protege de rien — c'est ici que
   * la regle tient.
   */
  castVote(code, participantId, token, data) {
    const { session, participant } = this.requireParticipant(code, participantId, token);
    return this.voteAs(session, participant, data);
  }

  /**
   * Meme regle, participant deja authentifie.
   *
   * Une socket a presente son jeton en entrant ; le redemander a chaque etoile
   * cliquee ferait circuler le secret des dizaines de fois par soiree pour
   * n'apporter aucune garantie de plus.
   */
  voteAs(session, participant, { renditionId, criterionId, value } = {}) {
    if (session.phase !== 'diffusion') throw new BattleError('Les votes sont fermes.');
    if (participant.disqualified) throw new BattleError('Vous etes hors classement.', 403);

    const submission = repo.submissionByRendition(String(renditionId || ''));
    if (!submission || submission.sessionId !== session.id) throw new BattleError('Rendu introuvable.', 404);

    const position = (session.order ?? []).indexOf(submission.id);
    if (position < 0) throw new BattleError('Ce rendu ne fait pas partie de la diffusion.', 404);
    // On peut revenir sur un passage deja vu — quelqu'un qui a rate une note
    // doit pouvoir la rattraper — mais pas voter en avance sur ce que
    // l'animateur n'a pas encore diffuse.
    if (position > session.cursor) throw new BattleError('Ce rendu n’est pas encore passe.');

    if (submission.participantId === participant.id) {
      throw new BattleError('On ne note pas sa propre creation.', 403);
    }

    const criteria = session.config.criteria.length
      ? session.config.criteria.map((c) => c.id)
      : ['_'];
    const criterion = criteria.includes(String(criterionId)) ? String(criterionId) : criteria[0];

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new BattleError('Note invalide.');
    const bounded = clamp(numeric, 0, session.config.scale);

    repo.castVote({
      sessionId: session.id,
      submissionId: submission.id,
      voterId: participant.id,
      criterionId: criterion,
      value: bounded,
    });

    this.maybeAdvanceEarly(session, submission, position);
    this.publish(session);
    this.publishYou(session, participant);
    return { session, participant, value: bounded, criterionId: criterion };
  }

  /**
   * Quand tout le monde a note, la fenetre de vote n'a plus de raison d'etre.
   *
   * On ne coupe jamais l'ecoute elle-meme — avancer a la vingtieme seconde
   * d'un morceau parce que les votes sont rentres serait brutal pour l'auteur.
   * On ramene seulement le passage au suivant a la fin de l'ecoute, ou a trois
   * secondes si l'ecoute est deja finie : le temps de voir le compteur
   * atteindre son total.
   */
  maybeAdvanceEarly(session, submission, position) {
    if (!session.config.autoNext || !session.diffusionAdvanceAt) return;
    if (position !== session.cursor) return;
    const eligible = session.eligibleVoters(submission);
    if (eligible === 0 || repo.countVoters(submission.id) < eligible) return;

    const soon = Math.max(session.renditionEndsAt(), Date.now() + 3000);
    if (soon >= session.diffusionAdvanceAt) return;
    session.patch({ diffusionAdvanceAt: soon });
    repo.logEvent(session.id, 'diffusion:all-voted', { index: position });
    this.arm(session);
  }

  /**
   * Revelation progressive du classement.
   *
   * Du dernier vers le premier, un cran par appel. `revealedRank` compte les
   * places deja devoilees en partant du bas : le suspense se construit la, pas
   * dans une animation.
   */
  reveal(code, token, { all = false } = {}) {
    const s = this.requireHost(code, token);
    if (s.phase !== 'results') throw new BattleError('Le classement n’est pas encore affiche.');
    const total = (s.order ?? []).length;
    const current = s.revealedRank ?? 0;
    s.patch({ revealedRank: all ? total : Math.min(total, current + 1) });
    repo.logEvent(s.id, 'results:reveal', { revealed: s.revealedRank });
    this.publish(s);
    // Le classement complet n'est annonce a l'exterieur qu'une fois devoile
    // a la salle : une annonce Discord qui precederait le podium gacherait
    // la revelation.
    if (total > 0 && current < total && s.revealedRank >= total) {
      this.events.emit('results:complete', { session: s });
    }
    return s;
  }

  /* -------------------------- duplication ------------------------ */

  /**
   * Nouvelle edition d'une session.
   *
   * Reglages, type de rendu et consigne sont repris ; les participants, les
   * rendus et les votes ne le sont pas. Les elements imposes sont copies si on
   * le demande — c'est souvent le meme pack d'une edition a l'autre, et les
   * retirer coute un clic chacun la ou les redeposer coute un televersement.
   */
  async duplicate(code, token, { name, brief, copyAssets = true } = {}) {
    const src = this.requireHost(code, token);
    if (this.sessions.size >= config.limits.maxSessions) {
      throw new BattleError('Le serveur heberge deja trop de sessions ouvertes.');
    }

    const hostToken = newToken();
    const now = Date.now();
    const row = repo.createSession({
      id: uuid(),
      code: uniqueCode((c) => repo.codeTaken(c)),
      name: cleanPseudo(name, 60) || nextEditionName(src.name),
      hostTokenHash: hashToken(hostToken),
      phase: 'config',
      mediaType: src.mediaType,
      brief: brief !== undefined ? cleanText(brief, config.limits.maxBriefChars) : src.brief,
      config: { ...src.config },
      duplicatedFrom: src.id,
      createdAt: now,
    });
    const live = new LiveSession(row, []);
    this.sessions.set(live.code, live);

    if (copyAssets) {
      for (const asset of repo.assets(src.id)) {
        const id = uuid();
        const ext = asset.storageKey.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '';
        const key = `sessions/${live.id}/assets/${id}${ext}`;
        // Copie physique : les deux sessions ont des durees de vie differentes,
        // et purger l'ancienne ne doit pas trouer le pack de la nouvelle.
        await storage.put(key, storage.createReadStream(asset.storageKey));
        repo.addAsset({ ...asset, id, sessionId: live.id, storageKey: key, createdAt: now });
      }
    }

    repo.logEvent(live.id, 'session:duplicated', { from: src.code, assets: copyAssets });
    return { session: live, hostToken };
  }

  /** DIFFUSION -> RESULTATS. */
  showResults(code, token) {
    const s = this.requireHost(code, token);
    // Rien n'est devoile a l'arrivee : l'animateur declenche chaque cran.
    this.setPhase(s, 'results', { endedAt: Date.now(), revealedRank: 0 });
    // Sans aucun rendu, il n'y a rien a devoiler : le classement est complet
    // des l'affichage, et les modules qui l'attendent doivent le savoir.
    if (!(s.order ?? []).length) this.events.emit('results:complete', { session: s });
    return s;
  }

  archive(code, token) {
    const s = this.requireHost(code, token);
    return this.setPhase(s, 'archived', { endedAt: s.endedAt ?? Date.now() });
  }

  /* ---------------------------- chrono --------------------------- */

  /**
   * Prochaine echeance de la session, ou null s'il n'y en a pas.
   *
   * Un seul `setTimeout` a la fois par session, cale sur cette valeur. Aucun
   * battement de coeur periodique : les clients recoivent des instants absolus
   * et comptent eux-memes, ce qui laisse le serveur silencieux entre deux
   * changements de phase meme avec deux cents telephones connectes.
   */
  nextDeadline(session) {
    if (session.phase === 'creation' && !session.pausedAt) return session.createEndAt ?? null;
    if (session.phase === 'upload') return session.graceEndAt ?? null;
    if (session.phase === 'diffusion' && session.config.autoNext && session.diffusionAdvanceAt) {
      // Sur le dernier rendu, une echeance deja passee n'a plus rien a
      // declencher : la regie garde la main sur le passage aux resultats.
      const last = session.cursor >= (session.order ?? []).length - 1;
      if (last && session.diffusionAdvanceAt <= Date.now()) return null;
      return session.diffusionAdvanceAt;
    }
    return null;
  }

  arm(session) {
    this.disarm(session.code);
    const at = this.nextDeadline(session);
    if (at === null) return;

    const timer = setTimeout(() => this.onDeadline(session.code), Math.max(0, at - Date.now()));
    // Une echeance ne doit pas retenir le process a l'arret.
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(session.code, timer);
  }

  disarm(code) {
    const timer = this.timers.get(code);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(code);
    }
  }

  onDeadline(code) {
    const s = this.get(code);
    if (!s) return;
    const at = this.nextDeadline(s);
    if (at === null) return;

    // `setTimeout` peut rendre la main quelques millisecondes trop tot ; on
    // repousse plutot que de clore une phase avant l'heure annoncee.
    const late = Date.now() - at;
    if (late < -20) {
      this.arm(s);
      return;
    }

    if (s.phase === 'creation') {
      this.closeCreation(s);
      return;
    }
    if (s.phase === 'upload') {
      repo.logEvent(s.id, 'upload:grace-over', null);
      this.disarm(code);
      // La regie garde la main sur le depart de la diffusion, sauf si elle a
      // demande l'enchainement automatique.
      if (s.config.autoAdvance) this.startDiffusionInternal(s);
      else this.publish(s);
      return;
    }
    if (s.phase === 'diffusion') {
      const total = (s.order ?? []).length;
      if (s.cursor < total - 1) {
        this.seek(s, s.cursor + 1);
      } else {
        // Dernier rendu ecoule : on le signale, sans passer aux resultats. Le
        // suspense de la revelation appartient a l'animateur.
        repo.logEvent(s.id, 'diffusion:complete', null);
        this.disarm(code);
        this.publish(s);
      }
    }
  }

  /** Depart de la diffusion sans jeton : appele par l'echeance de grace. */
  startDiffusionInternal(session) {
    // Un rendu encore en traitement n'a ni extrait nettoye ni duree : on ne
    // lance pas la diffusion avec un anonymat a moitie garanti. Le transcodage
    // d'un morceau prend quelques secondes ; l'animateur reessaie.
    const pending = repo.countPendingSubmissions(session.id);
    if (pending > 0) {
      throw new BattleError(`${pending} rendu${pending > 1 ? 's' : ''} encore en traitement. Patientez quelques secondes.`);
    }
    const all = repo.submissions(session.id);
    const eligible = all.filter((sub) => {
      const author = session.participants.get(sub.participantId);
      return sub.status === 'ready' && author && !author.disqualified;
    });
    const order = shuffle(eligible.map((x) => x.id));
    const first = order.length ? eligible.find((x) => x.id === order[0]) : null;
    return this.setPhase(session, 'diffusion', {
      order,
      cursor: 0,
      ...(first
        ? this.renditionTiming(session, first)
        : { diffusionStartedAt: null, diffusionEndsAt: null, diffusionAdvanceAt: null }),
    });
  }

  /**
   * Un rendu a change d'etat — recu, en traitement, pret.
   *
   * Appele par l'ouvrier de transcodage : la regie voit son compteur bouger et
   * l'auteur voit « pret » remplacer « traitement en cours ».
   */
  onSubmissionChanged(submission) {
    const session = [...this.sessions.values()].find((s) => s.id === submission.sessionId);
    if (!session) return;
    this.publish(session);
    const participant = session.participants.get(submission.participantId);
    if (participant) this.publishYou(session, participant);
  }

  /* --------------------------- presence -------------------------- */

  attachHost(socket, session) {
    // Une regie qui change de session — nouvelle edition — quitte l'ancienne :
    // sinon elle recevrait deux etats contradictoires.
    if (socket.data.code && socket.data.code !== session.code) {
      const previous = this.get(socket.data.code);
      if (previous) {
        previous.hostSockets.delete(socket.id);
        socket.leave(roomHost(previous.code));
      }
    }
    socket.join(roomHost(session.code));
    session.hostSockets.add(socket.id);
    socket.data.code = session.code;
    socket.data.role = 'host';
    this.publish(session);
  }

  attachScreen(socket, session) {
    socket.join(roomScreen(session.code));
    session.screenSockets.add(socket.id);
    socket.data.code = session.code;
    socket.data.role = 'screen';
  }

  attachParticipant(socket, session, participant) {
    socket.join(roomAll(session.code));
    if (!session.presence.has(participant.id)) session.presence.set(participant.id, new Set());
    session.presence.get(participant.id).add(socket.id);
    socket.data.code = session.code;
    socket.data.role = 'participant';
    socket.data.participantId = participant.id;

    const now = Date.now();
    participant.lastSeenAt = now;
    repo.touchParticipant(participant.id, now);
    this.publish(session);
  }

  detach(socket) {
    const s = this.get(socket.data.code);
    if (!s) return;
    s.hostSockets.delete(socket.id);
    s.screenSockets.delete(socket.id);
    const pid = socket.data.participantId;
    if (pid) {
      const set = s.presence.get(pid);
      if (set) {
        set.delete(socket.id);
        if (!set.size) s.presence.delete(pid);
      }
    }
    this.publish(s);
  }

  /* -------------------------- diffusion -------------------------- */

  /**
   * Envoi de l'etat aux trois surfaces.
   *
   * Les salons sont disjoints : une socket de regie n'est pas dans le salon
   * general, sinon elle recevrait deux etats contradictoires pour le meme
   * evenement — celui de tout le monde, puis le sien.
   */
  publish(session) {
    if (!session) return;
    this.io.to(roomAll(session.code)).emit('state', views.participantView(session));
    this.io.to(roomHost(session.code)).emit('state', views.hostView(session));
    this.io.to(roomScreen(session.code)).emit('state', views.screenView(session));
  }

  /** Participant attache a une socket, deja authentifie a l'entree. */
  participantOfSocket(socket) {
    const session = this.get(socket.data.code);
    const participant = session?.participants.get(socket.data.participantId);
    if (!session || !participant) throw new BattleError('Rejoignez la session pour voter.', 403);
    return { session, participant };
  }

  /** Etat personnel d'un participant, sur ses propres sockets uniquement. */
  publishYou(session, participant) {
    const sockets = session.presence.get(participant.id);
    if (!sockets) return;
    const payload = views.youView(session, participant);
    for (const id of sockets) this.io.to(id).emit('you', payload);
  }

  /* ---------------------------- entretien ------------------------ */

  /**
   * Purge des sessions perimees.
   *
   * Les fichiers partent avant la ligne en base : l'inverse laisserait sur le
   * disque des octets que plus rien ne reference, et que personne ne pense a
   * aller chercher.
   */
  sweep(removeFiles = async () => {}) {
    const now = Date.now();
    const expired = repo.expiredSessions(
      now - config.retentionHours * 3600 * 1000,
      now - config.staleHours * 3600 * 1000,
    );
    const done = [];
    for (const row of expired) {
      this.disarm(row.code);
      this.sessions.delete(row.code);
      done.push(
        Promise.resolve(removeFiles(row))
          .catch(() => {})
          .then(() => repo.deleteSession(row.id)),
      );
    }
    return Promise.all(done).then(() => expired.length);
  }
}

/** « Beat Battle #12 » devient « Beat Battle #13 » ; sinon on numerote. */
function nextEditionName(name) {
  const numbered = /^(.*?)(\d+)\s*$/.exec(name);
  if (numbered) return `${numbered[1]}${Number(numbered[2]) + 1}`.slice(0, 60);
  return `${name} #2`.slice(0, 60);
}

module.exports = {
  BattleServer, BattleError, LiveSession, PHASES, TRANSITIONS, sanitizeConfig, nextEditionName,
  // Noms des salons Socket.IO, pour les modules qui parlent aux ecrans.
  roomAll, roomHost, roomScreen,
};
