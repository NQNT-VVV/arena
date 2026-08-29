/**
 * Bout en bout, sur un vrai serveur.
 *
 * Le test de la machine a etats attaque les objets directement ; celui-ci
 * passe par le reseau, avec de vraies sockets. Il verifie ce que l'autre ne
 * peut pas voir : que les evenements portent les bons noms, que les salons
 * recoivent ce qu'il faut, qu'une socket de participant ne pilote rien, et
 * qu'une coupure de connexion se rattrape.
 */

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

const PORT = 3400 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = `/tmp/arena-e2e-${process.pid}`;
rmSync(DATA_DIR, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Serveur                                                             */
/* ------------------------------------------------------------------ */

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    METRICS_PORT: String(PORT + 1000),
    DATA_DIR,
    SESSION_SECRET: 'e2e-secret',
    DEFAULT_DURATION_S: '60',
    DEFAULT_GRACE_S: '60',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));

async function waitForHealth(tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return r.json();
    } catch { /* pas encore la */ }
    await sleep(200);
  }
  throw new Error(`Le serveur n'a pas demarre.\n${serverLog.join('')}`);
}

/* ------------------------------------------------------------------ */
/* Outils client                                                       */
/* ------------------------------------------------------------------ */

const connect = () => io(BASE, { transports: ['websocket'], forceNew: true });

const call = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Pas de reponse a « ${event} »`)), 8000);
  socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
});

/** Attend un `state` qui satisfait le predicat, ou echoue. */
function nextState(socket, predicate, label = 'etat attendu') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('state', onState);
      reject(new Error(`Delai depasse : ${label}`));
    }, 8000);
    const onState = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off('state', onState);
      resolve(payload);
    };
    socket.on('state', onState);
  });
}

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

/* ------------------------------------------------------------------ */

const health = await waitForHealth();
const sockets = [];
const open = () => { const s = connect(); sockets.push(s); return s; };
const ready = (s) => new Promise((r) => (s.connected ? r() : s.once('connect', r)));

let code;
let hostToken;
let host;
let alice;
let aliceIdentity;

test('sante : le serveur repond et annonce son stockage', () => {
  assert.equal(health.ok, true);
  assert.equal(health.storage, 'local');
});

test('horloge : time:sync renvoie un instant credible', async () => {
  const s = open();
  await ready(s);
  const before = Date.now();
  const res = await call(s, 'time:sync');
  assert.equal(res.ok, true);
  assert.ok(res.serverNow >= before - 1000 && res.serverNow <= Date.now() + 1000, 'instant serveur plausible');
});

test('regie : creation d’une session', async () => {
  host = open();
  await ready(host);
  const res = await call(host, 'host:create', {
    name: 'Beat Battle #12',
    mediaType: 'audio',
    brief: '5 samples imposes, aucun son externe.',
    config: { durationMs: 20 * 60_000, graceMs: 2 * 60_000, alerts: [600, 60], scale: 5, defaultVote: 3 },
  });
  assert.equal(res.ok, true, res.error);
  ({ code, hostToken } = res);
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(res.state.phase, 'config');
  assert.equal(res.state.isHost, true);
  assert.equal(res.state.config.durationMs, 20 * 60_000);
});

test('carte de visite : juste ce qu’il faut pour verifier le code', async () => {
  const card = await (await fetch(`${BASE}/api/session/${code}`)).json();
  assert.equal(card.exists, true);
  assert.equal(card.name, 'Beat Battle #12');
  assert.equal(card.mediaType, 'audio');
  // La consigne ne doit pas sortir avant d'etre entre.
  assert.equal(card.brief, undefined);
  assert.equal(card.roster, undefined);

  const unknown = await fetch(`${BASE}/api/session/ZZZZZZ`);
  assert.equal(unknown.status, 404);
});

test('lien court : /j/CODE renvoie vers la page participant', async () => {
  const r = await fetch(`${BASE}/j/${code}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/play?code=${code}`);
});

test('participant : entree, et la regie la voit arriver', async () => {
  await call(host, 'host:publish');
  alice = open();
  await ready(alice);

  // L'ecouteur se pose avant l'appel : sinon l'etat peut arriver pendant
  // l'attente de l'accuse de reception, et l'attente qui suit ne verrait rien.
  const seen = nextState(
    host,
    (s) => s.roster.some((p) => p.pseudo === 'Alice') && s.counts.connected === 1,
    'Alice en ligne dans le trombinoscope de la regie',
  );
  const res = await call(alice, 'play:join', { code, pseudo: 'Alice' });
  assert.equal(res.ok, true, res.error);
  aliceIdentity = { participantId: res.participantId, token: res.token };
  assert.equal(res.state.phase, 'lobby');
  assert.equal(res.you.pseudo, 'Alice');
  assert.ok(res.you.avatar.length > 0);
  // Le participant ne recoit aucun privilege de regie.
  assert.equal(res.state.isHost, undefined);

  const hostState = await seen;
  assert.equal(hostState.counts.participants, 1);
  assert.equal(hostState.counts.connected, 1);
});

test('participant : un pseudo deja pris est refuse', async () => {
  const s = open();
  await ready(s);
  const res = await call(s, 'play:join', { code, pseudo: 'alice' });
  assert.equal(res.ok, false);
  assert.match(res.error, /deja pris/);
});

test('regie : une socket de participant ne pilote rien', async () => {
  const res = await call(alice, 'host:start');
  assert.equal(res.ok, false);
  assert.match(res.error, /ne pilote aucune session/);
  // Et la session n'a pas bouge.
  const card = await (await fetch(`${BASE}/api/session/${code}`)).json();
  assert.equal(card.phase, 'lobby');
});

test('chrono : le depart pousse la meme echeance a tout le monde', async () => {
  const onAlice = nextState(alice, (s) => s.phase === 'creation', 'Alice passe en creation');
  const onHost = nextState(host, (s) => s.phase === 'creation', 'la regie passe en creation');
  const res = await call(host, 'host:start');
  assert.equal(res.ok, true, res.error);

  const [a, h] = await Promise.all([onAlice, onHost]);
  assert.equal(a.clock.createEndAt, h.clock.createEndAt, 'la meme echeance absolue pour les deux surfaces');
  assert.ok(a.clock.createEndAt > Date.now(), 'echeance dans le futur');
  // Aucune duree n'est transmise : seulement des instants.
  assert.equal(a.clock.remainingMs, null);
});

test('chrono : pause, ajout de temps, reprise', async () => {
  const paused = nextState(alice, (s) => s.clock.pausedAt !== null, 'Alice voit la pause');
  await call(host, 'host:pause');
  const p = await paused;
  assert.equal(p.clock.createEndAt, null, 'en pause, plus d’echeance absolue');
  assert.ok(p.clock.remainingMs > 0, 'le reste est fige et transmis');

  const before = p.clock.remainingMs;
  const added = nextState(alice, (s) => s.clock.remainingMs > before, 'Alice voit le temps ajoute');
  await call(host, 'host:add-time', { deltaMs: 5 * 60_000 });
  const withMore = await added;
  assert.ok(withMore.clock.remainingMs >= before + 5 * 60_000 - 50);

  const resumed = nextState(alice, (s) => s.clock.pausedAt === null && s.clock.createEndAt !== null, 'Alice voit la reprise');
  await call(host, 'host:resume');
  const r = await resumed;
  assert.ok(r.clock.createEndAt > Date.now());
});

test('ecran : recoit l’etat, sans aucun privilege', async () => {
  const screen = open();
  await ready(screen);
  const res = await call(screen, 'screen:attach', { code });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.state.isScreen, true);
  assert.equal(res.state.isHost, undefined);
  // Le grand ecran n'a pas les informations d'exploitation de la regie.
  assert.equal(res.state.roster[0].lastSeenAt, undefined);

  const bad = await call(screen, 'screen:attach', { code: 'ZZZZZZ' });
  assert.equal(bad.ok, false);
});

test('robustesse : une coupure ne coute pas sa place', async () => {
  const gone = nextState(host, (s) => s.counts.connected === 0, 'la regie voit Alice partir');
  alice.disconnect();
  const away = await gone;
  assert.equal(away.counts.participants, 1, 'toujours inscrite');
  assert.equal(away.counts.connected, 0, 'mais plus connectee');

  const back = open();
  await ready(back);
  const returning = nextState(host, (s) => s.counts.connected === 1, 'la regie la voit revenir');
  const res = await call(back, 'play:join', { code, pseudo: 'Alice', ...aliceIdentity });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.participantId, aliceIdentity.participantId, 'meme identite retrouvee');
  assert.equal(res.state.phase, 'creation', 'et la phase exacte, chrono compris');
  assert.ok(res.state.clock.createEndAt > Date.now());

  const returned = await returning;
  assert.equal(returned.counts.participants, 1, 'aucun doublon cree');
});

test('anonymat : la regie ne voit aucun auteur en diffusion', async () => {
  await call(host, 'host:close-creation');
  const diffusion = await (async () => {
    const p = nextState(host, (s) => s.phase === 'diffusion', 'passage en diffusion');
    await call(host, 'host:start-diffusion');
    return p;
  })();

  assert.equal(diffusion.phase, 'diffusion');
  // Le trombinoscope reste visible — savoir qui participe ne dit pas qui a fait
  // quoi — mais rien ne relie un rendu a un participant.
  assert.ok(diffusion.roster.length > 0);
  assert.equal(diffusion.podium, null);
  const serialised = JSON.stringify(diffusion.diffusion);
  assert.ok(!serialised.includes('Alice'), 'aucun auteur dans la charge utile de diffusion');
});

test('parcours complet : jusqu’a l’archive', async () => {
  await call(host, 'host:results');
  const card = await (await fetch(`${BASE}/api/session/${code}`)).json();
  assert.equal(card.phase, 'results');
  assert.equal(card.open, false, 'les inscriptions sont bien fermees');

  const res = await call(host, 'host:archive');
  assert.equal(res.ok, true, res.error);
  assert.equal(res.state.phase, 'archived');
});

test('metriques : exposees sur leur propre port', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT + 1000}/metrics`);
  assert.equal(r.ok, true);
  const body = await r.text();
  assert.match(body, /arena_sessions/);
  assert.match(body, /arena_phase_transitions_total/);
  // Rien de nominatif ne doit fuir par la supervision.
  assert.ok(!body.includes('Alice'));
});

/* ------------------------------------------------------------------ */

for (const [name, fn] of checks) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

for (const s of sockets) s.close();
server.kill('SIGTERM');
await sleep(300);
server.kill('SIGKILL');
rmSync(DATA_DIR, { recursive: true, force: true });

console.log(`\n${passed}/${checks.length} verifications passees`);
if (process.exitCode) console.log(`\n--- journal serveur ---\n${serverLog.join('')}`);
