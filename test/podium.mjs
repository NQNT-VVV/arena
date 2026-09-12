/**
 * Integration Podium.
 *
 * Un faux hub local recoit ce que le serveur poste. On verifie les trois
 * promesses du module — l'identite lue dans le cookie signe, le classement
 * transmis une fois devoile, les variations d'Elo relayees aux ecrans — et
 * surtout ce qui ne doit pas se produire : un pid ecrit par le client n'est
 * jamais pris, un cookie falsifie ne vaut rien, et sans configuration le
 * module ne s'attache pas.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

if (!existsSync(new URL('../.next/BUILD_ID', import.meta.url))) {
  console.error('\n  Ce test demarre le serveur en production : il lui faut un build.\n\n      npm run build\n');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ faux hub ------------------------------ */

const GAME_KEY = 'cle-de-test';
const SSO_SECRET = 'secret-sso-de-test';
const received = [];
const hub = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const json = body ? JSON.parse(body) : null;
    received.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: json });
    if (req.headers.authorization !== `Bearer ${GAME_KEY}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'cle invalide' }));
      return;
    }
    const ratings = (json?.players ?? [])
      .filter((p) => p.pid)
      .map((p, i) => ({ pid: p.pid, before: 1000, after: 1000 + 18 - i * 20, tier: i === 0 ? 'Argent' : 'Bronze' }));
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ ok: true, matchId: json?.matchId, duplicate: false, ratings }));
  });
});
await new Promise((r) => hub.listen(0, '127.0.0.1', r));
const HUB_URL = `http://127.0.0.1:${hub.address().port}`;

/** Cookie d'identite tel que Podium le pose : payload signe en HMAC-SHA256. */
function cookieFor(payload, secret = SSO_SECRET) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `nqnt_id=${body}.${sig}`;
}
const inAnHour = Math.floor(Date.now() / 1000) + 3600;
const ALEXIS = cookieFor({ v: 1, pid: 'u_alexis', pseudo: 'Alexis', avatar: '\u{1F98A}', exp: inAnHour });
const NOA = cookieFor({ v: 1, pid: 'u_noa', pseudo: 'Noa', avatar: '\u{1F438}', exp: inAnHour });

/* ------------------------------ serveur ------------------------------ */

const PORT = 4200 + Math.floor(Math.random() * 30);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = `/tmp/arena-podium-${process.pid}`;
rmSync(DATA_DIR, { recursive: true, force: true });

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production', PORT: String(PORT), METRICS_PORT: String(PORT + 300),
    DATA_DIR, SESSION_SECRET: 'podium-secret',
    PODIUM_URL: `${HUB_URL}/`, PODIUM_GAME_KEY: GAME_KEY, PODIUM_SSO_SECRET: SSO_SECRET,
    DISCORD_WEBHOOK_URL: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const log = [];
server.stdout.on('data', (d) => log.push(String(d)));
server.stderr.on('data', (d) => log.push(String(d)));

async function waitForHealth(tries = 90) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* pas encore */ }
    await sleep(200);
  }
  throw new Error(`Le serveur n'a pas demarre.\n${log.join('')}`);
}
const call = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`pas de reponse a « ${event} »`)), 8000);
  socket.emit(event, payload, (res) => { clearTimeout(t); resolve(res); });
});
const connect = (cookie) => {
  const sock = io(BASE, { transports: ['websocket'], forceNew: true, extraHeaders: cookie ? { Cookie: cookie } : {} });
  return new Promise((r) => sock.once('connect', () => r(sock)));
};
async function waitPosts(n, tries = 40) {
  for (let i = 0; i < tries; i++) { if (received.length >= n) return; await sleep(100); }
  throw new Error(`${received.length} envoi(s) recu(s), ${n} attendu(s)`);
}
const wav = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(200, 3)]);

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

await waitForHealth();
const host = await connect();
const { code, hostToken } = await call(host, 'host:create', { name: 'Battle rankee', mediaType: 'audio', config: { durationMs: 20 * 60_000 } });

/** Depose un rendu et attend qu'il soit pret a diffuser. */
async function submit(j, name) {
  const fd = new FormData();
  fd.append('files', new Blob([wav()]), `${name}.wav`);
  const res = await fetch(`${BASE}/api/session/${code}/submission`, {
    method: 'POST', headers: { 'X-Arena-Token': j.token, 'X-Arena-Participant': j.participantId }, body: fd,
  });
  assert.equal(res.status, 200, await res.text());
  for (let i = 0; i < 80; i++) {
    const st = (await call(host, 'host:attach', { code, hostToken })).state;
    if (st.pendingSubmissions === 0) break;
    await sleep(150);
  }
}

test('module actif : le serveur le dit au demarrage', () => {
  assert.ok(log.join('').includes('integration Podium active'));
});

test('/api/podium/me : sans cookie, seulement l’adresse du hub', async () => {
  const me = await (await fetch(`${BASE}/api/podium/me`)).json();
  assert.equal(me.hubUrl, HUB_URL, 'le slash final de PODIUM_URL est retire');
  assert.equal(me.pid, undefined);
});

test('/api/podium/me : avec le cookie signe, l’identite', async () => {
  const me = await (await fetch(`${BASE}/api/podium/me`, { headers: { Cookie: ALEXIS } })).json();
  assert.equal(me.pid, 'u_alexis');
  assert.equal(me.pseudo, 'Alexis');
  assert.equal(me.avatar, '\u{1F98A}');
});

test('/api/podium/me : cookie falsifie, expire ou d’un autre secret — personne', async () => {
  const forged = ALEXIS.slice(0, -4) + 'AAAA';
  const expired = cookieFor({ v: 1, pid: 'u_alexis', pseudo: 'Alexis', exp: Math.floor(Date.now() / 1000) - 10 });
  const other = cookieFor({ v: 1, pid: 'u_alexis', pseudo: 'Alexis', exp: inAnHour }, 'un-autre-secret');
  for (const cookie of [forged, expired, other, 'nqnt_id=n.importe.quoi']) {
    const me = await (await fetch(`${BASE}/api/podium/me`, { headers: { Cookie: cookie } })).json();
    assert.equal(me.pid, undefined, `refuse : ${cookie.slice(0, 30)}…`);
  }
});

let alexis; let noa; let sam;
let alexisJoin; let noaJoin; let samJoin;

test('join : le compte vient du handshake, jamais de la charge utile', async () => {
  alexis = await connect(ALEXIS);
  // Les variations d'Elo arriveront sur cette socket, une fois le classement transmis.
  alexis.on('podium:ratings', (p) => { alexis.__ratings = p.ratings; });
  alexisJoin = await call(alexis, 'play:join', { code, pseudo: 'Alexis' });
  assert.equal(alexisJoin.ok, true, alexisJoin.error);

  // Sam n'a pas de cookie et tente de s'attribuer un compte dans le payload.
  sam = await connect();
  samJoin = await call(sam, 'play:join', { code, pseudo: 'Sam', podiumPid: 'u_alexis' });
  assert.equal(samJoin.ok, true, samJoin.error);

  // Noa entre sans compte, puis revient connectee : le lien se fait a la reprise.
  const anonymous = await connect();
  noaJoin = await call(anonymous, 'play:join', { code, pseudo: 'Noa' });
  assert.equal(noaJoin.ok, true, noaJoin.error);
  anonymous.close();
  noa = await connect(NOA);
  const back = await call(noa, 'play:join', { code, pseudo: 'Noa', participantId: noaJoin.participantId, token: noaJoin.token });
  assert.equal(back.ok, true, back.error);
  assert.equal(back.participantId, noaJoin.participantId, 'c’est bien une reprise');

  // Rien ne fuit dans les etats : le pid n'apparait sur aucune surface.
  const st = (await call(host, 'host:attach', { code, hostToken })).state;
  assert.ok(!JSON.stringify(st).includes('u_alexis'), 'le pid ne circule pas dans l’etat de regie');
});

test('classement : rien avant la revelation complete, puis un seul envoi', async () => {
  await call(host, 'host:publish');
  await call(host, 'host:start');
  await submit(alexisJoin, 'alexis');
  await submit(samJoin, 'sam');
  await submit(noaJoin, 'noa');
  await call(host, 'host:close-creation');
  const d = await call(host, 'host:start-diffusion');
  assert.equal(d.ok, true, d.error);
  await call(host, 'host:results');
  await sleep(300);
  assert.equal(received.length, 0, 'les resultats affiches ne suffisent pas : la salle n’a encore rien vu');

  await call(host, 'host:reveal', { all: true });
  await waitPosts(1);
  await call(host, 'host:reveal', { all: true });
  await sleep(200);
  assert.equal(received.length, 1, 'et une seule fois, meme si l’on redemande');

  const post = received[0];
  assert.equal(post.method, 'POST');
  assert.equal(post.url, '/api/v1/games/arena/results');
  assert.equal(post.auth, `Bearer ${GAME_KEY}`);
  const { body } = post;
  assert.equal(body.mode, 'audio');
  assert.equal(body.challengeId, null);
  assert.equal(typeof body.matchId, 'string');
  assert.equal(body.durationS, 20 * 60);
  assert.equal(body.meta.name, 'Battle rankee');
  assert.equal(body.meta.participants, 3);
  assert.equal(body.players.length, 3);
  assert.deepEqual(body.players.map((p) => p.rank).sort(), [1, 2, 3]);
  for (const p of body.players) {
    assert.equal(typeof p.score, 'number');
    assert.ok(p.avatar, 'chaque ligne porte un avatar');
  }
  const byName = Object.fromEntries(body.players.map((p) => [p.nickname, p]));
  assert.equal(byName.Alexis.pid, 'u_alexis', 'le cookie du handshake fait foi');
  assert.equal(byName.Sam.pid, null, 'le pid ecrit dans la charge utile est ignore');
  assert.equal(byName.Noa.pid, 'u_noa', 'rattachee a la reprise');
});

test('podium:ratings : les variations reviennent aux ecrans, par participant', async () => {
  // L'evenement part juste apres la reponse du hub : on lui laisse le temps.
  let ratings = null;
  for (let i = 0; i < 30 && !ratings; i++) { ratings = alexis.__ratings ?? null; if (!ratings) await sleep(100); }
  assert.ok(ratings, 'la socket d’Alexis a recu podium:ratings');
  const mine = ratings.find((r) => r.participantId === alexisJoin.participantId);
  assert.ok(mine, 'sa ligne est indexee par son identifiant de participant');
  assert.equal(mine.pseudo, 'Alexis');
  assert.equal(mine.before, 1000);
  assert.equal(typeof mine.delta, 'number');
  assert.ok(['Argent', 'Bronze'].includes(mine.tier));
  assert.ok(!ratings.some((r) => r.participantId === samJoin.participantId), 'Sam, sans compte, n’a pas d’Elo');
  assert.ok(!JSON.stringify(ratings).includes('u_alexis'), 'le pid ne descend pas jusqu’aux ecrans');
});

test('sans configuration : le module ne s’attache pas', async () => {
  const quiet = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT + 1), METRICS_PORT: String(PORT + 301), DATA_DIR: `${DATA_DIR}-q`, SESSION_SECRET: 'q', PODIUM_URL: '', DISCORD_WEBHOOK_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const qlog = [];
  quiet.stdout.on('data', (d) => qlog.push(String(d)));
  quiet.stderr.on('data', (d) => qlog.push(String(d)));
  for (let i = 0; i < 60; i++) { if (qlog.join('').includes('pret sur')) break; await sleep(200); }
  let me = null;
  try { me = await (await fetch(`http://127.0.0.1:${PORT + 1}/api/podium/me`, { headers: { Cookie: ALEXIS } })).json(); } catch { /* voir plus bas */ }
  quiet.kill('SIGKILL');
  rmSync(`${DATA_DIR}-q`, { recursive: true, force: true });
  assert.ok(qlog.join('').includes('pret sur'), 'le serveur demarre');
  assert.ok(!qlog.join('').includes('Podium'), 'et ne parle pas de Podium');
  assert.deepEqual(me, { hubUrl: null }, 'meme avec un cookie : sans hub, personne');
});

for (const [name, fn] of checks) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { console.error(`  FAIL ${name}\n       ${err.message}`); process.exitCode = 1; }
}

for (const s of [host, alexis, noa, sam]) s?.close?.();
hub.close();
server.kill('SIGTERM');
await sleep(300);
server.kill('SIGKILL');
rmSync(DATA_DIR, { recursive: true, force: true });
console.log(`\n${passed}/${checks.length} verifications passees`);
if (process.exitCode) console.log(`\n--- journal serveur ---\n${log.join('')}`);
