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

/** Une session au classement, avec `n` rendus diffuses, plus un createur ecarte avant la diffusion. */
function auClassement(n = 3) {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'Devoilement', mediaType: 'text', config: { rounds: 2 } });
  srv.publishSession(session.code, hostToken);
  const gens = [];
  for (let i = 0; i <= n; i++) gens.push(srv.join(session.code, { pseudo: `CREA${i + 1}` }));
  srv.start(session.code, hostToken);
  for (const g of gens) {
    const prep = srv.openSubmissionSlot(session.code, g.participant.id, g.token);
    srv.saveSubmission(session, g.participant, { textBody: g.participant.pseudo, kind: 'text', inline: 1, late: 0 }, prep.existing);
  }
  const ecarte = gens[n];
  srv.setDisqualified(session.code, hostToken, ecarte.participant.id, true);
  srv.forceCloseCreation(session.code, hostToken);
  srv.startDiffusion(session.code, hostToken);
  return { srv, session, hostToken, gens: gens.slice(0, n), ecarte };
}

test('devoilement : ecarter apres la diffusion ne laisse pas « manche suivante » offerte puis refusee', () => {
  const { srv, session, hostToken, gens } = auClassement(3);
  srv.showResults(session.code, hostToken);
  srv.setDisqualified(session.code, hostToken, gens[0].participant.id, true);
  // Cran par cran : c'est la que les deux comptes divergeaient.
  srv.reveal(session.code, hostToken);
  srv.reveal(session.code, hostToken);
  const vue = views.hostView(session);
  assert.equal(vue.podium.total, 2, 'deux classes restent');
  assert.equal(vue.podium.complete, true);
  assert.equal(views.mancheDevoilee(session), true, 'meme reponse que le podium');
  srv.nextRound(session.code, hostToken);
  assert.equal(session.phase, 'creation');
});

test('devoilement : un reintegre dont le rendu n’est jamais passe ne bloque pas la premiere place', () => {
  const { srv, session, hostToken, ecarte } = auClassement(3);
  srv.setDisqualified(session.code, hostToken, ecarte.participant.id, false);
  srv.showResults(session.code, hostToken);
  srv.reveal(session.code, hostToken, { all: true });
  const podium = views.hostView(session).podium;
  assert.equal(podium.total, 3, 'son rendu n’a pas ete diffuse : il n’est pas classe');
  assert.equal(podium.complete, true);
  assert.ok(podium.rows.every((r) => !r.hidden), 'aucune place indevoilable');
});

test('devoilement : ecarter ou reintegrer en cours de route ne devoile ni ne recache personne', () => {
  const { srv, session, hostToken } = auClassement(4);
  srv.showResults(session.code, hostToken);
  srv.reveal(session.code, hostToken);
  srv.reveal(session.code, hostToken);
  const lignes = () => views.hostView(session).podium.rows;
  const montres = () => lignes().filter((r) => !r.hidden).map((r) => r.author.id);
  const avant = montres();
  assert.equal(avant.length, 2);
  // Le dernier, deja montre, est ecarte : il disparait, rien d'autre n'apparait.
  const dernier = avant[avant.length - 1];
  srv.setDisqualified(session.code, hostToken, dernier, true);
  assert.deepEqual(montres(), avant.filter((id) => id !== dernier));
  assert.equal(lignes().filter((r) => r.hidden).length, 2, 'les deux premieres places restent cachees');
  // Reintegre : il revient ou il etait, sans recacher son voisin.
  srv.setDisqualified(session.code, hostToken, dernier, false);
  assert.deepEqual(montres(), avant);
  assert.equal(lignes().filter((r) => r.hidden).length, 2);
});

test('delai ecoule : avec les retards refuses, on ne retire plus ce qu’on ne pourrait pas redeposer', () => {
  for (const [latePolicy, retirable] of [['reject', false], ['unranked', true]]) {
    const srv = new BattleServer(fakeIo());
    const { session, hostToken } = srv.createSession({ name: 'Delai', mediaType: 'text', config: { latePolicy, graceMs: 0 } });
    srv.publishSession(session.code, hostToken);
    const g = srv.join(session.code, { pseudo: 'CREA' });
    srv.start(session.code, hostToken);
    const prep = srv.openSubmissionSlot(session.code, g.participant.id, g.token);
    srv.saveSubmission(session, g.participant, { textBody: 'A l’heure', kind: 'text', inline: 1, late: 0 }, prep.existing);
    srv.forceCloseCreation(session.code, hostToken);
    session.graceEndAt = Date.now() - 1000;
    if (retirable) {
      assert.equal(srv.openSubmissionSlot(session.code, g.participant.id, g.token).late, true, 'accepte, mais en retard');
      srv.withdrawSubmission(session.code, g.participant.id, g.token);
      assert.equal(repo.submissionOf(session.id, g.participant.id), null);
    } else {
      throws(() => srv.openSubmissionSlot(session.code, g.participant.id, g.token), 'hors délai');
      throws(() => srv.withdrawSubmission(session.code, g.participant.id, g.token), 'ne se retire plus');
      assert.ok(repo.submissionOf(session.id, g.participant.id), 'le rendu a l’heure est toujours la');
    }
  }
});

test('redemarrage : une session terminee reste accessible a son animateur', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'Finie', mediaType: 'text' });
  srv.publishSession(session.code, hostToken);
  srv.archive(session.code, hostToken);
  const avant = srv.ouvertes();

  // Nouvelle instance, meme base : c'est ce que fait un redemarrage.
  const encore = new BattleServer(fakeIo());
  const reprise = encore.requireHost(session.code, hostToken);
  assert.equal(reprise.phase, 'archived');
  assert.ok(views.hostView(reprise).podium, 'le classement se relit');
  assert.equal(encore.ouvertes(), avant, 'une session terminee ne compte pas dans la limite');
  assert.ok(encore.sessions.size > encore.ouvertes());
});

test('purge : une partie abandonnee en cours de route finit par partir, pas une partie occupee', async () => {
  const srv = new BattleServer(fakeIo());
  const vieux = Date.now() - 1000 * 3600 * 1000;
  const lancer = (name) => {
    const { session, hostToken } = srv.createSession({ name, mediaType: 'text' });
    srv.publishSession(session.code, hostToken);
    srv.join(session.code, { pseudo: 'CREA' });
    srv.start(session.code, hostToken);
    return { session, hostToken };
  };
  const abandonnee = lancer('Abandonnee');
  const enDepot = lancer('En depot');
  const occupee = lancer('Occupee');
  const enCreation = lancer('Creation longue');
  const lobby = srv.createSession({ name: 'Lobby vide' });

  // Diffusion sans rendu ni echeance, laissee la.
  srv.forceCloseCreation(abandonnee.session.code, abandonnee.hostToken);
  srv.startDiffusion(abandonnee.session.code, abandonnee.hostToken);
  // Depot dont la grace est ecoulee depuis longtemps.
  srv.forceCloseCreation(enDepot.session.code, enDepot.hostToken);
  enDepot.session.patch({ graceEndAt: vieux });
  // Meme etat, mais quelqu'un est encore branche.
  srv.forceCloseCreation(occupee.session.code, occupee.hostToken);
  occupee.session.patch({ graceEndAt: vieux });
  occupee.session.presence.set('quelquun', new Set(['sock']));
  const toutes = [abandonnee, enDepot, occupee, enCreation, lobby].map((x) => x.session);
  for (const s of toutes) repo.touchSession(s.id, vieux);

  const purgees = await srv.sweep();
  assert.equal(srv.get(abandonnee.session.code), null, 'diffusion abandonnee : purgee');
  assert.equal(srv.get(enDepot.session.code), null, 'depot abandonne : purge');
  assert.equal(srv.get(lobby.session.code), null, 'lobby vide : purge, comme avant');
  assert.ok(srv.get(occupee.session.code), 'quelqu’un y est : on n’y touche pas');
  assert.ok(srv.get(enCreation.session.code), 'son chrono court encore : on n’y touche pas');
  assert.ok(purgees >= 3);
  assert.equal(repo.sessionById(abandonnee.session.id), null);
  assert.ok(repo.sessionById(occupee.session.id).touchedAt > vieux, 'sa date est repoussee');
});

test('export : toutes les manches et le classement general, pas seulement la derniere', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'Export', mediaType: 'text', config: { rounds: 2, scale: 10, defaultVote: 5 } });
  srv.publishSession(session.code, hostToken);
  const a = srv.join(session.code, { pseudo: 'ALPHA' });
  const b = srv.join(session.code, { pseudo: 'BRAVO' });
  const juge = srv.join(session.code, { pseudo: 'JUGE', spectator: true });
  srv.start(session.code, hostToken);
  /** Une manche complete : les deux deposent, le juge donne `notes` = { pseudo: note }. */
  const jouer = (notes) => {
    for (const g of [a, b]) {
      const prep = srv.openSubmissionSlot(session.code, g.participant.id, g.token);
      srv.saveSubmission(session, g.participant, { textBody: `M${session.round} ${g.participant.pseudo}`, filename: `${g.participant.pseudo}-m${session.round}.txt`, kind: 'text', inline: 1, late: 0 }, prep.existing);
    }
    srv.forceCloseCreation(session.code, hostToken);
    srv.startDiffusion(session.code, hostToken);
    srv.moveCursor(session.code, hostToken, { index: 1 });
    for (const sub of repo.submissions(session.id)) {
      const auteur = session.participants.get(sub.participantId).pseudo;
      srv.voteAs(session, juge.participant, { renditionId: sub.renditionId, value: notes[auteur] });
    }
    srv.showResults(session.code, hostToken);
    srv.reveal(session.code, hostToken, { all: true });
  };
  jouer({ ALPHA: 10, BRAVO: 2 });
  srv.nextRound(session.code, hostToken);
  jouer({ ALPHA: 4, BRAVO: 6 });

  const exp = views.exportView(session);
  assert.deepEqual(exp.manches.map((m) => m.round), [1, 2]);
  assert.deepEqual(exp.manches[0].rows.map((r) => r.author.pseudo), ['ALPHA', 'BRAVO'], 'la manche 1 sort de son classement fige');
  assert.equal(exp.manches[0].rows[0].filename, 'ALPHA-m1.txt', 'avec le fichier de cette manche-la');
  assert.deepEqual(exp.manches[1].rows.map((r) => r.author.pseudo), ['BRAVO', 'ALPHA']);
  assert.deepEqual(exp.general.map((l) => l.author.pseudo), ['ALPHA', 'BRAVO'], 'le general est la moyenne des deux');
  assert.equal(exp.general[0].scores.length, 2);

  const lignes = views.exportCsv(session).trim().split('\n');
  assert.match(lignes[0], /^manche;rang;pseudo;note/);
  assert.equal(lignes.filter((l) => l.startsWith('1;')).length, 2);
  assert.equal(lignes.filter((l) => l.startsWith('2;')).length, 2);
  assert.equal(lignes.filter((l) => l.startsWith('general;')).length, 2);
  assert.ok(lignes.every((l) => l.split(';').length === lignes[0].split(';').length), 'toutes les lignes ont le meme nombre de colonnes');
});

test('export : en une seule manche, le CSV garde ses colonnes d’avant', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'Export simple', mediaType: 'text' });
  srv.publishSession(session.code, hostToken);
  const a = srv.join(session.code, { pseudo: 'ALPHA' });
  srv.start(session.code, hostToken);
  const prep = srv.openSubmissionSlot(session.code, a.participant.id, a.token);
  srv.saveSubmission(session, a.participant, { textBody: 'Seul', kind: 'text', inline: 1, late: 0 }, prep.existing);
  srv.forceCloseCreation(session.code, hostToken);
  srv.startDiffusion(session.code, hostToken);
  srv.showResults(session.code, hostToken);
  const lignes = views.exportCsv(session).trim().split('\n');
  assert.match(lignes[0], /^rang;pseudo;note/);
  assert.equal(lignes.length, 2);
  assert.equal(views.exportView(session).general, null);
});

test('entre deux manches : la consigne et les elements imposes se changent', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'Trois manches', mediaType: 'text', brief: 'Consigne 1', config: { rounds: 2 } });
  srv.publishSession(session.code, hostToken);
  srv.join(session.code, { pseudo: 'CREA' });
  const element = (id) => srv.recordAsset(session, {
    id, filename: `${id}.wav`, storageKey: `sessions/${session.id}/assets/${id}.wav`, bytes: 10, mime: 'audio/wav', kind: 'audio', inline: true, position: 0,
  });
  element('avant');
  srv.start(session.code, hostToken);
  throws(() => srv.removeAsset(session.code, hostToken, 'avant'), 'ne se retire plus');
  srv.forceCloseCreation(session.code, hostToken);
  throws(() => srv.openAssetSlot(session.code, hostToken), 'ne se déposent plus');
  assert.equal(views.hostView(session).rules.assetAdd, false);
  srv.startDiffusion(session.code, hostToken);
  srv.showResults(session.code, hostToken);

  // Classement affiche, une manche reste : tout se change.
  assert.deepEqual(views.hostView(session).rules, { assetAdd: true, assetRemove: true });
  srv.openAssetSlot(session.code, hostToken);
  element('manche2');
  srv.removeAsset(session.code, hostToken, 'avant');
  assert.deepEqual(repo.assets(session.id).map((a) => a.id), ['manche2']);

  srv.nextRound(session.code, hostToken, { brief: 'Consigne 2' });
  assert.equal(session.brief, 'Consigne 2');
  assert.equal(repo.sessionById(session.id).brief, 'Consigne 2', 'ecrite en base');
  assert.equal(views.participantView(session).brief, 'Consigne 2');

  // Derniere manche : au classement, plus rien ne se prepare.
  srv.forceCloseCreation(session.code, hostToken);
  srv.startDiffusion(session.code, hostToken);
  srv.showResults(session.code, hostToken);
  assert.deepEqual(views.hostView(session).rules, { assetAdd: false, assetRemove: false });
  throws(() => srv.openAssetSlot(session.code, hostToken), 'ne se déposent plus');
});

test('manche suivante : sans consigne fournie, celle d’avant reste', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'Meme consigne', mediaType: 'text', brief: 'Toujours la meme', config: { rounds: 2 } });
  srv.publishSession(session.code, hostToken);
  srv.start(session.code, hostToken);
  srv.forceCloseCreation(session.code, hostToken);
  srv.startDiffusion(session.code, hostToken);
  srv.showResults(session.code, hostToken);
  srv.nextRound(session.code, hostToken);
  assert.equal(session.brief, 'Toujours la meme');
});

test('diffusion : un rendu passe sans note reste a rattraper, sur le canal de chacun', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'Rattrapage', mediaType: 'text', config: { scale: 5 } });
  srv.publishSession(session.code, hostToken);
  const gens = ['A', 'B', 'C'].map((p) => srv.join(session.code, { pseudo: `CREA${p}` }));
  const juge = srv.join(session.code, { pseudo: 'JUGE', spectator: true });
  session.presence.set(juge.participant.id, new Set(['sock-juge']));
  srv.start(session.code, hostToken);
  for (const g of gens) {
    const prep = srv.openSubmissionSlot(session.code, g.participant.id, g.token);
    srv.saveSubmission(session, g.participant, { textBody: g.participant.pseudo, kind: 'text', inline: 1, late: 0 }, prep.existing);
  }
  srv.forceCloseCreation(session.code, hostToken);
  srv.startDiffusion(session.code, hostToken);
  const vu = () => views.youView(session, juge.participant).aRattraper;
  assert.deepEqual(vu(), [], 'le rendu en cours se note sur la scene, pas ici');

  srv.io.sent.length = 0;
  srv.moveCursor(session.code, hostToken, { delta: 1 });
  assert.deepEqual(vu().map((m) => m.index), [0], 'le premier est passe sans sa note');
  const recu = srv.io.sent.filter((m) => m.ev === 'you' && m.room === 'sock-juge').at(-1)?.p;
  assert.deepEqual(recu?.aRattraper.map((m) => m.index), [0], 'et son telephone l’apprend quand le rendu passe');
  const carte = vu()[0].card;
  assert.ok(carte.renditionId && !('participantId' in carte) && !('filename' in carte), 'une carte anonyme, comme en diffusion');

  // Le zero est une note comme une autre : il rattrape.
  const note = srv.voteAs(session, juge.participant, { renditionId: carte.renditionId, value: 0 });
  assert.equal(note.value, 0);
  assert.deepEqual(vu(), []);

  // L'auteur du premier rendu n'a pas a rattraper le sien.
  srv.moveCursor(session.code, hostToken, { delta: 1 });
  const auteur = gens.find((g) => g.participant.id === repo.submission(session.order[0]).participantId);
  assert.ok(!views.youView(session, auteur.participant).aRattraper.some((m) => m.index === 0));
  srv.showResults(session.code, hostToken);
  assert.deepEqual(vu(), [], 'classement affiche : plus rien a rattraper');
});

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
  throws(() => srv.requireHost(session.code, 'pas-le-bon'), "pas l’animateur");
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

  throws(() => srv.join(session.code, { pseudo: 'alex' }), 'déjà pris');
  throws(() => srv.join(session.code, { pseudo: 'a' }), 'deux caractères');

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
  throws(() => srv.join(session.code, { pseudo: 'Alex' }), 'déjà pris');
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
  throws(() => srv.join(session.code, { pseudo: 'Spectateur' }), 'fermées');
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
