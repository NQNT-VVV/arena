/**
 * Mise a disposition des elements imposes.
 *
 * Le parcours reel : l'animateur depose ses fichiers sur la plateforme, les
 * participants les consultent dans la page et recuperent le pack. On verifie
 * aussi les refus — plafonds, phase, jeton — et le point le plus important :
 * qu'un fichier hostile ne puisse pas s'executer sur notre origine.
 */

import { spawn } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

/**
 * Le serveur est demarre en mode production : c'est le mode dans lequel il
 * tourne reellement, et le seul qui ne recompile pas les pages au vol pendant
 * qu'on le mesure. Il lui faut donc un build.
 *
 * On cherche `BUILD_ID` et non le dossier `.next` : un `npm run dev` remplit ce
 * dossier d'artefacts de developpement, qui ressemblent a un build sans en
 * etre un. Ce fichier-la n'est ecrit que par `next build`.
 */
if (!existsSync(new URL('../.next/BUILD_ID', import.meta.url))) {
  console.error('\n  Ce test demarre le serveur en production : il lui faut un build.\n\n      npm run build\n');
  process.exit(1);
}

const PORT = 3800 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = `/tmp/arena-assets-${process.pid}`;
rmSync(DATA_DIR, { recursive: true, force: true });

const MAX_ASSETS = 8;
const MAX_ASSETS_BYTES = 20000;

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    METRICS_PORT: String(PORT + 500),
    DATA_DIR,
    SESSION_SECRET: 'assets-secret',
    MAX_ASSETS: String(MAX_ASSETS),
    MAX_ASSETS_BYTES: String(MAX_ASSETS_BYTES),
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

/* -------------------------- fichiers d'essai ------------------------- */

const bytes = (...parts) => Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'latin1'))));
const PNG = bytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'x'.repeat(200));
const WAV = bytes('RIFF', Buffer.alloc(4), 'WAVE', 'd'.repeat(300));
const TXT = bytes('Contrainte : cinq mots imposes.\n');
const HOSTILE = bytes('<html><script>alert(document.domain)</script></html>');

function form(entries) {
  const fd = new FormData();
  for (const [name, buf, type] of entries) fd.append('files', new Blob([buf], { type: type || '' }), name);
  return fd;
}

const upload = (code, token, entries) => fetch(`${BASE}/api/session/${code}/assets`, {
  method: 'POST',
  headers: token ? { 'X-Arena-Token': token } : {},
  body: form(entries),
});

/* ----------------------------- deroule ------------------------------- */

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

await waitForHealth();

const sockets = [];
const open = () => { const s = io(BASE, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
const ready = (s) => new Promise((r) => (s.connected ? r() : s.once('connect', r)));

const host = open();
await ready(host);
const created = await call(host, 'host:create', { name: 'Battle graphique', mediaType: 'image', brief: 'Tout doit venir de ces elements.' });
const { code, hostToken } = created;

let assets = [];

test('depot : l’animateur televerse trois elements', async () => {
  const res = await upload(code, hostToken, [
    ['01-kick.wav', WAV, 'audio/wav'],
    ['02-texture.png', PNG, 'image/png'],
    ['03-consigne.txt', TXT, 'text/plain'],
  ]);
  // Le corps ne se lit qu'une fois : le passer en message d'assertion le
  // consommerait avant l'appel a json().
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.added, 3);
  assets = body.assets;
  assert.deepEqual(assets.map((a) => a.filename), ['01-kick.wav', '02-texture.png', '03-consigne.txt']);
  assert.deepEqual(assets.map((a) => a.kind), ['audio', 'image', 'text']);
  assert.ok(assets.every((a) => a.inline), 'les trois sont consultables dans la page');
});

test('depot : les elements arrivent dans l’etat temps reel', async () => {
  const player = open();
  await ready(player);
  const joined = await call(player, 'play:join', { code, pseudo: 'Alice' });
  assert.equal(joined.ok, true, joined.error);
  assert.equal(joined.state.assets.length, 3);
  assert.equal(joined.state.assetsZipUrl, `/api/session/${code}/assets.zip`);
  const first = joined.state.assets[0];
  assert.ok(first.url.startsWith('/api/asset/'), 'chaque element porte son adresse');
  // Rien du disque ne doit transparaitre.
  assert.equal(first.storageKey, undefined);
  assert.ok(!JSON.stringify(joined.state.assets).includes('sessions/'), 'aucune clef de stockage exposee');
});

test('consultation : type correct, et interdiction de deviner', async () => {
  const png = assets.find((a) => a.kind === 'image');
  const res = await fetch(`${BASE}${png.url}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-disposition'), /^inline/);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal((await res.arrayBuffer()).byteLength, PNG.length);
});

test('consultation : requete partielle, pour deplacer le curseur', async () => {
  const wav = assets.find((a) => a.kind === 'audio');
  const res = await fetch(`${BASE}${wav.url}`, { headers: { Range: 'bytes=0-9' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 0-9/${WAV.length}`);
  assert.equal((await res.arrayBuffer()).byteLength, 10);

  const tooFar = await fetch(`${BASE}${wav.url}`, { headers: { Range: `bytes=${WAV.length + 10}-` } });
  assert.equal(tooFar.status, 416);
});

test('consultation : ?dl=1 force le telechargement', async () => {
  const png = assets.find((a) => a.kind === 'image');
  const res = await fetch(`${BASE}${png.url}?dl=1`);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.match(res.headers.get('content-disposition'), /^attachment/);
});

test('securite : un fichier hostile ne s’execute pas sur notre origine', async () => {
  const res = await upload(code, hostToken, [['innocent.png', HOSTILE, 'image/png']]);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  const piege = body.assets.find((a) => a.filename === 'innocent.png');
  assert.equal(piege.kind, 'other', 'reconnu pour ce qu’il est, pas pour son extension');
  assert.equal(piege.inline, false);

  const served = await fetch(`${BASE}${piege.url}`);
  assert.equal(served.headers.get('content-type'), 'application/octet-stream');
  assert.match(served.headers.get('content-disposition'), /^attachment/);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  // Le type declare par le client est ignore : seuls les octets comptent.
  assert.ok(!String(served.headers.get('content-type')).includes('html'));
  assets = body.assets;
});

test('pack : une archive valide, avec tous les elements', async () => {
  const res = await fetch(`${BASE}/api/session/${code}/assets.zip`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition'), /attachment.*Battle-graphique-elements\.zip/);

  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString('latin1'), 'PK\x03\x04', 'signature ZIP');
  // Chaque entree laisse une fiche dans le repertoire central.
  let entries = 0;
  for (let i = 0; i < buf.length - 4; i++) if (buf.readUInt32LE(i) === 0x02014b50) entries++;
  assert.equal(entries, 4, 'les quatre elements sont dans le pack');
  assert.ok(buf.includes(Buffer.from('01-kick.wav')), 'noms d’origine conserves dans le pack');
});

test('refus : sans le jeton de regie', async () => {
  const res = await upload(code, null, [['pirate.txt', TXT]]);
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /animateur/);

  const wrong = await upload(code, 'jeton-invente', [['pirate.txt', TXT]]);
  assert.equal(wrong.status, 403);
});

const countEntries = (buf) => {
  let n = 0;
  for (let i = 0; i < buf.length - 4; i++) if (buf.readUInt32LE(i) === 0x02014b50) n++;
  return n;
};

test('refus : un fichier trop lourd, sans rien laisser derriere', async () => {
  const zipBefore = Buffer.from(await (await fetch(`${BASE}/api/session/${code}/assets.zip`)).arrayBuffer());
  const before = countEntries(zipBefore);

  const lourd = Buffer.alloc(MAX_ASSETS_BYTES + 1000, 0x41);
  const res = await upload(code, hostToken, [['enorme.bin', lourd]]);
  assert.equal(res.status, 413, `attendu 413, recu ${res.status}`);

  // Le plafond est applique pendant le flux : le fragment deja ecrit sur le
  // disque doit avoir ete efface, et le pack rester intact.
  const zipAfter = Buffer.from(await (await fetch(`${BASE}/api/session/${code}/assets.zip`)).arrayBuffer());
  assert.equal(countEntries(zipAfter), before, 'aucun fragment laisse derriere');
});

test('retrait : possible avant le depart, plus apres', async () => {
  const victim = assets.find((a) => a.filename === 'innocent.png');
  const res = await fetch(`${BASE}/api/session/${code}/assets/${victim.id}`, {
    method: 'DELETE', headers: { 'X-Arena-Token': hostToken },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.assets.length, 3);
  // Le fichier n'est plus servi.
  assert.equal((await fetch(`${BASE}${victim.url}`)).status, 404);

  await call(host, 'host:publish');
  await call(host, 'host:start');
  const survivor = body.assets[0];
  const late = await fetch(`${BASE}/api/session/${code}/assets/${survivor.id}`, {
    method: 'DELETE', headers: { 'X-Arena-Token': hostToken },
  });
  assert.equal(late.status, 409, 'retirer une contrainte en pleine creation invaliderait le travail en cours');
  assert.match((await late.json()).error, /ne se retire plus/);
});

test('ajout en cours de creation : autorise, car oublier un sample arrive', async () => {
  const res = await upload(code, hostToken, [['04-oubli.wav', WAV, 'audio/wav']]);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.assets.length, 4);
});

test('ajout apres la creation : refuse', async () => {
  await call(host, 'host:close-creation');
  await call(host, 'host:start-diffusion');
  const res = await upload(code, hostToken, [['trop-tard.wav', WAV]]);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /ne se deposent plus/);
});

test('refus : au-dela du nombre autorise', async () => {
  // Session dediee : saturer celle du parcours principal fausserait tout ce
  // qui suit, et le plafond se teste aussi bien a part.
  const other = open();
  await ready(other);
  const { code: c2, hostToken: t2 } = await call(other, 'host:create', { name: 'Saturation' });
  const many = Array.from({ length: MAX_ASSETS }, (_, i) => [`a${i}.txt`, TXT]);
  assert.equal((await upload(c2, t2, many)).status, 200);
  const over = await upload(c2, t2, [['un-de-trop.txt', TXT]]);
  const body = await over.json();
  assert.equal(over.status, 413, JSON.stringify(body));
  assert.match(body.error, /Pas plus de/);
});

test('nouvelle edition : reglages et pack repris, le reste repart de zero', async () => {
  const h = open(); await ready(h);
  const src = await call(h, 'host:create', {
    name: 'Beat Battle #12', mediaType: 'audio', brief: 'Cinq samples imposes.',
    config: { durationMs: 45 * 60_000, scale: 10, voteWindowS: 20 },
  });
  await upload(src.code, src.hostToken, [['01-kick.wav', WAV, 'audio/wav'], ['02-snare.wav', WAV, 'audio/wav']]);
  await call(h, 'host:publish');
  const p = open(); await ready(p);
  await call(p, 'play:join', { code: src.code, pseudo: 'Ancien' });

  const dup = await call(h, 'host:duplicate', { copyAssets: true });
  assert.equal(dup.ok, true, dup.error);
  assert.notEqual(dup.code, src.code);
  assert.ok(dup.hostToken && dup.hostToken !== src.hostToken, 'un jeton neuf pour une session neuve');

  const st = dup.state;
  assert.equal(st.phase, 'config', 'prete a etre reglee');
  assert.equal(st.name, 'Beat Battle #13', 'le numero d’edition avance');
  assert.equal(st.brief, 'Cinq samples imposes.');
  assert.equal(st.mediaType, 'audio');
  assert.equal(st.config.durationMs, 45 * 60_000);
  assert.equal(st.config.scale, 10);
  assert.equal(st.config.voteWindowS, 20);
  assert.equal(st.roster.length, 0, 'aucun participant repris');
  assert.equal(st.counts.submitted, 0);
  assert.equal(st.assets.length, 2, 'le pack est copie');
  assert.deepEqual(st.assets.map((a) => a.filename), ['01-kick.wav', '02-snare.wav']);

  // Copie physique : l'element de la nouvelle session vit ailleurs.
  const srcAssets = (await (await fetch(`${BASE}/api/session/${src.code}`)).json());
  assert.ok(srcAssets.exists);
  const copied = await fetch(`${BASE}${st.assets[0].url}`);
  assert.equal(copied.status, 200);
  assert.equal((await copied.arrayBuffer()).byteLength, WAV.length);

  // La socket a bascule : elle pilote la nouvelle session.
  const pub = await call(h, 'host:publish');
  assert.equal(pub.ok, true, pub.error);
  assert.equal(pub.state.code, dup.code);

  // Sans le pack, depuis la nouvelle session cette fois.
  const bare = await call(h, 'host:duplicate', { copyAssets: false, name: 'Edition speciale' });
  assert.equal(bare.ok, true, bare.error);
  assert.equal(bare.state.name, 'Edition speciale');
  assert.equal(bare.state.assets.length, 0);
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
