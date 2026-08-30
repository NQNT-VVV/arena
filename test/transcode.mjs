/**
 * Transcodage des rendus, sur un vrai serveur et avec un vrai ffmpeg.
 *
 * Ce que ce test protege : un rendu diffuse ne porte plus aucune metadonnee,
 * l'extrait est coupe a la duree d'ecoute avec un fondu, la duree reelle est
 * connue du serveur — et quand le transcodage echoue, le rendu concourt quand
 * meme, servi tel quel.
 */

import { spawn, execFileSync } from 'node:child_process';
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

if (!existsSync(new URL('../.next/BUILD_ID', import.meta.url))) {
  console.error('\n  Ce test demarre le serveur en production : il lui faut un build.\n\n      npm run build\n');
  process.exit(1);
}

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
try {
  execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
  execFileSync(FFPROBE, ['-version'], { stdio: 'ignore' });
} catch {
  console.log('  ignore : ffmpeg introuvable sur cette machine\n\n0/0 verifications passees');
  process.exit(0);
}

const PORT = 4100 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = `/tmp/arena-tc-${process.pid}`;
const FIX = `${DATA_DIR}-fixtures`;
rmSync(DATA_DIR, { recursive: true, force: true });
rmSync(FIX, { recursive: true, force: true });
mkdirSync(FIX, { recursive: true });

/* ----------------------------- fixtures ------------------------------ */

// Un morceau de 12 s, avec des tags qui trahiraient l'auteur.
execFileSync(FFMPEG, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
  '-metadata', 'title=Beat de Alexis', '-metadata', 'artist=Alexis Deligne',
  '-c:a', 'libmp3lame', '-b:a', '128k', `${FIX}/long.mp3`,
]);
// Un morceau de 3 s : plus court que la duree d'ecoute.
execFileSync(FFMPEG, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3',
  '-c:a', 'pcm_s16le', `${FIX}/short.wav`,
]);
const LONG = readFileSync(`${FIX}/long.mp3`);
const SHORT = readFileSync(`${FIX}/short.wav`);
assert.ok(LONG.includes('Alexis'), 'la fixture porte bien le tag');

// Une image de 3000 px avec un EXIF nominatif.
const sharp = require('sharp');
const PHOTO = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#7c3aed' } })
  .jpeg({ quality: 80 })
  .withMetadata({ exif: { IFD0: { Copyright: 'Alexis Deligne', Artist: 'Alexis' } } })
  .toBuffer();
assert.ok(PHOTO.includes('Alexis'), 'la photo porte bien son EXIF');

// Un faux WAV : en-tete plausible, contenu vide de sens.
const FAKE = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(300, 7)]);

const probeDuration = (buf, ext) => {
  const file = `${FIX}/probe-${Date.now()}${ext}`;
  require('node:fs').writeFileSync(file, buf);
  const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
  return Number(out);
};

/* ------------------------------ serveur ------------------------------ */

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production', PORT: String(PORT), METRICS_PORT: String(PORT + 300),
    DATA_DIR, SESSION_SECRET: 'tc-secret', TRANSCODE_CONCURRENCY: '2',
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
const sockets = [];
const open = () => { const s = io(BASE, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
const ready = (s) => new Promise((r) => (s.connected ? r() : s.once('connect', r)));

async function submit(code, who, buf, name) {
  const fd = new FormData();
  fd.append('files', new Blob([buf]), name);
  const res = await fetch(`${BASE}/api/session/${code}/submission`, {
    method: 'POST',
    headers: { 'X-Arena-Token': who.token, 'X-Arena-Participant': who.participantId },
    body: fd,
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.submission;
}

/** Attend que le rendu d'un participant soit pret, et le rend. */
async function waitReady(sock, code, who, tries = 200) {
  for (let i = 0; i < tries; i++) {
    const { you } = await call(sock, 'play:join', { code, pseudo: who.pseudo, participantId: who.participantId, token: who.token });
    if (you.submission && you.submission.status === 'ready') return you.submission;
    await sleep(150);
  }
  throw new Error('rendu jamais pret');
}

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

await waitForHealth();

const host = open(); await ready(host);
const { code, hostToken } = await call(host, 'host:create', {
  name: 'Transcodee', mediaType: 'audio',
  config: { playMaxS: 5, fadeOutS: 2, voteWindowS: 10, autoNext: false },
});
await call(host, 'host:publish');

async function join(pseudo) {
  const sock = open(); await ready(sock);
  const j = await call(sock, 'play:join', { code, pseudo });
  return { sock, pseudo, participantId: j.participantId, token: j.token };
}
const alice = await join('Alice');
const bob = await join('Bob');
const cleo = await join('Cleo');
await call(host, 'host:start');

let aliceSub; let bobSub; let cleoSub;

test('depot : le rendu part en traitement, puis devient pret', async () => {
  const first = await submit(code, alice, LONG, 'beat-alexis-final.mp3');
  assert.ok(['pending', 'transcoding'].includes(first.status), `etat initial : ${first.status}`);
  aliceSub = await waitReady(alice.sock, code, alice);
  assert.equal(aliceSub.transcoded, true, 'un extrait nettoye existe');
  assert.ok(Math.abs(aliceSub.durationMs - 12000) < 300, `duree mesuree : ${aliceSub.durationMs}`);
  assert.equal(aliceSub.error, null);
});

test('depot : un fichier court et un fichier factice passent aussi', async () => {
  await submit(code, bob, SHORT, 'court.wav');
  await submit(code, cleo, FAKE, 'bidon.wav');
  bobSub = await waitReady(bob.sock, code, bob);
  cleoSub = await waitReady(cleo.sock, code, cleo);
  assert.equal(bobSub.transcoded, true);
  assert.ok(Math.abs(bobSub.durationMs - 3000) < 300, `court : ${bobSub.durationMs} ms`);
  // Le faux WAV : ffmpeg le rejette, le rendu reste dans la course, tel quel.
  assert.equal(cleoSub.transcoded, false, 'pas d’extrait pour un fichier illisible');
  assert.ok(cleoSub.error, 'le motif est conserve');
  assert.equal(cleoSub.status, 'ready', 'mais le rendu concourt');
});

test('diffusion : refusee tant qu’un rendu est en traitement, puis acceptee', async () => {
  await call(host, 'host:close-creation');
  // Ici tout est deja pret ; on verifie au moins le compteur et le depart.
  const st = (await call(host, 'host:attach', { code, hostToken })).state;
  assert.equal(st.pendingSubmissions, 0);
  const res = await call(host, 'host:start-diffusion');
  assert.equal(res.ok, true, res.error);
  assert.equal(res.state.diffusion.total, 3);
});

/** Positionne la diffusion sur le rendu d'un participant et rend sa carte. */
async function showRendition(renditionId) {
  for (let i = 0; i < 3; i++) {
    const st = (await call(host, 'host:diffusion-goto', { index: i })).state;
    if (st.diffusion.current.renditionId === renditionId) return st.diffusion;
  }
  throw new Error('rendu introuvable dans la file');
}

test('anonymat : l’extrait diffuse ne contient plus aucune metadonnee', async () => {
  const d = await showRendition(aliceSub.renditionId);
  assert.equal(d.current.transcoded, true);
  assert.match(d.current.url, /\/preview$/);
  assert.equal(d.current.mime, 'audio/mpeg', 'format unique en sortie, quel que soit l’entree');

  const res = await fetch(`${BASE}${d.current.url}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.match(res.headers.get('content-disposition'), /rendu\.mp3/, 'nom neutre');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(!buf.includes('Alexis'), 'le tag a disparu de l’extrait');
  assert.ok(!buf.includes('Beat de'), 'le titre aussi');
  assert.ok(buf.length > 1000);
});

test('anonymat : l’original reste introuvable pendant la diffusion', async () => {
  const res = await fetch(`${BASE}/api/media/${aliceSub.renditionId}`);
  assert.equal(res.status, 404);
  // Sauf pour son auteur, qui detient la signature.
  const mine = await fetch(`${BASE}${aliceSub.url}`);
  assert.equal(mine.status, 200);
  assert.ok(Buffer.from(await mine.arrayBuffer()).includes('Alexis'), 'l’auteur retrouve son fichier tel quel');
});

test('extrait : coupe a la duree d’ecoute, avec un fondu', async () => {
  const d = await showRendition(aliceSub.renditionId);
  const buf = Buffer.from(await (await fetch(`${BASE}${d.current.url}`)).arrayBuffer());
  const seconds = probeDuration(buf, '.mp3');
  assert.ok(seconds >= 4.8 && seconds <= 5.3, `extrait de ${seconds} s pour 5 s demandees`);
  // La fin d'ecoute suit la duree d'ecoute : 12 s de morceau, 5 s de fenetre.
  assert.equal(d.endsAt - d.startedAt, 5000);
});

test('duree reelle : un morceau court ne fait pas ecouter de silence', async () => {
  const d = await showRendition(bobSub.renditionId);
  assert.ok(Math.abs((d.endsAt - d.startedAt) - 3000) < 300, `fenetre de ${d.endsAt - d.startedAt} ms pour un morceau de 3 s`);
  const buf = Buffer.from(await (await fetch(`${BASE}${d.current.url}`)).arrayBuffer());
  const seconds = probeDuration(buf, '.mp3');
  assert.ok(seconds >= 2.8 && seconds <= 3.3, `extrait non tronque : ${seconds} s`);
});

test('forme d’onde : des cretes pretes a dessiner', async () => {
  const d = await showRendition(aliceSub.renditionId);
  assert.ok(d.current.peaksUrl, 'un lien vers les cretes');
  const res = await fetch(`${BASE}${d.current.peaksUrl}`);
  assert.equal(res.status, 200);
  const peaks = await res.json();
  assert.ok(Array.isArray(peaks) && peaks.length >= 700 && peaks.length <= 800, `${peaks.length} cretes`);
  assert.ok(peaks.every((v) => v >= 0 && v <= 1));
});

test('degrade : sans extrait, l’original est servi par la route d’extrait', async () => {
  const d = await showRendition(cleoSub.renditionId);
  assert.equal(d.current.transcoded, false);
  assert.equal(d.current.peaksUrl, null);
  assert.equal(d.endsAt - d.startedAt, 5000, 'sans duree connue, la fenetre est celle du reglage');
  const res = await fetch(`${BASE}${d.current.url}`);
  assert.equal(res.status, 200, 'la salle voit quand meme le rendu');
  assert.equal(res.headers.get('content-type'), 'audio/wav');
});

test('revelation : la version complete nettoyee remplace l’original au telechargement', async () => {
  await call(host, 'host:results');
  const res = await fetch(`${BASE}/api/media/${aliceSub.renditionId}?dl=1`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /beat-alexis-final\.mp3/, 'le nom revient');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(!buf.includes('Alexis Deligne'), 'mais pas les tags');
  const seconds = probeDuration(buf, '.mp3');
  assert.ok(seconds > 11.5, `version complete : ${seconds} s`);
});

test('image : redimensionnee, EXIF supprime, orientation conservee', async () => {
  const h2 = open(); await ready(h2);
  const { code: c2 } = await call(h2, 'host:create', { name: 'Visuelle', mediaType: 'image' });
  await call(h2, 'host:publish');
  const s2 = open(); await ready(s2);
  const j = await call(s2, 'play:join', { code: c2, pseudo: 'Pix' });
  const pix = { sock: s2, pseudo: 'Pix', participantId: j.participantId, token: j.token };
  await call(h2, 'host:start');
  await submit(c2, pix, PHOTO, 'affiche-alexis.jpg');
  const sub = await waitReady(s2, c2, pix);
  assert.equal(sub.transcoded, true);

  await call(h2, 'host:close-creation');
  const started = await call(h2, 'host:start-diffusion');
  assert.equal(started.ok, true, started.error);

  // Vu par le participant : la meme carte que tout le monde. L'identite est
  // passee a plat — jamais l'objet qui porte la socket.
  const view = (await call(s2, 'play:join', { code: c2, pseudo: 'Pix', participantId: pix.participantId, token: pix.token })).state;
  const card = view.diffusion.current;
  assert.equal(card.mime, 'image/webp', 'format unique en sortie');
  assert.ok(card.thumbUrl, 'une vignette existe');

  const res = await fetch(`${BASE}${card.url}`);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(!buf.includes('Alexis'), 'l’EXIF a disparu');
  const meta = await sharp(buf).metadata();
  assert.ok(meta.width <= 2048 && meta.height <= 2048, `${meta.width}x${meta.height}`);
  assert.equal(meta.exif, undefined);

  const thumb = await fetch(`${BASE}${card.thumbUrl}`);
  assert.equal(thumb.status, 200);
  const tmeta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
  assert.ok(tmeta.width <= 480, `vignette ${tmeta.width} px`);
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
rmSync(FIX, { recursive: true, force: true });

console.log(`\n${passed}/${checks.length} verifications passees`);
if (process.exitCode) console.log(`\n--- journal serveur ---\n${log.join('')}`);
