/**
 * Machine a etats et chrono.
 *
 * Ce test ne passe pas par le reseau : il attaque `BattleServer` directement.
 * Ce qu'on verifie ici — une transition interdite reste interdite, une pause
 * ne perd pas de temps, une echeance se declenche seule — n'a pas besoin d'un
 * navigateur, et le verifier sans en ouvrir un permet de le rejouer en une
 * seconde a chaque modification.
 */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);

const DATA_DIR = process.env.TEST_DATA_DIR || '/tmp/arena-test-state';
rmSync(DATA_DIR, { recursive: true, force: true });
process.env.NODE_ENV = 'development';
process.env.DATA_DIR = DATA_DIR;
process.env.SESSION_SECRET = 'test-secret';

const { BattleServer, BattleError } = require('../server/battle.js');
const views = require('../server/views.js');
const repo = require('../server/repo.js');

/** Socket.IO reduit a ce que le serveur en attend : des salons et des emissions. */
const fakeIo = () => ({ sent: [], to(room) { const s = this; return { emit(ev, p) { s.sent.push({ room, ev, p }); } }; } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const checks = [];
function test(name, fn) { checks.push([name, fn]); }
function throws(fn, needle) {
  try { fn(); } catch (err) {
    assert.ok(err instanceof BattleError, `attendu BattleError, recu ${err.name}: ${err.message}`);
    if (needle) assert.ok(err.message.includes(needle), `message « ${err.message} » ne contient pas « ${needle} »`);
    return err;
  }
  assert.fail('aucune erreur levee');
}

/* ------------------------------------------------------------------ */

test('creation : code lisible, jeton rendu une seule fois', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'Beat Battle #12', mediaType: 'audio', brief: '5 samples imposes' });
  assert.match(session.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(session.phase, 'config');
  assert.equal(session.name, 'Beat Battle #12');
  assert.ok(hostToken.length > 20);
  // Le jeton en clair ne doit exister nulle part dans l'etat persiste.
  assert.notEqual(session.hostTokenHash, hostToken);
  assert.ok(!JSON.stringify(repo.sessionById(session.id)).includes(hostToken));
});

test('regie : un jeton faux ne pilote rien', () => {
  const srv = new BattleServer(fakeIo());
  const { session } = srv.createSession({ name: 'X' });
  throws(() => srv.requireHost(session.code, 'pas-le-bon'), "n'etes pas l'animateur");
  throws(() => srv.start(session.code, 'pas-le-bon'));
});

test('transitions : les raccourcis sont refuses', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'X' });
  throws(() => srv.start(session.code, hostToken), 'Impossible de passer');       // config -> creation
  throws(() => srv.startDiffusion(session.code, hostToken), 'Impossible de passer');
  srv.publishSession(session.code, hostToken);
  assert.equal(session.phase, 'lobby');
  throws(() => srv.showResults(session.code, hostToken), 'Impossible de passer'); // lobby -> results
  srv.start(session.code, hostToken);
  assert.equal(session.phase, 'creation');
  // Depuis n'importe ou, l'animateur peut couper court.
  srv.archive(session.code, hostToken);
  assert.equal(session.phase, 'archived');
  throws(() => srv.publishSession(session.code, hostToken));
});

test('lobby : on peut revenir sur les reglages, pas apres le depart', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'X' });
  srv.publishSession(session.code, hostToken);
  srv.configure(session.code, hostToken, { brief: 'Nouvelle consigne', config: { durationMs: 15 * 60 * 1000 } });
  assert.equal(session.brief, 'Nouvelle consigne');
  assert.equal(session.config.durationMs, 15 * 60 * 1000);
  srv.start(session.code, hostToken);
  throws(() => srv.configure(session.code, hostToken, { brief: 'trop tard' }), 'se figent');
});

test('reglages : tout est borne', () => {
  const srv = new BattleServer(fakeIo());
  const { session } = srv.createSession({
    name: 'X',
    config: {
      durationMs: 9e15, graceMs: -5, scale: 1, defaultVote: 999,
      playMaxS: 30, fadeOutS: 90, alerts: [60, 60, -1, 'x', 600], criteria: new Array(20).fill({ label: 'c' }),
      latePolicy: 'nimporte-quoi', allowedExt: ['MP3!', '../etc/passwd'],
    },
  });
  const c = session.config;
  assert.equal(c.durationMs, 12 * 60 * 60 * 1000, 'duree plafonnee a 12 h');
  assert.equal(c.graceMs, 0, 'grace jamais negative');
  assert.equal(c.scale, 2, 'bareme minimal');
  assert.equal(c.defaultVote, 2, 'note par defaut ramenee dans le bareme');
  assert.ok(c.fadeOutS <= c.playMaxS && c.fadeOutS <= 10, 'fondu plus court que l’extrait');
  assert.deepEqual(c.alerts, [600, 60], 'seuils dedupliques, tries, nettoyes');
  assert.equal(c.criteria.length, 6, 'criteres plafonnes');
  assert.equal(c.latePolicy, 'reject', 'politique inconnue ramenee au defaut');
  assert.deepEqual(c.allowedExt, ['mp3', 'etcpassw'], 'extensions reduites a 8 caracteres alphanumeriques');
});

test('participants : pseudo unique, reconnexion par jeton', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'X' });
  srv.publishSession(session.code, hostToken);

  const a = srv.join(session.code, { pseudo: 'Alex' });
  assert.equal(a.resumed, false);
  assert.equal(a.participant.pseudo, 'Alex');

  throws(() => srv.join(session.code, { pseudo: 'alex' }), 'deja pris');
  throws(() => srv.join(session.code, { pseudo: 'a' }), 'deux caracteres');

  const again = srv.join(session.code, { pseudo: 'peu importe', participantId: a.participant.id, token: a.token });
  assert.equal(again.resumed, true, 'un rafraichissement retrouve sa place');
  assert.equal(again.participant.id, a.participant.id);

  // Le jeton de quelqu'un d'autre ne donne pas l'identite d'Alex : la demande
  // retombe sur une inscription ordinaire, sous son propre pseudo.
  const b = srv.join(session.code, { pseudo: 'Bob' });
  const usurp = srv.join(session.code, { pseudo: 'Mallory', participantId: a.participant.id, token: b.token });
  assert.equal(usurp.resumed, false, 'jeton non concordant : pas de reprise d’identite');
  assert.notEqual(usurp.participant.id, a.participant.id);
  assert.equal(usurp.participant.pseudo, 'Mallory');

  // Et sans jeton du tout, le pseudo seul ne suffit pas a redevenir Alex.
  throws(() => srv.join(session.code, { pseudo: 'Alex' }), 'deja pris');
});

test('inscriptions : fermees des la diffusion, reconnexion toujours possible', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'X' });
  srv.publishSession(session.code, hostToken);
  const a = srv.join(session.code, { pseudo: 'Alex' });
  srv.start(session.code, hostToken);
  srv.join(session.code, { pseudo: 'Retardataire' });       // creation : encore ouvert
  srv.forceCloseCreation(session.code, hostToken);
  srv.join(session.code, { pseudo: 'TresEnRetard' });        // grace : encore ouvert
  srv.startDiffusion(session.code, hostToken);
  throws(() => srv.join(session.code, { pseudo: 'Spectateur' }), 'fermees');
  const back = srv.join(session.code, { pseudo: 'Alex', participantId: a.participant.id, token: a.token });
  assert.equal(back.resumed, true, 'un participant connu revient meme en diffusion');
});

test('chrono : pause, reprise et ajout de temps ne perdent pas de secondes', async () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'X', config: { durationMs: 10 * 60 * 1000 } });
  srv.publishSession(session.code, hostToken);
  srv.start(session.code, hostToken);

  const atStart = session.remaining();
  assert.ok(Math.abs(atStart - 10 * 60 * 1000) < 50, 'le chrono part sur la duree configuree');

  await sleep(120);
  srv.pause(session.code, hostToken);
  assert.equal(session.createEndAt, null, 'en pause, plus d’echeance absolue');
  assert.equal(srv.nextDeadline(session), null, 'en pause, aucune echeance armee');
  const frozen = session.remaining();

  await sleep(150);
  assert.equal(session.remaining(), frozen, 'le temps ne coule pas pendant la pause');

  srv.addTime(session.code, hostToken, 60 * 1000);
  assert.equal(session.remaining(), frozen + 60 * 1000, 'l’ajout de temps s’applique en pause');

  srv.resume(session.code, hostToken);
  assert.ok(Math.abs(session.remaining() - (frozen + 60 * 1000)) < 50, 'la reprise repart d’ou l’on s’etait arrete');
  assert.ok(session.createEndAt > Date.now(), 'echeance absolue retablie');
});

test('chrono : l’echeance fait passer seule en televersement', async () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'X', config: { graceMs: 60 * 1000 } });
  srv.publishSession(session.code, hostToken);
  srv.start(session.code, hostToken);

  // On rapproche l'echeance : la duree minimale configurable est d'une minute,
  // et attendre une minute par test rendrait la suite inutilisable.
  session.patch({ createEndAt: Date.now() + 120 });
  srv.arm(session);
  assert.equal(session.phase, 'creation');

  await sleep(350);
  assert.equal(session.phase, 'upload', 'la creation se ferme sans intervention');
  assert.ok(session.graceEndAt > Date.now(), 'la fenetre de grace s’ouvre derriere');
  assert.equal(session.pausedAt, null);
});

test('chrono : la fin de grace n’enchaine que si on l’a demande', async () => {
  const io = fakeIo();
  const srv = new BattleServer(io);
  const { session, hostToken } = srv.createSession({ name: 'X', config: { graceMs: 60 * 1000, autoAdvance: false } });
  srv.publishSession(session.code, hostToken);
  srv.start(session.code, hostToken);
  srv.forceCloseCreation(session.code, hostToken);
  session.patch({ graceEndAt: Date.now() + 100 });
  srv.arm(session);
  await sleep(300);
  assert.equal(session.phase, 'upload', 'sans enchainement automatique, la regie garde la main');

  const auto = new BattleServer(fakeIo());
  const r = auto.createSession({ name: 'Y', config: { graceMs: 60 * 1000, autoAdvance: true } });
  auto.publishSession(r.session.code, r.hostToken);
  auto.start(r.session.code, r.hostToken);
  auto.forceCloseCreation(r.session.code, r.hostToken);
  r.session.patch({ graceEndAt: Date.now() + 100 });
  auto.arm(r.session);
  await sleep(300);
  assert.equal(r.session.phase, 'diffusion', 'avec enchainement automatique, la diffusion part seule');
});

test('anonymat : aucun auteur avant la revelation', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'X' });
  srv.publishSession(session.code, hostToken);
  const a = srv.join(session.code, { pseudo: 'Alex' });
  srv.start(session.code, hostToken);
  srv.forceCloseCreation(session.code, hostToken);
  srv.startDiffusion(session.code, hostToken);

  assert.equal(views.authorsVisible(session), false);
  assert.equal(views.authorOf(session, a.participant.id), null, 'pas d’auteur en diffusion');
  // Meme la regie n'y a pas droit : elle partage souvent son ecran.
  assert.equal(views.hostView(session).phase, 'diffusion');

  srv.showResults(session.code, hostToken);
  assert.equal(views.authorsVisible(session), true);
  assert.equal(views.authorOf(session, a.participant.id).pseudo, 'Alex', 'auteur revele aux resultats');
});

test('redemarrage : les sessions et leurs echeances reviennent', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'Survivante', config: { durationMs: 30 * 60 * 1000 } });
  srv.publishSession(session.code, hostToken);
  srv.join(session.code, { pseudo: 'Alex' });
  srv.start(session.code, hostToken);
  const endAt = session.createEndAt;

  // Un nouveau serveur sur la meme base : c'est ce que fait un redemarrage de pod.
  const reborn = new BattleServer(fakeIo());
  const back = reborn.get(session.code);
  assert.ok(back, 'la session est retrouvee');
  assert.equal(back.phase, 'creation');
  assert.equal(back.createEndAt, endAt, 'le chrono reprend a la meme seconde');
  assert.equal(back.participants.size, 1, 'les participants sont retrouves');
  assert.ok(reborn.nextDeadline(back) !== null, 'l’echeance est rearmee');
});

test('redemarrage en diffusion : l’ecoute et l’avancement reprennent', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'X', config: { playMaxS: 45, voteWindowS: 15, autoNext: true } });
  srv.publishSession(session.code, hostToken);
  const a = srv.join(session.code, { pseudo: 'Alex' });
  const b = srv.join(session.code, { pseudo: 'Bea' });
  srv.start(session.code, hostToken);
  for (const p of [a, b]) {
    repo.addSubmission({
      id: `sub-${p.participant.id}`, sessionId: session.id, participantId: p.participant.id,
      renditionId: `r-${p.participant.id}`, originalKey: 'k', originalBytes: 1, originalMime: 'audio/wav',
      filename: 'x.wav', kind: 'audio', inline: true, uploadedAt: Date.now(), late: false, status: 'ready',
    });
  }
  srv.forceCloseCreation(session.code, hostToken);
  srv.startDiffusion(session.code, hostToken);
  assert.equal(session.order.length, 2);
  assert.ok(session.diffusionStartedAt, 'le premier rendu est ouvert');
  assert.equal(session.diffusionAdvanceAt, session.diffusionStartedAt + 60_000);

  const reborn = new BattleServer(fakeIo());
  const back = reborn.get(session.code);
  assert.equal(back.phase, 'diffusion');
  assert.equal(back.cursor, 0);
  assert.equal(back.diffusionStartedAt, session.diffusionStartedAt, 'meme instant d’ouverture : l’ecoute reprend a la bonne seconde');
  assert.equal(reborn.nextDeadline(back), session.diffusionAdvanceAt, 'l’avancement automatique est rearme');
});

test('diffusion : les trois surfaces recoivent des etats distincts', () => {
  const io = fakeIo();
  const srv = new BattleServer(io);
  const { session, hostToken } = srv.createSession({ name: 'X' });
  io.sent.length = 0;
  srv.publishSession(session.code, hostToken);
  const rooms = io.sent.filter((m) => m.ev === 'state').map((m) => m.room);
  assert.deepEqual(rooms, [`s:${session.code}`, `s:${session.code}:host`, `s:${session.code}:screen`]);
  const host = io.sent.find((m) => m.room.endsWith(':host')).p;
  const screen = io.sent.find((m) => m.room.endsWith(':screen')).p;
  assert.equal(host.isHost, true);
  assert.equal(screen.isScreen, true);
  assert.equal(screen.isHost, undefined, 'le grand ecran n’herite d’aucun privilege');
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
