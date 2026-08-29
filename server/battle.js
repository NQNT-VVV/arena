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

const config = require('./config');
const repo = require('./repo');
const views = require('./views');
const {
  uuid, uniqueCode, newToken, hashToken, tokenMatches,
  pickAvatar, cleanPseudo, cleanText, clamp,
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
function sanitizeConfig(raw = {}, base = config.defaults) {
  const merged = { ...base, ...raw };
  const scale = clamp(Math.round(Number(merged.scale) || base.scale), 2, 100);

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

  const playMaxS = clamp(Math.round(Number(merged.playMaxS) || base.playMaxS), 5, 600);

  return {
    durationMs: clamp(Math.round(Number(merged.durationMs) || base.durationMs), MIN_DURATION_MS, MAX_DURATION_MS),
    graceMs: clamp(Math.round(Number(merged.graceMs) ?? base.graceMs), 0, MAX_GRACE_MS),
    alerts,
    endSound: merged.endSound !== false,
    playMaxS,
    // Un fondu plus long que l'extrait ne veut rien dire.
    fadeOutS: clamp(Math.round(Number(merged.fadeOutS) ?? base.fadeOutS), 0, Math.min(10, playMaxS)),
    scale,
    defaultVote: clamp(Number(merged.defaultVote) ?? base.defaultVote, 0, scale),
    criteria,
    latePolicy: LATE_POLICIES.has(merged.latePolicy) ? merged.latePolicy : base.latePolicy,
    latePenalty: clamp(Number(merged.latePenalty) ?? base.latePenalty, 0, scale),
    hostVotes: merged.hostVotes === true,
    autoAdvance: merged.autoAdvance === true,
    allowedExt: (Array.isArray(merged.allowedExt) ? merged.allowedExt : [])
      .map((e) => String(e).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8))
      .filter(Boolean)
      .slice(0, 30),
    maxFileBytes: clamp(
      Math.round(Number(merged.maxFileBytes) || config.limits.maxFileBytes),
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

  join(code, { pseudo, participantId, token } = {}) {
    const s = this.require(code);

    // Retour d'un participant connu : un rafraichissement de page, un tunnel.
    if (participantId && token) {
      const known = s.participants.get(participantId);
      if (known && tokenMatches(token, known.tokenHash)) {
        const now = Date.now();
        known.lastSeenAt = now;
        repo.touchParticipant(known.id, now);
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

  /** UPLOAD -> DIFFUSION. L'ordre de passage est tire ici, une fois pour toutes. */
  startDiffusion(code, token) {
    const s = this.requireHost(code, token);
    // L'ordre viendra des rendus reellement televerses (increment televersement).
    return this.setPhase(s, 'diffusion', { order: [], cursor: 0 });
  }

  /** DIFFUSION -> RESULTATS. */
  showResults(code, token) {
    const s = this.requireHost(code, token);
    return this.setPhase(s, 'results', { endedAt: Date.now(), revealedRank: null });
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
      if (s.config.autoAdvance) this.setPhase(s, 'diffusion', { order: [], cursor: 0 });
      else this.publish(s);
    }
  }

  /* --------------------------- presence -------------------------- */

  attachHost(socket, session) {
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

module.exports = { BattleServer, BattleError, LiveSession, PHASES, TRANSITIONS, sanitizeConfig };
