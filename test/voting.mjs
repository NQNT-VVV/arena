/**
 * Diffusion et jugement.
 *
 * Le troisieme volet du parcours : les rendus defilent en aveugle, chacun note
 * depuis son telephone, le classement se devoile du dernier au premier.
 *
 * Ce qui est verifie ici avant tout : aucun rendu ne porte son auteur pendant
 * la diffusion, y compris pour l'animateur ; on ne note pas sa propre
 * creation ; on ne note pas ce qui n'est pas encore passe ; et le classement
 * cache n'est pas simplement masque a l'ecran mais absent de la charge utile.
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

const PORT = 4020 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = `/tmp/arena-vote-${process.pid}`;
rmSync(DATA_DIR, { recursive: true, force: true });

const server = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production', PORT: String(PORT), METRICS_PORT: String(PORT + 300),
    DATA_DIR, SESSION_SECRET: 'vote-secret',
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

const wav = (fill) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(200, fill)]);

/** Attend que le transcodage (ici rate, fichiers factices) ait rendu la main. */
async function waitProcessed(h, c, t, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const st = (await call(h, 'host:attach', { code: c, hostToken: t })).state;
    if (st.pendingSubmissions === 0) return st;
    await sleep(150);
  }
  throw new Error('des rendus restent en traitement');
}

const sockets = [];
const open = () => { const s = io(BASE, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
const ready = (s) => new Promise((r) => (s.connected ? r() : s.once('connect', r)));

async function submit(code, who, fill, name) {
  const fd = new FormData();
  fd.append('files', new Blob([wav(fill)]), name);
  const res = await fetch(`${BASE}/api/session/${code}/submission`, {
    method: 'POST',
    headers: { 'X-Arena-Token': who.ident.token, 'X-Arena-Participant': who.ident.participantId },
    body: fd,
  });
  // Le corps ne se lit qu'une fois : le passer en message d'assertion le
  // consommerait avant l'appel a json().
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body;
}

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

await waitForHealth();

const host = open(); await ready(host);
const { code, hostToken } = await call(host, 'host:create', {
  // Avancement manuel : ce parcours pilote le curseur a la main, et un
  // passage automatique en plein test fausserait ce qu'on mesure.
  name: 'Battle notee', mediaType: 'audio', config: { scale: 5, defaultVote: 3, autoNext: false },
});
await call(host, 'host:publish');

const people = {};
for (const [name, fill] of [['Alice', 1], ['Bob', 2], ['Cleo', 3]]) {
  const sock = open(); await ready(sock);
  const joined = await call(sock, 'play:join', { code, pseudo: name });
  // L'identite est isolee de la socket : la propager telle quelle dans une
  // charge utile ferait serialiser l'objet Socket.IO entier par socket.io.
  people[name] = {
    sock,
    pseudo: name,
    ident: { participantId: joined.participantId, token: joined.token },
  };
}
await call(host, 'host:start');
for (const [name, fill] of [['Alice', 1], ['Bob', 2], ['Cleo', 3]]) {
  const done = await submit(code, people[name], fill, `${name.toLowerCase()}-son.wav`);
  people[name].rendition = done.submission.renditionId;
}
await call(host, 'host:close-creation');
await waitProcessed(host, code, hostToken);

let diffusion;

test('diffusion : ordre tire, meme file pour tout le monde', async () => {
  const res = await call(host, 'host:start-diffusion');
  assert.equal(res.ok, true, res.error);
  diffusion = res.state.diffusion;
  assert.equal(diffusion.total, 3);
  assert.equal(diffusion.index, 0);
  assert.ok(diffusion.current, 'un rendu a l’ecran');

  // Les trois surfaces voient exactement la meme chose.
  const chezAlice = (await call(people.Alice.sock, 'play:join', { code, pseudo: 'Alice', ...people.Alice.ident })).state;
  assert.equal(chezAlice.diffusion.current.renditionId, diffusion.current.renditionId);
  assert.equal(chezAlice.diffusion.total, 3);
});

test('anonymat : le rendu diffuse ne porte ni auteur ni nom de fichier', async () => {
  const card = diffusion.current;
  assert.equal(card.participantId, undefined);
  assert.equal(card.filename, undefined);
  assert.equal(card.id, undefined);
  const serialised = JSON.stringify(diffusion);
  for (const name of ['Alice', 'Bob', 'Cleo']) {
    assert.ok(!serialised.includes(name), `« ${name} » ne doit pas apparaitre`);
    assert.ok(!serialised.includes(`${name.toLowerCase()}-son.wav`), 'aucun nom de fichier');
  }
});

test('anonymat : la regie n’en sait pas plus que la salle', async () => {
  const state = (await call(host, 'host:attach', { code, hostToken })).state;
  assert.equal(state.isHost, true);
  assert.equal(JSON.stringify(state.diffusion), JSON.stringify(diffusion));
  assert.equal(state.podium, null, 'aucun classement avant les resultats');
});

test('le rendu diffuse est lisible par tous, sans signature', async () => {
  assert.match(diffusion.current.url, /\/preview$/, 'la carte pointe vers l’extrait, jamais l’original');
  const res = await fetch(`${BASE}${diffusion.current.url}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  assert.match(res.headers.get('content-disposition'), /rendu\.wav/);
});

test('vote : accepte, et le compteur de la regie bouge', async () => {
  const target = diffusion.current.renditionId;
  const author = Object.values(people).find((p) => p.rendition === target);
  const voter = Object.values(people).find((p) => p.rendition !== target);

  const res = await call(voter.sock, 'play:vote', { renditionId: target, value: 4 });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.value, 4);
  assert.equal(res.you.votes[target]._, 4);

  const state = (await call(host, 'host:attach', { code, hostToken })).state;
  assert.equal(state.diffusion.voted, 1);
  assert.equal(state.diffusion.eligible, 2, 'tout le monde sauf l’auteur');
  assert.ok(author);
});

test('vote : on ne note pas sa propre creation', async () => {
  const target = diffusion.current.renditionId;
  const author = Object.values(people).find((p) => p.rendition === target);
  const res = await call(author.sock, 'play:vote', { renditionId: target, value: 5 });
  assert.equal(res.ok, false);
  assert.match(res.error, /sa propre creation/);
});

test('vote : on ne note pas ce qui n’est pas encore passe', async () => {
  const order = [];
  for (let i = 0; i < 3; i++) {
    const st = (await call(host, 'host:diffusion-goto', { index: i })).state;
    order.push(st.diffusion.current.renditionId);
  }
  await call(host, 'host:diffusion-goto', { index: 0 });

  const future = order[2];
  const voter = Object.values(people).find((p) => p.rendition !== future);
  const res = await call(voter.sock, 'play:vote', { renditionId: future, value: 5 });
  assert.equal(res.ok, false);
  assert.match(res.error, /pas encore passe/);
  return order;
});

test('vote : rattraper un passage deja vu reste possible', async () => {
  await call(host, 'host:diffusion-next');
  const st = (await call(host, 'host:attach', { code, hostToken })).state;
  assert.equal(st.diffusion.index, 1);

  // Le rendu numero 0 est derriere nous : on peut encore le noter.
  await call(host, 'host:diffusion-goto', { index: 0 });
  const first = (await call(host, 'host:attach', { code, hostToken })).state.diffusion.current.renditionId;
  await call(host, 'host:diffusion-goto', { index: 1 });

  const voter = Object.values(people).find((p) => p.rendition !== first);
  const res = await call(voter.sock, 'play:vote', { renditionId: first, value: 2 });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.you.votes[first]._, 2, 'la note precedente est ecrasee, pas doublee');
});

test('vote : hors bareme, la note est ramenee dans les bornes', async () => {
  const st = (await call(host, 'host:attach', { code, hostToken })).state;
  const target = st.diffusion.current.renditionId;
  const voter = Object.values(people).find((p) => p.rendition !== target);
  const haut = await call(voter.sock, 'play:vote', { renditionId: target, value: 99 });
  assert.equal(haut.value, 5);
  const bas = await call(voter.sock, 'play:vote', { renditionId: target, value: -10 });
  assert.equal(bas.value, 0);
  const absurde = await call(voter.sock, 'play:vote', { renditionId: target, value: 'beaucoup' });
  assert.equal(absurde.ok, false);
});

test('vote : un spectateur sans session ne vote pas', async () => {
  const intrus = open(); await ready(intrus);
  const st = (await call(host, 'host:attach', { code, hostToken })).state;
  const res = await call(intrus, 'play:vote', { renditionId: st.diffusion.current.renditionId, value: 5 });
  assert.equal(res.ok, false);
  assert.match(res.error, /Rejoignez la session/);
});

test('resultats : rien n’est devoile a l’arrivee', async () => {
  // On fait voter tout le monde sur tout, pour un classement franc.
  for (let i = 0; i < 3; i++) {
    await call(host, 'host:diffusion-goto', { index: i });
    const st = (await call(host, 'host:attach', { code, hostToken })).state;
    const target = st.diffusion.current.renditionId;
    const notes = { [people.Alice.rendition]: 5, [people.Bob.rendition]: 4, [people.Cleo.rendition]: 2 };
    for (const p of Object.values(people)) {
      if (p.rendition === target) continue;
      await call(p.sock, 'play:vote', { renditionId: target, value: notes[target] });
    }
  }

  const res = await call(host, 'host:results');
  assert.equal(res.ok, true, res.error);
  const podium = res.state.podium;
  assert.equal(podium.total, 3);
  assert.equal(podium.revealed, 0);
  assert.equal(podium.complete, false);
  assert.ok(podium.rows.every((r) => r.hidden), 'tout est cache');
  // Cache veut dire absent, pas masque : le classement ne doit pas transiter.
  const serialised = JSON.stringify(podium);
  for (const name of ['Alice', 'Bob', 'Cleo']) {
    assert.ok(!serialised.includes(name), `« ${name} » ne doit pas encore circuler`);
  }
});

test('resultats : revelation du dernier vers le premier', async () => {
  let state = (await call(host, 'host:reveal')).state;
  assert.equal(state.podium.revealed, 1);
  const shown = state.podium.rows.filter((r) => !r.hidden);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].position, 3, 'le dernier d’abord');
  assert.equal(shown[0].author.pseudo, 'Cleo', 'la moins bien notee');

  state = (await call(host, 'host:reveal')).state;
  assert.equal(state.podium.revealed, 2);
  assert.equal(state.podium.rows.filter((r) => !r.hidden).length, 2);

  state = (await call(host, 'host:reveal', { all: true })).state;
  assert.equal(state.podium.complete, true);
  const full = state.podium.rows;
  assert.equal(full[0].author.pseudo, 'Alice');
  assert.equal(full[0].score, 5);
  assert.equal(full[1].author.pseudo, 'Bob');
  assert.equal(full[1].score, 4);
  assert.equal(full[2].author.pseudo, 'Cleo');
  assert.equal(full[2].score, 2);
  assert.equal(full[0].voters, 2, 'note par les deux autres');
});

test('resultats : les participants voient le meme classement', async () => {
  const chezBob = (await call(people.Bob.sock, 'play:join', { code, pseudo: 'Bob', ...people.Bob.ident })).state;
  assert.equal(chezBob.podium.complete, true);
  assert.equal(chezBob.podium.rows[0].author.pseudo, 'Alice');
  // Le nom d'origine revient : la session est finie.
  assert.equal(chezBob.podium.rows[0].filename, 'alice-son.wav');
});

test('export : reserve a l’animateur', async () => {
  const nu = await fetch(`${BASE}/api/session/${code}/results.json`);
  assert.equal(nu.status, 403);

  const res = await fetch(`${BASE}/api/session/${code}/results.json`, { headers: { 'X-Arena-Token': hostToken } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.session.code, code);
  assert.equal(body.results.length, 3);
  assert.equal(body.results[0].author.pseudo, 'Alice');
  assert.ok(body.events.length > 0, 'le journal accompagne l’archive');
});

test('export : CSV lisible par un tableur', async () => {
  const res = await fetch(`${BASE}/api/session/${code}/results.csv`, { headers: { 'X-Arena-Token': hostToken } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  // On lit les octets et non `res.text()` : la specification de fetch decode en
  // UTF-8 et retire la marque d'ordre en tete. Le BOM serait invisible ici
  // alors qu'il est bien envoye — et c'est lui qui evite a Excel de lire les
  // accents de travers.
  const raw = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'prefixe BOM, pour les accents dans Excel');
  const lines = raw.toString('utf8').replace('\ufeff', '').trim().split('\n');
  assert.equal(lines.length, 4, 'un en-tete et trois lignes');
  assert.match(lines[0], /^rang;pseudo;note/);
  assert.match(lines[1], /^1;Alice;5/);
});

test('export : refuse tant que le classement n’est pas etabli', async () => {
  const s2 = open(); await ready(s2);
  const { code: c2, hostToken: t2 } = await call(s2, 'host:create', { name: 'En cours' });
  const res = await fetch(`${BASE}/api/session/${c2}/results.json`, { headers: { 'X-Arena-Token': t2 } });
  assert.equal(res.status, 409);
});

/* ---------------------- ecoute synchronisee ----------------------- */

/** Session prete a diffuser, avec `n` rendus, et les reglages voulus. */
async function readyToDiffuse(config, n = 3) {
  const h = open(); await ready(h);
  const created = await call(h, 'host:create', { name: 'Auto', mediaType: 'audio', config });
  await call(h, 'host:publish');
  const crew = [];
  for (let i = 0; i < n; i++) {
    const sock = open(); await ready(sock);
    const joined = await call(sock, 'play:join', { code: created.code, pseudo: `P${i}` });
    crew.push({ sock, ident: { participantId: joined.participantId, token: joined.token } });
  }
  await call(h, 'host:start');
  for (let i = 0; i < n; i++) await submit(created.code, crew[i], 10 + i, `p${i}.wav`);
  await call(h, 'host:close-creation');
  await waitProcessed(h, created.code, created.hostToken);
  return { h, code: created.code, hostToken: created.hostToken, crew };
}

const stateOf = (h, c, t) => call(h, 'host:attach', { code: c, hostToken: t }).then((r) => r.state);

test('ecoute : ouverte a un instant serveur, le meme pour tous', async () => {
  const { h, code: c, hostToken: t, crew } = await readyToDiffuse({ playMaxS: 45, voteWindowS: 15, autoNext: true });
  const before = Date.now();
  const st = (await call(h, 'host:start-diffusion')).state;
  const d = st.diffusion;
  assert.ok(d.startedAt >= before - 50 && d.startedAt <= Date.now() + 50, 'ouverture a l’instant du passage');
  assert.equal(d.endsAt - d.startedAt, 45_000, 'fin d’ecoute = ouverture + duree maximale');
  assert.equal(d.advanceAt - d.endsAt, 15_000, 'passage au suivant = fin d’ecoute + fenetre de vote');
  assert.equal(d.autoNext, true);

  const chezP0 = (await call(crew[0].sock, 'play:join', { code: c, pseudo: 'P0', ...crew[0].ident })).state;
  assert.equal(chezP0.diffusion.startedAt, d.startedAt, 'le participant recoit le meme instant');
  assert.equal(chezP0.diffusion.endsAt, d.endsAt);
});

test('auto : le serveur passe seul au rendu suivant', async () => {
  // Duree d'ecoute minimale et fenetre nulle : le passage a lieu a ~5 s.
  const { h, code: c, hostToken: t } = await readyToDiffuse({ playMaxS: 5, voteWindowS: 0, autoNext: true });
  const st = (await call(h, 'host:start-diffusion')).state;
  assert.equal(st.diffusion.index, 0);
  assert.equal(st.diffusion.advanceAt, st.diffusion.endsAt, 'fenetre nulle : on avance a la fin de l’ecoute');

  await sleep(5600);
  const after = await stateOf(h, c, t);
  assert.equal(after.diffusion.index, 1, 'le curseur a avance sans intervention');
  assert.ok(after.diffusion.startedAt > st.diffusion.startedAt, 'le rendu suivant a sa propre ouverture');
});

test('auto : quand tout le monde a note, on n’attend pas la fenetre de vote', async () => {
  const { h, code: c, hostToken: t, crew } = await readyToDiffuse({ playMaxS: 5, voteWindowS: 60, autoNext: true });
  const st = (await call(h, 'host:start-diffusion')).state;
  const target = st.diffusion.current.renditionId;
  assert.equal(st.diffusion.advanceAt - st.diffusion.endsAt, 60_000);

  // Les deux votants eligibles notent tout de suite.
  let last;
  for (const p of crew) {
    const res = await call(p.sock, 'play:vote', { renditionId: target, value: 4 });
    if (res.ok) last = res;
  }
  assert.ok(last, 'au moins un vote accepte');

  const now = await stateOf(h, c, t);
  assert.equal(now.diffusion.voted, 2);
  assert.equal(now.diffusion.eligible, 2);
  // L'ecoute n'est jamais coupee : le passage est ramene a la fin de l'ecoute,
  // pas a l'instant du dernier vote.
  assert.equal(now.diffusion.advanceAt, now.diffusion.endsAt, 'passage cale sur la fin de l’ecoute');

  await sleep(5600);
  assert.equal((await stateOf(h, c, t)).diffusion.index, 1, 'et il a bien eu lieu');
});

test('relancer : le rendu repart de zero, a la meme position', async () => {
  const { h, code: c, hostToken: t } = await readyToDiffuse({ playMaxS: 45, voteWindowS: 15, autoNext: false });
  const st = (await call(h, 'host:start-diffusion')).state;
  await sleep(120);
  const again = (await call(h, 'host:diffusion-replay')).state;
  assert.equal(again.diffusion.index, st.diffusion.index);
  assert.equal(again.diffusion.current.renditionId, st.diffusion.current.renditionId);
  assert.ok(again.diffusion.startedAt > st.diffusion.startedAt, 'nouvelle ouverture');
  assert.equal(again.diffusion.advanceAt, null, 'en manuel, aucun passage programme');
});

test('bascule : couper l’automatique retire l’echeance, le remettre la recalcule', async () => {
  const { h, code: c, hostToken: t } = await readyToDiffuse({ playMaxS: 45, voteWindowS: 15, autoNext: true });
  const st = (await call(h, 'host:start-diffusion')).state;
  assert.ok(st.diffusion.advanceAt);

  const off = (await call(h, 'host:auto-next', { on: false })).state;
  assert.equal(off.diffusion.autoNext, false);
  assert.equal(off.diffusion.advanceAt, null);
  assert.equal(off.diffusion.startedAt, st.diffusion.startedAt, 'le rendu en cours n’est pas relance');

  const on = (await call(h, 'host:auto-next', { on: true })).state;
  assert.equal(on.diffusion.autoNext, true);
  assert.equal(on.diffusion.advanceAt, st.diffusion.endsAt + 15_000, 'echeance recalculee depuis l’ouverture');
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
