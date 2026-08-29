/**
 * Depot des rendus, sur la plateforme.
 *
 * Le parcours d'un participant : il depose son fichier depuis la page, le
 * reecoute pour verifier, le remplace, le retire. Et les refus : trop tot,
 * trop tard, mauvais format, trop lourd, pas le bon jeton.
 *
 * Deux verifications d'anonymat comptent plus que les autres : personne ne
 * peut lire le rendu d'un autre avant la diffusion, et le nom du fichier —
 * « beat-alexis-v3.wav » annulerait tout le dispositif — ne sort qu'a la
 * revelation.
 */

import { spawn } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

if (!existsSync(new URL('../.next/BUILD_ID', import.meta.url))) {
  console.error('\n  Ce test demarre le serveur en production : il lui faut un build.\n\n      npm run build\n');
  process.exit(1);
}

const PORT = 3960 + Math.floor(Math.random() * 30);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = `/tmp/arena-sub-${process.pid}`;
rmSync(DATA_DIR, { recursive: true, force: true });

const MAX_FILE_BYTES = 40000;

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    METRICS_PORT: String(PORT + 400),
    DATA_DIR,
    SESSION_SECRET: 'sub-secret',
    MAX_FILE_BYTES: String(MAX_FILE_BYTES),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const log = [];
server.stdout.on('data', (d) => log.push(String(d)));
server.stderr.on('data', (d) => log.push(String(d)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(400, 7)]);
const WAV2 = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(900, 9)]);

const auth = (who) => ({ 'X-Arena-Token': who.token, 'X-Arena-Participant': who.participantId });

function submitFile(code, who, buf, name) {
  const fd = new FormData();
  fd.append('files', new Blob([buf]), name);
  return fetch(`${BASE}/api/session/${code}/submission`, { method: 'POST', headers: auth(who), body: fd });
}

const submitText = (code, who, body) => fetch(`${BASE}/api/session/${code}/submission`, {
  method: 'POST',
  headers: { ...auth(who), 'Content-Type': 'application/json' },
  body: JSON.stringify({ body }),
});

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

await waitForHealth();

const sockets = [];
const open = () => { const s = io(BASE, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
const ready = (s) => new Promise((r) => (s.connected ? r() : s.once('connect', r)));

const host = open();
await ready(host);
const { code, hostToken } = await call(host, 'host:create', {
  name: 'Beat Battle', mediaType: 'audio',
  config: { durationMs: 60 * 60_000, graceMs: 2 * 60_000, allowedExt: ['wav', 'mp3'] },
});
await call(host, 'host:publish');

const aliceSock = open(); await ready(aliceSock);
const bobSock = open(); await ready(bobSock);
const alice = await call(aliceSock, 'play:join', { code, pseudo: 'Alice' });
const bob = await call(bobSock, 'play:join', { code, pseudo: 'Bob' });

let aliceRendition = null;

test('refus : avant le depart de la creation', async () => {
  const res = await submitFile(code, alice, WAV, 'trop-tot.wav');
  const body = await res.json();
  assert.equal(res.status, 409, JSON.stringify(body));
  assert.match(body.error, /pas encore commence/);
});

test('depot : pendant la creation, sans attendre la fin', async () => {
  await call(host, 'host:start');
  const res = await submitFile(code, alice, WAV, 'mon-beat-alice-v3.wav');
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.late, false);
  assert.equal(body.submission.kind, 'audio');
  assert.equal(body.submission.bytes, WAV.length);
  assert.equal(body.submission.replacedCount, 0);
  assert.ok(body.submission.url.includes('?k='), 'un lien signe pour se relire');
  aliceRendition = body.submission.url.split('/').pop().split('?')[0];
});

test('la regie voit qui a rendu, et combien', async () => {
  const state = (await call(host, 'host:attach', { code, hostToken })).state;
  assert.equal(state.counts.submitted, 1);
  assert.equal(state.roster.find((p) => p.pseudo === 'Alice').hasSubmitted, true);
  assert.equal(state.roster.find((p) => p.pseudo === 'Bob').hasSubmitted, false);
});

test('relecture : l’auteur peut verifier son depot', async () => {
  const you = (await call(aliceSock, 'play:join', { code, pseudo: 'Alice', ...alice })).you;
  const res = await fetch(`${BASE}${you.submission.url}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  assert.equal((await res.arrayBuffer()).byteLength, WAV.length);
  // Lui connait deja son nom de fichier.
  assert.match(res.headers.get('content-disposition'), /mon-beat-alice-v3\.wav/);
});

test('anonymat : sans signature, le rendu est introuvable avant la diffusion', async () => {
  const res = await fetch(`${BASE}/api/media/${aliceRendition}`);
  assert.equal(res.status, 404, 'ni 403 : confirmer l’existence serait deja trop');

  const forged = await fetch(`${BASE}/api/media/${aliceRendition}?k=signature-inventee`);
  assert.equal(forged.status, 404);
});

test('anonymat : le rendu d’Alice n’apparait jamais chez Bob', async () => {
  const state = (await call(bobSock, 'play:join', { code, pseudo: 'Bob', ...bob })).state;
  const you = (await call(bobSock, 'play:join', { code, pseudo: 'Bob', ...bob })).you;
  assert.equal(you.submission, null, 'Bob n’a rien depose');
  const serialised = JSON.stringify({ state, you });
  assert.ok(!serialised.includes(aliceRendition), 'aucun identifiant de rendu etranger');
  assert.ok(!serialised.includes('mon-beat-alice'), 'aucun nom de fichier etranger');
});

test('remplacement : tant que la phase est ouverte', async () => {
  const res = await submitFile(code, alice, WAV2, 'mon-beat-v4.wav');
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.submission.replacedCount, 1);
  assert.equal(body.submission.bytes, WAV2.length);

  // L'ancien lien ne vaut plus rien : le remplacement change l'identifiant.
  assert.equal((await fetch(`${BASE}/api/media/${aliceRendition}`)).status, 404);
  aliceRendition = body.submission.url.split('/').pop().split('?')[0];

  const state = (await call(host, 'host:attach', { code, hostToken })).state;
  assert.equal(state.counts.submitted, 1, 'toujours un seul rendu pour Alice');
});

test('refus : format hors liste blanche', async () => {
  const res = await submitFile(code, bob, WAV, 'rendu.flac');
  const body = await res.json();
  assert.equal(res.status, 413, JSON.stringify(body));
  assert.match(body.error, /Format refuse/);
});

test('refus : fichier trop lourd', async () => {
  const gros = Buffer.alloc(MAX_FILE_BYTES + 5000, 0x41);
  const res = await submitFile(code, bob, gros, 'enorme.wav');
  assert.equal(res.status, 413);
  const state = (await call(host, 'host:attach', { code, hostToken })).state;
  assert.equal(state.counts.submitted, 1, 'aucun rendu fantome laisse derriere');
});

test('refus : sans jeton, ou avec celui d’un autre', async () => {
  const fd = new FormData();
  fd.append('files', new Blob([WAV]), 'pirate.wav');
  const nu = await fetch(`${BASE}/api/session/${code}/submission`, { method: 'POST', body: fd });
  assert.equal(nu.status, 403);

  const melange = await submitFile(code, { participantId: alice.participantId, token: bob.token }, WAV, 'x.wav');
  assert.equal(melange.status, 403);
});

test('retrait : par son auteur, tant que les depots sont ouverts', async () => {
  const res = await fetch(`${BASE}/api/session/${code}/submission`, { method: 'DELETE', headers: auth(alice) });
  assert.equal(res.status, 200, await res.text());
  const state = (await call(host, 'host:attach', { code, hostToken })).state;
  assert.equal(state.counts.submitted, 0);
  assert.equal((await fetch(`${BASE}/api/media/${aliceRendition}`)).status, 404);

  // Et on peut redeposer derriere.
  const back = await submitFile(code, alice, WAV, 'final.wav');
  assert.equal(back.status, 200);
  aliceRendition = (await back.json()).submission.url.split('/').pop().split('?')[0];
});

test('diffusion : le rendu devient lisible, mais reste sans nom', async () => {
  await call(host, 'host:close-creation');
  await call(host, 'host:start-diffusion');

  const res = await fetch(`${BASE}/api/media/${aliceRendition}`);
  assert.equal(res.status, 200, 'lisible en diffusion, sans signature');
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  // Le nom d'origine trahirait l'auteur : il est remplace.
  assert.match(res.headers.get('content-disposition'), /rendu\.wav/);
  assert.ok(!res.headers.get('content-disposition').includes('final.wav'));
});

test('revelation : le nom d’origine revient aux resultats', async () => {
  await call(host, 'host:results');
  const res = await fetch(`${BASE}/api/media/${aliceRendition}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /final\.wav/);
});

test('texte : une battle d’ecriture se rend sans fichier', async () => {
  const s2 = open(); await ready(s2);
  const { code: c2, hostToken: t2 } = await call(s2, 'host:create', {
    name: 'Battle d’ecriture', mediaType: 'text', config: { graceMs: 0 },
  });
  await call(s2, 'host:publish');
  const w = open(); await ready(w);
  const writer = await call(w, 'play:join', { code: c2, pseudo: 'Plume' });
  await call(s2, 'host:start');

  const res = await submitText(c2, writer, 'Il etait une fois cinq mots imposes.');
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.submission.kind, 'text');
  assert.equal(body.submission.textBody, 'Il etait une fois cinq mots imposes.');
  assert.equal(body.submission.url, null, 'pas de fichier, donc pas de lien');

  const vide = await submitText(c2, writer, '   ');
  assert.equal(vide.status, 400);
  return { c2, t2, writer };
});

test('retard : refuse quand la politique est « refuses »', async () => {
  const s3 = open(); await ready(s3);
  const { code: c3 } = await call(s3, 'host:create', {
    name: 'Serree', mediaType: 'audio',
    // Fenetre de grace nulle : le retard est constate des la cloture.
    config: { graceMs: 0, latePolicy: 'reject' },
  });
  await call(s3, 'host:publish');
  const r = open(); await ready(r);
  const late = await call(r, 'play:join', { code: c3, pseudo: 'Retardataire' });
  await call(s3, 'host:start');
  await call(s3, 'host:close-creation');
  await sleep(60);

  const res = await submitFile(c3, late, WAV, 'trop-tard.wav');
  const body = await res.json();
  assert.equal(res.status, 409, JSON.stringify(body));
  assert.match(body.error, /hors delai sont refuses/);
});

test('retard : accepte et marque quand la politique le prevoit', async () => {
  const s4 = open(); await ready(s4);
  const { code: c4 } = await call(s4, 'host:create', {
    name: 'Tolerante', mediaType: 'audio',
    config: { graceMs: 0, latePolicy: 'unranked' },
  });
  await call(s4, 'host:publish');
  const r = open(); await ready(r);
  const who = await call(r, 'play:join', { code: c4, pseudo: 'Tardif' });
  await call(s4, 'host:start');
  await call(s4, 'host:close-creation');
  await sleep(60);

  const res = await submitFile(c4, who, WAV, 'in-extremis.wav');
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.late, true, 'le retard est constate par l’horloge du serveur');
  assert.equal(body.submission.late, true);
});

/* ------------------------------------------------------------------ */

for (const [name, fn] of checks) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { console.error(`  FAIL ${name}\n       ${err.message}`); process.exitCode = 1; }
}

for (const s of sockets) s.close();
server.kill('SIGTERM');
await sleep(300);
server.kill('SIGKILL');
rmSync(DATA_DIR, { recursive: true, force: true });

console.log(`\n${passed}/${checks.length} verifications passees`);
if (process.exitCode) console.log(`\n--- journal serveur ---\n${log.join('')}`);
