/**
 * LA ROULETTE, sur un vrai serveur.
 *
 * `test/roulette.mjs` attaque le tirage directement : il dit ce que le hasard
 * fait. Cette suite-ci passe par le reseau, avec de vraies sockets, et verifie
 * ce que l'autre ne peut pas voir — ce que les trois surfaces RECOIVENT.
 *
 * C'est la que se logent les fautes qui ne cassent aucun test unitaire :
 *
 *   - un champ renomme d'un cote et pas de l'autre. Une page qui lit `applied`
 *     la ou le serveur envoie `pointsApplied` n'echoue pas, elle affiche
 *     tranquillement « a respecter » sur un malus deja compte.
 *   - une regle recopiee dans l'interface au lieu d'etre envoyee. Elle ne
 *     ment pas le jour ou on l'ecrit, elle mentira le jour ou le serveur
 *     changera.
 *   - un secret qui sort par la mauvaise vue. La graine et les regles sont
 *     pour la regie ; l'ecran finit en partage d'ecran.
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

/**
 * Le serveur est demarre en mode production, comme `test/e2e.mjs` : c'est le
 * mode dans lequel il tourne reellement. Il lui faut donc un build, et c'est
 * `BUILD_ID` qui le prouve — un `npm run dev` remplit `.next` d'artefacts qui
 * ressemblent a un build sans en etre un.
 */
if (!existsSync(new URL('../.next/BUILD_ID', import.meta.url))) {
  console.error('\n  Ce test demarre le serveur en production : il lui faut un build.\n\n      npm run build\n');
  process.exit(1);
}

const PORT = 3800 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = `/tmp/arena-roulette-e2e-${process.pid}`;
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
    SESSION_SECRET: 'roulette-e2e-secret',
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
    } catch { /* pas encore la */ }
    await sleep(200);
  }
  throw new Error(`Le serveur n'a pas demarre.\n${serverLog.join('')}`);
}

/* ------------------------------------------------------------------ */
/* Outils client                                                       */
/* ------------------------------------------------------------------ */

const sockets = [];

/**
 * Une socket qui garde ce qu'elle recoit.
 *
 * Les etats sont pousses, pas demandes : sans les accumuler, un test devrait
 * poser une attente juste avant chaque action, et une diffusion arrivee une
 * milliseconde trop tot le ferait echouer sans rien apprendre a personne.
 */
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

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

/* ------------------------------------------------------------------ */

await waitForHealth();

let code;
let host;
let screen;
const players = {};
let spectator;
/** La roue des malus, remplie par le premier test et relue par les suivants. */
let wheelId;
let slots = [];

/* ------------------------------- les roues ------------------------ */

test('la regie ouvre une session et n’a encore aucune roue', async () => {
  host = open();
  await ready(host);
  const res = await call(host, 'host:create', { name: 'Beat Battle Roulette', mediaType: 'text' });
  assert.equal(res.ok, true, res.error);
  code = res.code;
  assert.deepEqual(res.state.wheels, [], 'aucune roue au depart');
  assert.equal(res.state.lastSeed, null);
  assert.equal(res.state.roulette.spins, 0);
  assert.equal(res.state.roulette.last, null);
});

test('une roue se cree, et la liste n’en porte que le compte', async () => {
  const res = await call(host, 'host:wheel-create', { name: 'Malus legers' });
  assert.equal(res.ok, true, res.error);
  wheelId = res.result.id;
  const listed = res.state.wheels.find((w) => w.id === wheelId);
  assert.equal(listed.name, 'Malus legers');
  assert.equal(listed.slots, 0, 'le compte, pas les cases');
  assert.equal(listed.cases, undefined, 'la liste ne transporte aucune case');
});

test('les cases arrivent a la demande, et gardent leur ordre', async () => {
  for (const c of [
    { label: 'Sans kick', detail: 'aucune grosse caisse', weight: 2, points: -2 },
    { label: 'Mono seulement', weight: 1, points: -1 },
    { label: 'Gardee pour plus tard', weight: 0, points: -5 },
  ]) {
    const added = await call(host, 'host:slot-add', { wheelId, ...c });
    assert.equal(added.ok, true, added.error);
  }
  const res = await call(host, 'host:wheel-slots', { wheelId });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.wheelId, wheelId);
  slots = res.slots;
  assert.equal(slots.length, 3);
  assert.deepEqual(slots.map((s) => s.position), [0, 1, 2]);
  assert.equal(slots[0].points, -2);
  assert.equal(slots[0].detail, 'aucune grosse caisse');
  // Une case a zero garde son texte : on prepare une roue en plusieurs fois.
  assert.equal(slots[2].weight, 0);
  assert.equal(slots[2].label, 'Gardee pour plus tard');
});

test('deplacer, modifier, retirer : les positions se resserrent', async () => {
  assert.equal((await call(host, 'host:slot-move', { slotId: slots[2].id, vers: 0 })).ok, true);
  slots = (await call(host, 'host:wheel-slots', { wheelId })).slots;
  assert.equal(slots[0].label, 'Gardee pour plus tard');

  const edited = await call(host, 'host:slot-edit', { slotId: slots[0].id, label: 'Reveillee', weight: 1 });
  assert.equal(edited.ok, true, edited.error);
  slots = (await call(host, 'host:wheel-slots', { wheelId })).slots;
  assert.equal(slots[0].label, 'Reveillee');
  assert.equal(slots[0].weight, 1);
  assert.equal(slots[0].points, -5, 'un champ non transmis ne s’efface pas');

  assert.equal((await call(host, 'host:slot-remove', { slotId: slots[0].id })).ok, true);
  slots = (await call(host, 'host:wheel-slots', { wheelId })).slots;
  assert.equal(slots.length, 2);
  assert.deepEqual(slots.map((s) => s.position), [0, 1], 'pas de trou dans la numerotation');
});

test('une demande sans identifiant rend une liste vide, pas une erreur', async () => {
  const res = await call(host, 'host:wheel-slots', {});
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.slots, []);
  assert.equal(res.wheelId, null);
});

/* ------------------------------- la salle ------------------------- */

test('la salle se remplit : trois createurs et un juge', async () => {
  assert.equal((await call(host, 'host:publish')).ok, true);
  for (const pseudo of ['ALPHA', 'BRAVO', 'CHARLIE']) {
    const s = open();
    await ready(s);
    const res = await call(s, 'play:join', { code, pseudo });
    assert.equal(res.ok, true, res.error);
    players[pseudo] = s;
  }
  spectator = open();
  await ready(spectator);
  assert.equal((await call(spectator, 'play:join', { code, pseudo: 'JUGE', spectator: true })).ok, true);

  screen = open();
  await ready(screen);
  assert.equal((await call(screen, 'screen:attach', { code })).ok, true);

  assert.equal((await call(host, 'host:start')).ok, true);
  await sleep(200);
});

/* ------------------------------- le tirage ------------------------ */

test('un tirage part aux trois surfaces, avec le meme contenu', async () => {
  const res = await call(host, 'host:spin', { wheelId, target: 'all', shared: true });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.fates.length, 3, 'les spectateurs restent dehors par defaut');
  assert.equal(res.spins, 1);
  assert.equal(res.epuise, false);
  await sleep(300);

  for (const [name, socket] of [['regie', host], ['ecran', screen], ['participant', players.ALPHA]]) {
    const state = last(socket.states);
    assert.equal(state.roulette.spins, 1, `${name} : le compte des tirages`);
    assert.ok(state.roulette.last, `${name} : le dernier tirage`);
    assert.equal(state.roulette.last.fates.length, 3, `${name} : trois sorts`);
    assert.equal(state.roulette.last.wheelName, 'Malus legers', `${name} : la roue nommee`);
  }

  const fates = last(screen.states).roulette.last.fates;
  assert.deepEqual(fates.map((f) => f.position), [0, 1, 2], 'l’ordre du devoilement');
  for (const f of fates) {
    for (const key of ['participantId', 'pseudo', 'label', 'detail', 'points', 'chronoMs', 'pointsApplied', 'chronoApplied', 'position']) {
      assert.ok(key in f, `champ ${key} absent d’un sort`);
    }
    assert.equal(typeof f.pointsApplied, 'boolean');
    assert.equal(typeof f.chronoApplied, 'boolean');
    assert.equal(f.applied, undefined, 'l’ancien drapeau unique n’existe plus');
  }
});

test('chacun lit son propre sort sur son canal, et personne d’autre', async () => {
  const mine = last(players.ALPHA.yous);
  assert.ok(mine.fate, 'le participant a son sort');
  for (const key of ['spinId', 'wheelName', 'label', 'detail', 'points', 'chronoMs', 'pointsApplied', 'chronoApplied', 'at']) {
    assert.ok(key in mine.fate, `champ ${key} absent de you.fate`);
  }
  assert.equal(mine.fate.applied, undefined);
  // Meme sort pour toute la salle : c'est bien celui du tirage.
  assert.equal(mine.fate.label, last(screen.states).roulette.last.fates[0].label);
  // Le juge n'etait pas dans la roue : il n'a pas de sort, pas un sort vide.
  assert.equal(last(spectator.yous).fate, null);
});

test('les points comptent en creation, et le classement les reprend', async () => {
  const state = last(host.states);
  const applied = state.roulette.last.fates.filter((f) => f.pointsApplied);
  assert.equal(applied.length, 3, 'un malus de points en creation s’applique');
  assert.ok(applied.every((f) => f.points !== 0));
});

test('un effet par etat : le chrono joue sans que les points existent', async () => {
  // Une roue qui ne touche qu'au temps : c'est le cas ou un drapeau unique
  // mentait — l'horloge avait bel et bien avance, et la page affichait
  // « a respecter ».
  const w = await call(host, 'host:wheel-create', { name: 'Le temps' });
  await call(host, 'host:slot-add', { wheelId: w.result.id, label: 'Une minute de plus', chronoMs: 60000 });

  const before = last(host.states).clock.createEndAt;
  const res = await call(host, 'host:spin', { wheelId: w.result.id, target: 'all', shared: true });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.chronoApplicable, true);
  assert.equal(res.chronoMs, 60000);
  await sleep(300);

  const fate = last(screen.states).roulette.last.fates[0];
  assert.equal(fate.chronoApplied, true, 'le chrono a joue');
  assert.equal(fate.pointsApplied, false, 'et il n’y avait aucun point a compter');
  assert.equal(last(host.states).clock.createEndAt, before + 60000, 'l’horloge a vraiment avance');

  const mine = last(players.BRAVO.yous);
  assert.equal(mine.fate.chronoApplied, true);
  assert.equal(mine.fate.pointsApplied, false);
});

test('le chrono ne bouge pas pour une seule personne, et le dit', async () => {
  const w = last(host.states).wheels.find((x) => x.name === 'Le temps');
  const before = last(host.states).clock.createEndAt;
  const res = await call(host, 'host:spin', { wheelId: w.id, target: 'one' });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.chronoApplicable, false, 'l’horloge d’Arena est partagee');
  assert.equal(res.chronoMs, 0);
  await sleep(300);

  const fate = last(screen.states).roulette.last.fates[0];
  assert.equal(fate.chronoApplied, false, 'le sort reste une consigne');
  assert.equal(fate.chronoMs, 60000, 'mais son texte et son effet restent lisibles');
  assert.equal(last(host.states).clock.createEndAt, before, 'rien n’a bouge');
});

test('un sort chacun : la roue trop courte recommence un tour, et le dit', async () => {
  const res = await call(host, 'host:spin', { wheelId, target: 'all', shared: false, includeSpectators: true });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.fates.length, 4, 'le juge entre dans la roue quand on le demande');
  assert.equal(res.epuise, true, 'deux cases jouables pour quatre personnes');
  await sleep(300);
  assert.ok(last(spectator.yous).fate, 'le juge a maintenant un sort');
});

test('une roue dont tout est muet se refuse en le disant', async () => {
  const w = await call(host, 'host:wheel-create', { name: 'Toute muette' });
  await call(host, 'host:slot-add', { wheelId: w.result.id, label: 'Rien', weight: 0 });
  const res = await call(host, 'host:spin', { wheelId: w.result.id, target: 'one' });
  assert.equal(res.ok, false);
  assert.match(res.error, /aucune case jouable/);
});

/* -------------------- ce qui reste en regie ----------------------- */

test('les regles du tirage sont envoyees a la regie, et a elle seule', async () => {
  const rules = last(host.states).rouletteRules;
  assert.ok(rules, 'la regie recoit les regles au lieu de les redeclarer');
  assert.ok(rules.pointsPhases.includes('diffusion'), 'les points corrigent jusqu’a la diffusion');
  assert.ok(!rules.pointsPhases.includes('results'), 'plus apres le devoilement');
  assert.deepEqual(rules.chronoPhases, ['creation', 'upload']);
  assert.ok(rules.blindPhases.includes('creation'));
  assert.ok(!rules.blindPhases.includes('diffusion'), 'a la diffusion la salle a deja entendu');
  assert.equal(typeof rules.pointsMax, 'number');
  assert.equal(typeof rules.chronoMaxMs, 'number');

  // L'ecran finit en partage d'ecran, le telephone est dans une poche : ni
  // l'un ni l'autre n'a de regle a appliquer, donc ni l'un ni l'autre ne la
  // recoit.
  assert.equal(last(screen.states).rouletteRules, undefined);
  assert.equal(last(players.ALPHA.states).rouletteRules, undefined);
  assert.equal(last(screen.states).wheels, undefined, 'les roues non plus');
});

test('la graine reste une conversation entre la regie et la salle', async () => {
  const seed = last(host.states).lastSeed;
  assert.ok(typeof seed === 'string' && seed.length > 0, 'la regie peut rejouer un tirage conteste');
  assert.equal(last(screen.states).lastSeed, undefined, 'pas sur le grand ecran');
  assert.equal(last(players.ALPHA.states).lastSeed, undefined, 'pas sur les telephones');
  assert.equal(last(screen.states).roulette.last.seed, undefined, 'ni dans le tirage diffuse');
});

test('le compte des tirages est public, et il monte', async () => {
  const before = last(screen.states).roulette.spins;
  assert.equal((await call(host, 'host:spin', { wheelId, target: 'one' })).ok, true);
  await sleep(300);
  assert.equal(last(screen.states).roulette.spins, before + 1, 'l’ecran voit le relancement');
});

test('une action sur une roue ne rediffuse rien : l’accuse fait foi', async () => {
  /*
   * Les roues ne vivent que dans la vue de la regie : une soiree n'a pas a
   * recevoir un etat complet parce qu'on a corrige un libelle. Le serveur rend
   * donc l'etat frais dans l'accuse, et le panneau doit le lire — sinon une
   * roue creee n'apparait qu'au prochain evenement de session, et le compte de
   * cases affiche reste celui d'avant.
   */
  const pushed = host.states.length;
  const created = await call(host, 'host:wheel-create', { name: 'Ephemere' });
  assert.equal(created.ok, true, created.error);
  await sleep(300);
  assert.equal(host.states.length, pushed, 'aucune diffusion pour une roue');
  assert.ok(created.state.wheels.some((w) => w.name === 'Ephemere'), 'mais l’accuse porte la roue neuve');

  const added = await call(host, 'host:slot-add', { wheelId: created.result.id, label: 'Une case' });
  assert.equal(added.state.wheels.find((w) => w.id === created.result.id).slots, 1, 'et le compte de cases a jour');
});

test('renommer ou supprimer la roue ne reecrit pas un tirage passe', async () => {
  const before = last(screen.states).roulette.last;
  const renamed = await call(host, 'host:wheel-rename', { wheelId, name: 'Malus lourds', note: 'les soirs sans pitie' });
  assert.equal(renamed.ok, true, renamed.error);
  assert.equal(renamed.state.wheels.find((w) => w.id === wheelId).note, 'les soirs sans pitie');

  const removed = await call(host, 'host:wheel-remove', { wheelId });
  assert.equal(removed.ok, true, removed.error);
  assert.equal(removed.state.wheels.some((w) => w.id === wheelId), false, 'la roue est partie');

  await sleep(300);
  const after = last(screen.states).roulette.last;
  assert.equal(after.id, before.id);
  assert.equal(after.wheelName, 'Malus legers', 'le nom d’origine, recopie au tirage');
  assert.deepEqual(after.fates.map((f) => f.label), before.fates.map((f) => f.label));
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
