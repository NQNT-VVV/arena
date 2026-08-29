'use strict';

/**
 * Serveur unique : Next rend les pages, Express tient l'API, Socket.IO tient le
 * temps reel — le tout sur le meme port et le meme process, comme Refrain.
 *
 * Un seul port simplifie tout ce qui vient apres : une regle d'ingress, un
 * certificat, aucun probleme d'origine croisee pour la socket.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const next = require('next');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const config = require('./config');
const metrics = require('./metrics');
const storage = require('./storage');
const { BattleServer } = require('./battle');

const ROOT_DIR = path.join(__dirname, '..');

const nextApp = next({ dev: config.dev, dir: ROOT_DIR });
const renderPage = nextApp.getRequestHandler();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 20000,
  // Les fichiers passent par HTTP, pas par la socket : une trame de plus d'un
  // mega-octet ne peut etre qu'une erreur ou une tentative de saturation.
  maxHttpBufferSize: 1e6,
});

const battle = new BattleServer(io);
metrics.bind(battle);

/* ------------------------------------------------------------------ */
/* Garde-fous                                                          */
/* ------------------------------------------------------------------ */

/**
 * Limiteur a fenetre fixe, en memoire.
 *
 * Volontairement grossier : il ne protege pas d'une attaque distribuee, il
 * empeche un script maladroit ou un onglet en boucle de creer mille sessions.
 * Un vrai limiteur suppose un stockage partage, donc une dependance de plus
 * pour un risque que ce service n'a pas.
 */
function limiter({ points, windowMs }) {
  let hits = new Map();
  setInterval(() => { hits = new Map(); }, windowMs).unref();
  return (key) => {
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    return n <= points;
  };
}

const createLimit = limiter({ points: 20, windowMs: 60 * 1000 });
const joinLimit = limiter({ points: 60, windowMs: 60 * 1000 });

const addressOf = (socket) => socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim()
  || socket.handshake.address
  || 'inconnu';

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => {
  res.json({ ok: true, sessions: battle.sessions.size, storage: storage.name, uptime: Math.round(process.uptime()) });
});

/**
 * Carte de visite d'une session, avant de la rejoindre.
 *
 * Assez pour que la page d'accueil affiche « Beat Battle #12 — audio » et que
 * le participant sache qu'il ne s'est pas trompe de code. Rien de plus : ni
 * consigne, ni liste de presents, tant qu'il n'est pas entre.
 */
app.get('/api/session/:code', (req, res) => {
  const s = battle.get(req.params.code);
  if (!s) return res.status(404).json({ exists: false });
  res.json({
    exists: true,
    code: s.code,
    name: s.name,
    mediaType: s.mediaType,
    phase: s.phase,
    open: BattleServer.JOINABLE.has(s.phase),
    participants: s.participants.size,
  });
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 512);
  if (!text) return res.status(400).send('parametre « text » manquant');
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: String(req.query.dark || '#07060E'), light: String(req.query.light || '#FFFFFF') },
    });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/** Lien court d'invitation : /j/ABC123 */
app.get('/j/:code', (req, res) => {
  res.redirect(`/play?code=${encodeURIComponent(String(req.params.code).toUpperCase())}`);
});

/* ------------------------------------------------------------------ */
/* Temps reel                                                          */
/* ------------------------------------------------------------------ */

const ok = (cb, data = {}) => typeof cb === 'function' && cb({ ok: true, ...data });
const fail = (cb, message) => typeof cb === 'function' && cb({ ok: false, error: message });

/**
 * Enveloppe commune a tous les gestionnaires.
 *
 * Une `BattleError` porte un message ecrit pour un humain et repart tel quel ;
 * tout le reste est un bug, journalise cote serveur et resume cote client. Sans
 * cette separation, ou bien on fuit des traces d'execution dans l'interface, ou
 * bien on repond « erreur » a des refus parfaitement explicables.
 */
function guard(cb, fn) {
  try {
    const result = fn();
    ok(cb, result || {});
  } catch (err) {
    if (err && err.expected) {
      metrics.socketErrors.inc({ kind: 'refuse' });
      fail(cb, err.message);
      return;
    }
    console.error('[arena] erreur interne :', err);
    metrics.socketErrors.inc({ kind: 'interne' });
    fail(cb, 'Erreur interne du serveur.');
  }
}

const views = require('./views');

io.on('connection', (socket) => {
  /**
   * Reference d'horloge.
   *
   * Le client interroge plusieurs fois et garde la mediane : c'est ce qui lui
   * permet d'afficher la meme seconde que tous les autres ecrans, meme si son
   * telephone a deux secondes d'avance.
   */
  socket.on('time:sync', (payload, cb) => ok(cb, { serverNow: Date.now() }));

  /* ------------------------------- regie ------------------------------ */

  socket.on('host:create', (payload = {}, cb) => guard(cb, () => {
    if (!createLimit(addressOf(socket))) throw Object.assign(new Error('Trop de sessions creees. Patientez une minute.'), { expected: true });
    const { session, hostToken } = battle.createSession(payload);
    socket.data.hostToken = hostToken;
    battle.attachHost(socket, session);
    return { code: session.code, hostToken, state: views.hostView(session) };
  }));

  /** Reprise de la regie apres un rafraichissement : le jeton vient du navigateur. */
  socket.on('host:attach', ({ code, hostToken } = {}, cb) => guard(cb, () => {
    const session = battle.requireHost(code, hostToken);
    socket.data.hostToken = hostToken;
    battle.attachHost(socket, session);
    return { code: session.code, state: views.hostView(session) };
  }));

  /**
   * Actions de regie.
   *
   * Le jeton est lu sur la socket, pas dans la charge utile : il a ete presente
   * une fois a l'attachement et n'a aucune raison de repasser sur le reseau a
   * chaque clic.
   */
  const hostActions = {
    'host:configure': (s, p) => battle.configure(s, socket.data.hostToken, p),
    'host:publish': (s) => battle.publishSession(s, socket.data.hostToken),
    'host:unpublish': (s) => battle.unpublish(s, socket.data.hostToken),
    'host:start': (s) => battle.start(s, socket.data.hostToken),
    'host:pause': (s) => battle.pause(s, socket.data.hostToken),
    'host:resume': (s) => battle.resume(s, socket.data.hostToken),
    'host:add-time': (s, p) => battle.addTime(s, socket.data.hostToken, p?.deltaMs),
    'host:close-creation': (s) => battle.forceCloseCreation(s, socket.data.hostToken),
    'host:start-diffusion': (s) => battle.startDiffusion(s, socket.data.hostToken),
    'host:results': (s) => battle.showResults(s, socket.data.hostToken),
    'host:archive': (s) => battle.archive(s, socket.data.hostToken),
    'host:disqualify': (s, p) => battle.setDisqualified(s, socket.data.hostToken, p?.participantId, p?.on),
  };

  for (const [event, action] of Object.entries(hostActions)) {
    socket.on(event, (payload = {}, cb) => guard(cb, () => {
      const code = socket.data.code;
      if (!code || socket.data.role !== 'host') {
        throw Object.assign(new Error('Cette socket ne pilote aucune session.'), { expected: true });
      }
      const session = action(code, payload);
      metrics.transitions.inc({ to: session.phase });
      return { state: views.hostView(session) };
    }));
  }

  /* ---------------------------- participant --------------------------- */

  socket.on('play:join', (payload = {}, cb) => guard(cb, () => {
    if (!joinLimit(addressOf(socket))) throw Object.assign(new Error('Trop de tentatives. Patientez une minute.'), { expected: true });
    const { session, participant, token } = battle.join(payload.code, payload);
    battle.attachParticipant(socket, session, participant);
    return {
      token,
      participantId: participant.id,
      you: views.youView(session, participant),
      state: views.participantView(session),
    };
  }));

  socket.on('play:leave', (payload, cb) => guard(cb, () => {
    if (socket.data.role === 'participant') battle.leave(socket.data.code, socket.data.participantId);
    socket.data.role = null;
    socket.data.participantId = null;
    return {};
  }));

  /* ------------------------------ ecran ------------------------------- */

  socket.on('screen:attach', ({ code } = {}, cb) => guard(cb, () => {
    const session = battle.require(code);
    battle.attachScreen(socket, session);
    return { state: views.screenView(session) };
  }));

  socket.on('disconnect', () => battle.detach(socket));
});

/* ------------------------------------------------------------------ */
/* Entretien                                                           */
/* ------------------------------------------------------------------ */

/**
 * Purge horaire.
 *
 * Les fichiers d'une session partent avec elle : sans cela le volume grossit
 * jusqu'a saturer, et c'est toujours au milieu d'une soiree que ca arrive.
 */
setInterval(() => {
  battle
    .sweep((row) => storage.removePrefix(`sessions/${row.id}`))
    .then((n) => { if (n) console.log(`[arena] ${n} session(s) purgee(s)`); })
    .catch((err) => console.error('[arena] purge :', err));
}, 60 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* Demarrage                                                           */
/* ------------------------------------------------------------------ */

app.all('*', (req, res) => renderPage(req, res));

nextApp.prepare().then(() => {
  server.listen(config.port, () => {
    console.log(`[arena] pret sur :${config.port} — stockage « ${storage.name} », ${battle.sessions.size} session(s) reprise(s)`);
  });
  metrics.serve();
}).catch((err) => {
  console.error('[arena] Next n’a pas demarre :', err);
  process.exit(1);
});

/** Arret propre : Kubernetes envoie SIGTERM et attend. */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[arena] ${signal} recu, fermeture`);
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

module.exports = { app, server, io, battle };
