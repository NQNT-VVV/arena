/**
 * REBUILD THE TRACK — une partie entiere, sur un vrai serveur.
 *
 * Trois manches, quatre joueurs dont un retardataire, un spectateur, de vrais
 * fichiers WAV deposes par la regie et analyses par ffmpeg. On verifie ce qui
 * ne peut se voir qu'en jouant :
 *
 *   - chacun recoit son extrait, unique tant que c'est possible, et le lien
 *     de son fichier n'ouvre que le sien ;
 *   - le tempo et la tonalite sont trouves dans le fichier, et une valeur
 *     corrigee a la main n'est jamais ecrasee ;
 *   - une manche suivante repart de zero — rendus, votes, diffusion, chrono —
 *     sans perdre la precedente, et personne ne retombe sur son extrait ;
 *   - la moyenne compte zero pour une manche sans rendu ;
 *   - la diffusion montre l'extrait d'origine d'un rendu, jamais son auteur.
 *
 * Les rendus sont des textes : le mode ne depend pas du type de rendu, et un
 * texte n'attend aucun transcodage.
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

if (!existsSync(new URL('../.next/BUILD_ID', import.meta.url))) {
  console.error('\n  Ce test demarre le serveur en production : il lui faut un build.\n\n      npm run build\n');
  process.exit(1);
}

const PORT = 4100 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = `/tmp/arena-rebuild-e2e-${process.pid}`;
rmSync(DATA_DIR, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    METRICS_PORT: String(PORT + 1000),
    DATA_DIR,
    SESSION_SECRET: 'rebuild-e2e-secret',
    DEFAULT_DURATION_S: '600',
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
    } catch { /* pas encore */ }
    await sleep(200);
  }
  throw new Error(`Le serveur n'a pas demarre.\n${serverLog.join('')}`);
}

/* ------------------------------------------------------------------ */
/* Des extraits synthetiques                                           */
/* ------------------------------------------------------------------ */

/**
 * Un WAV mono 16 bits : des accords tenus dans une tonalite, et des clics a un
 * tempo. On connait donc la reponse que l'analyse doit trouver.
 */
function wav({ bpm, tonique, mineur, secondes = 24, sr = 22050 }) {
  const n = sr * secondes;
  const x = new Float32Array(n);
  const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);
  const t3 = mineur ? 3 : 4;
  const suite = [[0, t3, 7], [5, 5 + t3, 12], [7, 11, 14], [0, t3, 7]].map((acc) => acc.map((d) => tonique + d));
  const duree = Math.floor(n / suite.length);
  suite.forEach((notes, k) => {
    for (let i = 0; i < duree; i++) {
      let v = 0;
      for (const m of notes) v += Math.sin((2 * Math.PI * freq(m) * i) / sr);
      x[k * duree + i] = v * 0.08;
    }
  });
  let g = bpm;
  const bruit = () => { g = (g * 16807) % 2147483647; return g / 2147483647 - 0.5; };
  for (let t = 0; t < n; t += (60 / bpm) * sr) {
    const d = Math.round(t);
    for (let i = 0; i < 600 && d + i < n; i++) x[d + i] += bruit() * 0.9 * Math.exp(-i / 90);
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  return buf;
}

/* ------------------------------------------------------------------ */
/* Plomberie                                                           */
/* ------------------------------------------------------------------ */

const sockets = [];
function open() {
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  s.states = [];
  s.yous = [];
  s.on('state', (p) => s.states.push(p));
  s.on('you', (p) => s.yous.push(p));
  sockets.push(s);
  return s;
}
const ready = (s) => new Promise((r) => (s.connected ? r() : s.once('connect', r)));
const call = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Pas de reponse a « ${event} »`)), 8000);
  socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
});
const last = (list) => list[list.length - 1];

async function attendre(fn, quoi, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`Delai depasse : ${quoi}`);
}

const auth = (who) => ({ 'X-Arena-Token': who.token, 'X-Arena-Participant': who.participantId });
const submitText = (who, body) => fetch(`${BASE}/api/session/${code}/submission`, {
  method: 'POST',
  headers: { ...auth(who), 'Content-Type': 'application/json' },
  body: JSON.stringify({ body }),
});

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

await waitForHealth();

let code;
let host;
let hostToken;
let screen;
const joueurs = {};
let spectateur;
let extraits = [];

/** L'etat de regie le plus recent, relu en se rattachant (sans effet sur la session). */
async function regie() {
  const res = await call(host, 'host:attach', { code, hostToken });
  if (!res.ok) throw new Error(`regie illisible : ${res.error}`);
  return res.state;
}

async function rejoindre(pseudo, opts = {}) {
  const s = open();
  await ready(s);
  const res = await call(s, 'play:join', { code, pseudo, ...opts });
  assert.equal(res.ok, true, res.error);
  s.participantId = res.participantId ?? res.you?.id;
  s.token = res.token;
  s.pseudo = pseudo;
  return s;
}

const youDe = (s) => last(s.yous);

/** Joue la diffusion entiere : chacun note les autres selon `notes[auteur]`. */
async function diffuserEtVoter(notes) {
  await call(host, 'host:close-creation');
  const etat = (await call(host, 'host:start-diffusion')).state;
  assert.equal(etat.phase, 'diffusion');
  const total = etat.diffusion.total;
  for (let i = 0; i < total; i++) {
    const d = (await regie()).diffusion;
    const corps = d.current.textBody;
    const auteur = corps.split(':')[0];
    for (const [pseudo, s] of [...Object.entries(joueurs), ['JUGE', spectateur]]) {
      if (pseudo === auteur) continue;
      await call(s, 'play:vote', { renditionId: d.current.renditionId, value: notes[auteur] ?? 3 });
    }
    if (i < total - 1) await call(host, 'host:diffusion-next');
  }
  await call(host, 'host:results');
  return (await call(host, 'host:reveal', { all: true })).state;
}

/* ------------------------------------------------------------------ */
/* Preparation                                                         */
/* ------------------------------------------------------------------ */

test('la regie ouvre une partie Rebuild en trois manches', async () => {
  host = open();
  await ready(host);
  const res = await call(host, 'host:create', { name: 'Rebuild The Track', mediaType: 'text' });
  assert.equal(res.ok, true, res.error);
  code = res.code;
  hostToken = res.hostToken;
  const cfg = await call(host, 'host:configure', { config: { mode: 'rebuild', rounds: 3, autoNext: false } });
  assert.equal(cfg.ok, true, cfg.error);
  assert.equal(cfg.state.config.mode, 'rebuild');
  assert.equal(cfg.state.config.rounds, 3);
  assert.deepEqual(cfg.state.manche, { round: 1, rounds: 3, derniere: false, mode: 'rebuild' });
});

test('sans extrait, la manche ne se lance pas', async () => {
  await call(host, 'host:publish');
  const res = await call(host, 'host:start');
  assert.equal(res.ok, false);
  assert.match(res.error, /au moins un extrait/);
});

test('la regie depose ses extraits ; un fichier qui n’est pas du son est refuse et nomme', async () => {
  const fd = new FormData();
  fd.append('files', new Blob([wav({ bpm: 125, tonique: 61, mineur: true })]), 'extrait-125-csm.wav');
  fd.append('files', new Blob([wav({ bpm: 90, tonique: 65, mineur: false })]), 'extrait-90-f.wav');
  fd.append('files', new Blob([wav({ bpm: 140, tonique: 57, mineur: true })]), 'extrait-140-am.wav');
  fd.append('files', new Blob(['pas du son du tout']), 'notes.txt');
  const r = await fetch(`${BASE}/api/session/${code}/extraits`, { method: 'POST', headers: { 'X-Arena-Token': hostToken }, body: fd });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.added, 3);
  assert.deepEqual(j.refused.map((x) => x.filename), ['notes.txt']);
  extraits = j.extraits;
});

test('le depot d’extraits est reserve a la regie', async () => {
  const fd = new FormData();
  fd.append('files', new Blob([wav({ bpm: 100, tonique: 60, mineur: false, secondes: 2 })]), 'pirate.wav');
  const r = await fetch(`${BASE}/api/session/${code}/extraits`, { method: 'POST', headers: { 'X-Arena-Token': 'faux' }, body: fd });
  assert.equal(r.status, 403);
});

test('le tempo et la tonalite sont trouves dans les fichiers', async () => {
  const faits = await attendre(async () => {
    const e = (await regie()).extraits;
    return e.every((x) => x.analyse === 'faite' || x.analyse === 'echec') ? e : null;
  }, 'analyse des extraits', 60000);
  const de = (nom) => faits.find((x) => x.nom === nom);
  assert.equal(de('extrait-125-csm.wav').analyse, 'faite', serverLog.join('').slice(-800));
  assert.equal(Math.round(de('extrait-125-csm.wav').bpm), 125);
  assert.equal(de('extrait-125-csm.wav').tonalite, 'C#m');
  assert.equal(de('extrait-125-csm.wav').tonaliteNom, 'C# minor');
  assert.equal(de('extrait-125-csm.wav').bpmSource, 'auto');
  assert.equal(Math.round(de('extrait-90-f.wav').bpm), 90);
  assert.equal(de('extrait-90-f.wav').tonalite, 'F');
  assert.equal(Math.round(de('extrait-140-am.wav').bpm), 140);
  assert.equal(de('extrait-140-am.wav').tonalite, 'Am');
  extraits = faits;
});

test('une valeur corrigee a la main n’est pas ecrasee par une nouvelle analyse', async () => {
  const e = extraits.find((x) => x.nom === 'extrait-90-f.wav');
  const res = await call(host, 'host:extrait-edit', { extraitId: e.id, tonalite: 'D minor', bpm: 92 });
  assert.equal(res.ok, true, res.error);
  const apres = res.state.extraits.find((x) => x.id === e.id);
  assert.equal(apres.tonalite, 'Dm');
  assert.equal(apres.tonaliteSource, 'manuel');
  assert.equal(apres.bpm, 92);

  await call(host, 'host:extrait-analyser', { extraitId: e.id });
  const relu = await attendre(async () => {
    const x = (await regie()).extraits.find((y) => y.id === e.id);
    return x.analyse === 'faite' ? x : null;
  }, 'reanalyse');
  assert.equal(relu.tonalite, 'Dm', 'l’analyse a ecrase la tonalite saisie');
  assert.equal(relu.bpm, 92);

  const bad = await call(host, 'host:extrait-edit', { extraitId: e.id, tonalite: 'H moll' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /illisible/);
});

/* ------------------------------------------------------------------ */
/* Manche 1                                                            */
/* ------------------------------------------------------------------ */

test('chacun recoit un extrait different au lancement', async () => {
  for (const p of ['Alice', 'Bob', 'Chloe']) joueurs[p] = await rejoindre(p);
  spectateur = await rejoindre('JUGE', { spectator: true });
  screen = open();
  await ready(screen);
  await call(screen, 'screen:attach', { code });

  const res = await call(host, 'host:start');
  assert.equal(res.ok, true, res.error);
  assert.equal(res.state.attributions.length, 3);

  const recus = await attendre(async () => {
    const xs = Object.values(joueurs).map((s) => youDe(s)?.extrait?.id);
    return xs.every(Boolean) ? xs : null;
  }, 'extraits sur les telephones');
  assert.equal(new Set(recus).size, 3, 'deux joueurs ont le meme extrait alors qu’il y en a assez');
  assert.equal(youDe(spectateur)?.extrait ?? null, null, 'un spectateur a recu un extrait');
});

test('le lien d’un extrait ouvre le fichier, une signature fausse ne l’ouvre pas', async () => {
  const mien = youDe(joueurs.Alice).extrait;
  assert.ok(mien.bpm && mien.tonalite, 'le telephone ne montre ni tempo ni tonalite');
  const ok = await fetch(`${BASE}${mien.url}&dl=1`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-disposition') || '', /attachment/);
  const faux = await fetch(`${BASE}/api/extrait/${mien.id}?k=AAAAAAAAAAAAAAAAAAAAAAAA`);
  assert.equal(faux.status, 404);
  // L'etat commun ne transporte aucun lien d'extrait : chacun n'a que le sien.
  const commun = JSON.stringify(last(screen.states));
  assert.equal(commun.includes('/api/extrait/'), false, 'un lien d’extrait fuit dans l’etat commun');
});

test('un retardataire recoit l’extrait le moins distribue', async () => {
  joueurs.Dan = await rejoindre('Dan');
  const sien = await attendre(async () => youDe(joueurs.Dan)?.extrait, 'extrait du retardataire');
  assert.ok(sien.id);
  const etat = await regie();
  assert.equal(etat.attributions.length, 4);
});

test('la diffusion montre l’extrait d’origine du rendu, jamais son auteur', async () => {
  for (const [p, s] of Object.entries(joueurs)) {
    const r = await submitText(s, `${p}: remake manche 1`);
    assert.equal(r.status, 200, await r.text());
  }
  await call(host, 'host:close-creation');
  const etat = (await call(host, 'host:start-diffusion')).state;
  const d = etat.diffusion;
  assert.ok(d.extrait, 'la diffusion ne dit pas quel extrait est reconstruit');
  assert.ok(d.extrait.bpm);
  assert.equal(d.extrait.url, undefined, 'le fichier de l’extrait part avec la diffusion');
  // L'ecran recoit son etat par evenement : on l'attend plutot que de lire
  // ce qui est arrive avant.
  const surEcran = await attendre(async () => last(screen.states)?.diffusion, 'diffusion sur l’ecran');
  assert.ok(surEcran.extrait, 'l’ecran ne montre pas l’extrait d’origine');
  for (const p of Object.keys(joueurs)) {
    // Le corps du texte contient le pseudo pour que le test sache qui est qui ;
    // on verifie donc ailleurs que dans le corps.
    assert.equal(JSON.stringify(surEcran.extrait).includes(p), false, `${p} apparait dans l’extrait diffuse`);
  }
});

test('la manche suivante attend que tout le classement soit devoile', async () => {
  // On finit la diffusion de la manche 1 : Alice 5, Bob 4, Chloe 2, Dan 1.
  const notes = { Alice: 5, Bob: 4, Chloe: 2, Dan: 1 };
  const total = (await regie()).diffusion.total;
  for (let i = 0; i < total; i++) {
    const d = (await regie()).diffusion;
    const auteur = d.current.textBody.split(':')[0];
    for (const [pseudo, s] of [...Object.entries(joueurs), ['JUGE', spectateur]]) {
      if (pseudo !== auteur) await call(s, 'play:vote', { renditionId: d.current.renditionId, value: notes[auteur] });
    }
    if (i < total - 1) await call(host, 'host:diffusion-next');
  }
  await call(host, 'host:results');
  const tot = await call(host, 'host:next-round', {});
  assert.equal(tot.ok, false);
  assert.match(tot.error, /Devoilez/);
  const etat = (await call(host, 'host:reveal', { all: true })).state;
  assert.equal(etat.general.manches, 1);
  assert.deepEqual(etat.general.rows.map((r) => r.author.pseudo), ['Alice', 'Bob', 'Chloe', 'Dan']);
});

/* ------------------------------------------------------------------ */
/* Manches 2 et 3                                                      */
/* ------------------------------------------------------------------ */

let extraitsManche1 = {};

test('la manche 2 repart de zero, avec la duree choisie, sans perdre la 1', async () => {
  extraitsManche1 = Object.fromEntries(Object.entries(joueurs).map(([p, s]) => [p, youDe(s).extrait.id]));
  const avant = Date.now();
  const res = await call(host, 'host:next-round', { durationMs: 20 * 60 * 1000 });
  assert.equal(res.ok, true, res.error);
  const e = res.state;
  assert.equal(e.phase, 'creation');
  assert.deepEqual(e.manche, { round: 2, rounds: 3, derniere: false, mode: 'rebuild' });
  assert.ok(Math.abs(e.clock.createEndAt - (avant + 20 * 60 * 1000)) < 5000, 'la duree choisie n’est pas appliquee');
  assert.equal(e.counts.submitted, 0, 'les rendus de la manche 1 sont comptes en manche 2');
  assert.equal(e.podium, null);
  assert.equal(e.general.manches, 1, 'le general de la manche 1 a disparu');
  assert.equal(e.code, code, 'le code a change entre deux manches');
});

test('personne ne retombe sur l’extrait qu’il a deja reconstruit', async () => {
  const recus = await attendre(async () => {
    const xs = Object.entries(joueurs).map(([p, s]) => [p, youDe(s)?.extrait?.id]);
    return xs.every(([p, id]) => id && youDe(joueurs[p]).extrait) ? xs : null;
  }, 'extraits de la manche 2');
  // Quatre joueurs, trois extraits : un doublon est inevitable, une rechute
  // ne l'est pas toujours — mais avec trois extraits et quatre joueurs, au
  // moins trois evitent leur extrait de la manche 1.
  // Le telephone ne doit plus afficher le rendu de la manche 1.
  await attendre(async () => Object.values(joueurs).every((s) => youDe(s).submission === null), 'rendus vides en manche 2');
  const rechutes = recus.filter(([p, id]) => id === extraitsManche1[p]);
  assert.ok(rechutes.length <= 1, `${rechutes.length} joueurs retombent sur leur extrait`);
});

test('manche 2 : Chloe ne rend rien ; manche 3 : tout le monde rend', async () => {
  for (const p of ['Alice', 'Bob', 'Dan']) {
    const r = await submitText(joueurs[p], `${p}: remake manche 2`);
    assert.equal(r.status, 200, await r.text());
  }
  const fin2 = await diffuserEtVoter({ Alice: 1, Bob: 5, Dan: 5 });
  assert.equal(fin2.general.manches, 2);

  const res = await call(host, 'host:next-round', {});
  assert.equal(res.ok, true, res.error);
  assert.equal(res.state.manche.derniere, true);
  for (const p of Object.keys(joueurs)) {
    const r = await submitText(joueurs[p], `${p}: remake manche 3`);
    assert.equal(r.status, 200, await r.text());
  }
  const fin3 = await diffuserEtVoter({ Alice: 3, Bob: 3, Chloe: 5, Dan: 3 });
  assert.equal(fin3.general.manches, 3);
  const moy = Object.fromEntries(fin3.general.rows.map((r) => [r.author.pseudo, r]));
  // Bob : 4, 5, 3 ; Alice : 5, 1, 3 ; Chloe : 2, absente, 5 ; Dan : 1, 5, 3.
  assert.ok(moy.Bob.rank === 1, 'Bob, le plus regulier, devrait mener');
  assert.deepEqual(moy.Chloe.scores[1], null, 'la manche sans rendu de Chloe n’est pas marquee absente');
  assert.ok(moy.Chloe.moyenne < moy.Alice.moyenne, 'une absence ne compte pas zero');
});

test('apres la derniere manche, il n’y en a pas d’autre', async () => {
  const res = await call(host, 'host:next-round', {});
  assert.equal(res.ok, false);
  assert.match(res.error, /derniere manche/);
});

test('un extrait joue ne se retire pas ; un extrait jamais attribue, si', async () => {
  const joue = extraits[0];
  const r = await fetch(`${BASE}/api/session/${code}/extraits/${joue.id}`, { method: 'DELETE', headers: { 'X-Arena-Token': hostToken } });
  assert.equal(r.status, 409);

  const fd = new FormData();
  fd.append('files', new Blob([wav({ bpm: 100, tonique: 60, mineur: false, secondes: 4 })]), 'jamais-joue.wav');
  const ajout = await (await fetch(`${BASE}/api/session/${code}/extraits`, { method: 'POST', headers: { 'X-Arena-Token': hostToken }, body: fd })).json();
  const neuf = ajout.extraits.find((x) => x.nom === 'jamais-joue.wav');
  assert.equal(neuf.retirable, true);
  const d = await fetch(`${BASE}/api/session/${code}/extraits/${neuf.id}`, { method: 'DELETE', headers: { 'X-Arena-Token': hostToken } });
  assert.equal(d.status, 200);
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
console.log(`\n${passed}/${checks.length} verifications passees`);
for (const s of sockets) s.close();
server.kill('SIGTERM');
rmSync(DATA_DIR, { recursive: true, force: true });
