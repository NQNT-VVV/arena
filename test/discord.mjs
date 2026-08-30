/**
 * Module Discord.
 *
 * Un faux webhook local recoit ce que le serveur poste. On verifie les trois
 * annonces — lobby, depart, classement — et surtout ce qui n'est pas annonce :
 * rien avant que le classement soit devoile a la salle, et rien du tout quand
 * le module n'est pas configure.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
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

/* --------------------------- faux webhook --------------------------- */

const received = [];
const hook = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    received.push({ method: req.method, url: req.url, body: JSON.parse(body || 'null') });
    res.writeHead(204).end();
  });
});
await new Promise((r) => hook.listen(0, '127.0.0.1', r));
const HOOK_URL = `http://127.0.0.1:${hook.address().port}/webhooks/fake`;

/* ------------------------------ serveur ------------------------------ */

const PORT = 4160 + Math.floor(Math.random() * 30);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = `/tmp/arena-dc-${process.pid}`;
rmSync(DATA_DIR, { recursive: true, force: true });

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production', PORT: String(PORT), METRICS_PORT: String(PORT + 300),
    DATA_DIR, SESSION_SECRET: 'dc-secret',
    DISCORD_WEBHOOK_URL: HOOK_URL,
    PUBLIC_URL: 'https://arena.example.test',
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
async function waitPosts(n, tries = 40) {
  for (let i = 0; i < tries; i++) { if (received.length >= n) return; await sleep(100); }
  throw new Error(`${received.length} annonce(s) recue(s), ${n} attendue(s)`);
}

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

await waitForHealth();
const host = io(BASE, { transports: ['websocket'], forceNew: true });
await new Promise((r) => host.once('connect', r));
const { code, hostToken } = await call(host, 'host:create', { name: 'Battle annoncee', mediaType: 'audio', config: { durationMs: 90 * 60_000 } });

/** Un participant et son rendu : sans eux, il n'y aurait rien a devoiler. */
async function oneSubmission() {
  const sock = io(BASE, { transports: ['websocket'], forceNew: true });
  await new Promise((r) => sock.once('connect', r));
  const j = await call(sock, 'play:join', { code, pseudo: 'Solo' });
  const fd = new FormData();
  fd.append('files', new Blob([Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(200, 3)])]), 'solo.wav');
  const res = await fetch(`${BASE}/api/session/${code}/submission`, {
    method: 'POST', headers: { 'X-Arena-Token': j.token, 'X-Arena-Participant': j.participantId }, body: fd,
  });
  assert.equal(res.status, 200, await res.text());
  for (let i = 0; i < 60; i++) {
    const st = (await call(host, 'host:attach', { code, hostToken })).state;
    if (st.pendingSubmissions === 0) break;
    await sleep(150);
  }
  sock.close();
}

test('module actif : le serveur le dit au demarrage', () => {
  assert.ok(log.join('').includes('annonces Discord actives'));
});

test('lobby : une annonce avec le lien d’invitation', async () => {
  assert.equal(received.length, 0, 'rien tant que la session est en preparation');
  await call(host, 'host:publish');
  await waitPosts(1);
  const post = received[0];
  assert.equal(post.method, 'POST');
  assert.equal(post.body.username, 'Arena');
  const text = JSON.stringify(post.body);
  assert.ok(text.includes('Battle annoncee'));
  assert.ok(text.includes(`https://arena.example.test/j/${code}`), 'le lien court, construit sur PUBLIC_URL');
  assert.ok(text.includes('1 h 30'), 'la duree, lisible');
});

test('depart : une seconde annonce', async () => {
  await call(host, 'host:start');
  await waitPosts(2);
  assert.ok(JSON.stringify(received[1].body).includes('parti'));
});

test('classement : rien avant la revelation complete, puis une seule annonce', async () => {
  await oneSubmission();
  await call(host, 'host:close-creation');
  const d = await call(host, 'host:start-diffusion');
  assert.equal(d.ok, true, d.error);
  await call(host, 'host:results');
  await sleep(300);
  assert.equal(received.length, 2, 'les resultats affiches ne suffisent pas : la salle n’a encore rien vu');

  await call(host, 'host:reveal', { all: true });
  await waitPosts(3);
  const text = JSON.stringify(received[2].body);
  assert.ok(text.includes('Classement'));
  assert.ok(text.includes('Solo'), 'le podium nomme les auteurs — ils sont reveles');
  await call(host, 'host:reveal', { all: true });
  await sleep(200);
  assert.equal(received.length, 3, 'et une seule fois, meme si l’on redemande');
});

test('classement : sans aucun rendu, annonce des les resultats', async () => {
  const h2 = io(BASE, { transports: ['websocket'], forceNew: true });
  await new Promise((r) => h2.once('connect', r));
  await call(h2, 'host:create', { name: 'Vide', mediaType: 'text' });
  const before = received.length;
  await call(h2, 'host:publish');
  await call(h2, 'host:start');
  await call(h2, 'host:close-creation');
  await call(h2, 'host:start-diffusion');
  await call(h2, 'host:results');
  await waitPosts(before + 3);
  assert.ok(JSON.stringify(received[received.length - 1].body).includes('Aucun rendu'));
  h2.close();
});

test('sans configuration : le module ne s’attache pas', async () => {
  const quiet = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT + 1), METRICS_PORT: String(PORT + 301), DATA_DIR: `${DATA_DIR}-q`, SESSION_SECRET: 'q', DISCORD_WEBHOOK_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const qlog = [];
  quiet.stdout.on('data', (d) => qlog.push(String(d)));
  quiet.stderr.on('data', (d) => qlog.push(String(d)));
  for (let i = 0; i < 60; i++) { if (qlog.join('').includes('pret sur')) break; await sleep(200); }
  quiet.kill('SIGKILL');
  rmSync(`${DATA_DIR}-q`, { recursive: true, force: true });
  assert.ok(qlog.join('').includes('pret sur'), 'le serveur demarre');
  assert.ok(!qlog.join('').includes('annonces Discord'), 'et ne parle pas de Discord');
});

for (const [name, fn] of checks) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { console.error(`  FAIL ${name}\n       ${err.message}`); process.exitCode = 1; }
}

host.close();
hook.close();
server.kill('SIGTERM');
await sleep(300);
server.kill('SIGKILL');
rmSync(DATA_DIR, { recursive: true, force: true });
console.log(`\n${passed}/${checks.length} verifications passees`);
if (process.exitCode) console.log(`\n--- journal serveur ---\n${log.join('')}`);
