/**
 * LA CHAINE — le jeu d'attente des spectateurs.
 *
 * Un cadavre exquis a un tour chacun, pendant que les autres creent. Ce qui se
 * verifie ici tient a trois promesses : personne ne lit avant la fin, un
 * spectateur absent ne bloque pas la file, et rien de tout cela n'entre dans
 * le classement — un jeu d'attente qui compterait ferait du spectateur un
 * concurrent par la bande.
 */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);

const DATA_DIR = process.env.TEST_DATA_DIR || '/tmp/arena-test-chaine';
rmSync(DATA_DIR, { recursive: true, force: true });
process.env.NODE_ENV = 'development';
process.env.DATA_DIR = DATA_DIR;
process.env.SESSION_SECRET = 'test-secret';

const { BattleServer, BattleError } = require('../server/battle.js');
const views = require('../server/views.js');
const repo = require('../server/repo.js');

const fakeIo = () => ({ sent: [], to(room) { const s = this; return { emit(ev, p) { s.sent.push({ room, ev, p }); } }; } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Met quelqu'un en ligne, ou l'en sort : la chaine ne donne la main qu'aux presents. */
const brancher = (session, g) => session.presence.set(g.participant.id, new Set([`sock-${g.participant.pseudo}`]));
const debrancher = (session, g) => session.presence.delete(g.participant.id);

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

function refuse(fn, needle) {
  try { fn(); } catch (err) {
    assert.ok(err instanceof BattleError, `attendu BattleError, recu ${err.name}: ${err.message}`);
    if (needle) assert.ok(err.message.includes(needle), `message « ${err.message} » ne contient pas « ${needle} »`);
    return err;
  }
  assert.fail('aucun refus');
}

/** Une session en creation, avec des createurs et des spectateurs nommes. */
function ouvrir({ createurs = 1, spectateurs = 3 } = {}) {
  const srv = new BattleServer(fakeIo());
  const { session } = srv.createSession({ name: 'Battle', mediaType: 'text' });
  srv.setPhase(session, 'lobby');
  const gens = {};
  let t = Date.now();
  for (let i = 0; i < createurs; i++) gens[`C${i + 1}`] = srv.join(session.code, { pseudo: `CREATEUR${i + 1}` });
  for (let i = 0; i < spectateurs; i++) {
    const g = srv.join(session.code, { pseudo: `JUGE${i + 1}`, spectator: true });
    // L'ordre du tour suit l'arrivee : on l'espace pour qu'il soit sans ambiguite.
    g.participant.joinedAt = t += 1000;
    gens[`S${i + 1}`] = g;
  }
  for (const g of Object.values(gens)) brancher(session, g);
  srv.setPhase(session, 'creation');
  return { srv, session, gens };
}

const tour = (srv, session) => srv.chainResolve(session).turnId;

/* ------------------------------------------------------------------ */

test('la chaine ne tourne que pendant la création', () => {
  const { srv, session, gens } = ouvrir();
  assert.equal(srv.chainResolve(session).open, true);
  srv.setPhase(session, 'upload');
  assert.equal(srv.chainResolve(session).open, true, 'la fenetre de grace compte encore');
  srv.setPhase(session, 'diffusion');
  assert.equal(srv.chainResolve(session).open, false);
  refuse(() => srv.chainWrite(session, gens.S1.participant, 'trop tard'), 'que pendant la création');
});

test('sans spectateur, il n’y a pas de chaine', () => {
  const { srv, session } = ouvrir({ spectateurs: 0 });
  const etat = srv.chainResolve(session);
  assert.equal(etat.open, false);
  assert.equal(etat.turnId, null);
});

test('le tour part du premier arrive', () => {
  const { srv, session, gens } = ouvrir();
  assert.equal(tour(srv, session), gens.S1.participant.id);
});

test('un createur n’ecrit pas dans la chaine : il a mieux a faire', () => {
  const { srv, session, gens } = ouvrir();
  refuse(() => srv.chainWrite(session, gens.C1.participant, 'je passais'), 'ceux qui regardent');
});

test('on n’ecrit pas au tour d’un autre', () => {
  const { srv, session, gens } = ouvrir();
  refuse(() => srv.chainWrite(session, gens.S2.participant, 'moi d’abord'), 'pas votre tour');
});

test('une ligne vide ne prolonge rien', () => {
  const { srv, session, gens } = ouvrir();
  refuse(() => srv.chainWrite(session, gens.S1.participant, '   '), 'vide');
});

test('une ligne trop longue est ramenee a la borne, pas refusee', () => {
  const { srv, session, gens } = ouvrir();
  const ligne = srv.chainWrite(session, gens.S1.participant, 'x'.repeat(400));
  assert.equal(ligne.body.length, BattleServer.CHAIN_LINE_MAX);
});

test('ecrire passe la main au suivant', () => {
  const { srv, session, gens } = ouvrir();
  srv.chainWrite(session, gens.S1.participant, 'Il etait une fois');
  assert.equal(tour(srv, session), gens.S2.participant.id);
  srv.chainWrite(session, gens.S2.participant, 'un serveur qui comptait mal');
  assert.equal(tour(srv, session), gens.S3.participant.id);
  srv.chainWrite(session, gens.S3.participant, 'et personne ne s’en apercut');
  assert.equal(tour(srv, session), gens.S1.participant.id, 'la file tourne en rond');
  assert.equal(repo.chainLines(session.id).length, 3);
});

test('passer son tour avance la file sans rien ecrire', () => {
  const { srv, session, gens } = ouvrir();
  srv.chainPass(session, gens.S1.participant);
  assert.equal(tour(srv, session), gens.S2.participant.id);
  assert.equal(repo.chainLines(session.id).length, 0);
  refuse(() => srv.chainPass(session, gens.S1.participant), 'pas votre tour');
});

test('un spectateur absent ne bloque pas la file : son tour expire', () => {
  const { srv, session, gens } = ouvrir();
  const t0 = Date.now();
  srv.chainResolve(session, t0);
  assert.equal(tour(srv, session), gens.S1.participant.id);
  const apres = t0 + BattleServer.CHAIN_TURN_MS + 10;
  assert.equal(srv.chainResolve(session, apres).turnId, gens.S2.participant.id);
});

test('plusieurs tours ecoules se passent d’un coup, sans boucler', () => {
  const { srv, session, gens } = ouvrir();
  const t0 = Date.now();
  srv.chainResolve(session, t0);
  // Une heure d'inattention : sept tours entiers, plus le courant.
  const bienPlusTard = t0 + BattleServer.CHAIN_TURN_MS * 7 + 5;
  const etat = srv.chainResolve(session, bienPlusTard);
  assert.equal(etat.turnId, gens[`S${(7 % 3) + 1}`].participant.id);
  assert.ok(etat.turnEndsAt > bienPlusTard, 'le sablier courant n’est pas deja perime');
});

test('pendant la creation, on ne voit que la derniere ligne', () => {
  const { srv, session, gens } = ouvrir();
  srv.chainWrite(session, gens.S1.participant, 'Premiere');
  srv.chainWrite(session, gens.S2.participant, 'Deuxieme');

  const vu = views.youView(session, gens.S3.participant);
  assert.equal(vu.chain.last, 'Deuxieme', 'la ligne a prolonger');
  assert.equal(vu.chain.lastBy, 'JUGE2');
  assert.equal(vu.chain.mine, true, 'et c’est son tour');
  assert.equal(vu.chain.position, 3);

  const commun = views.participantView(session);
  assert.equal(commun.chain.lines, 2, 'l’etat commun compte, il ne raconte pas');
  assert.equal(commun.chain.revealed, null, 'personne ne lit avant la fin');
  assert.equal(commun.chain.turn.pseudo, 'JUGE3');
});

test('un createur ne recoit rien de la chaine sur son canal', () => {
  const { srv, session, gens } = ouvrir();
  srv.chainWrite(session, gens.S1.participant, 'Secrete');
  assert.equal(views.youView(session, gens.C1.participant).chain, null);
});

test('tout se devoile quand la creation est finie', () => {
  const { srv, session, gens } = ouvrir();
  srv.chainWrite(session, gens.S1.participant, 'Premiere');
  srv.chainWrite(session, gens.S2.participant, 'Deuxieme');
  srv.setPhase(session, 'upload');
  srv.setPhase(session, 'diffusion');

  const commun = views.participantView(session);
  assert.equal(commun.chain.open, false);
  assert.deepEqual(commun.chain.revealed.map((l) => l.body), ['Premiere', 'Deuxieme']);
  assert.deepEqual(commun.chain.revealed.map((l) => l.pseudo), ['JUGE1', 'JUGE2']);
  assert.equal(commun.chain.turn, null, 'plus de tour : c’est fini');
  // La regie et l'ecran lisent la meme chose : la lecture se fait a voix haute.
  assert.equal(views.hostView(session).chain.revealed.length, 2);
  assert.equal(views.screenView(session).chain.revealed.length, 2);
});

test('la chaine ne rapporte rien : le classement l’ignore', () => {
  const { srv, session, gens } = ouvrir({ createurs: 2 });
  srv.chainWrite(session, gens.S1.participant, 'Une ligne qui ne vaut aucun point');
  for (const g of [gens.C1, gens.C2]) {
    const prep = srv.openSubmissionSlot(session.code, g.participant.id, g.token);
    srv.saveSubmission(session, g.participant, { textBody: `TEXTE DE ${g.participant.pseudo}`, kind: 'text', inline: 1, late: 0 }, prep.existing);
  }
  srv.setPhase(session, 'upload');
  srv.startDiffusionInternal(session);
  srv.setPhase(session, 'results');
  const podium = views.podiumView({ ...srv.get(session.code), revealedRank: Number.MAX_SAFE_INTEGER });
  const pseudos = podium.rows.map((r) => r.author?.pseudo).filter(Boolean);
  assert.ok(!pseudos.includes('JUGE1'), 'celui qui a ecrit dans la chaine n’est pas classe');
  assert.equal(podium.rows.length, 2, 'seuls les createurs figurent');
});

test('les lignes survivent a un redemarrage', () => {
  const { srv, session, gens } = ouvrir();
  srv.chainWrite(session, gens.S1.participant, 'Ecrite avant la coupure');
  const code = session.code;

  // Nouvelle instance, meme base : c'est ce que fait un redemarrage.
  const encore = new BattleServer(fakeIo());
  const reprise = encore.require(code);
  // Les telephones se reconnectent : sans personne en ligne, la chaine attend.
  for (const p of reprise.participants.values()) reprise.presence.set(p.id, new Set([`sock-${p.pseudo}`]));
  const lignes = repo.chainLines(reprise.id);
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].body, 'Ecrite avant la coupure');
  assert.equal(lignes[0].pseudo, 'JUGE1', 'la ligne reste attribuable');

  /*
   * Le tour reprend apres la derniere ligne, pas au debut.
   *
   * On le verifie sur l'ordre tel que la reprise le reconstitue, et non sur un
   * pseudo choisi d'avance : l'ordre vient des instants d'arrivee relus en
   * base, et deux inscriptions dans la meme milliseconde se departagent par
   * identifiant. Nommer le suivant ici ferait echouer le test une fois sur
   * trois pour une raison qui n'est pas la sienne.
   */
  const etat = encore.chainResolve(reprise);
  assert.equal(etat.order.length, 3, 'les trois spectateurs sont revenus');
  assert.equal(etat.turnId, etat.order[1], 'une ligne ecrite, donc au deuxieme de jouer');
});

test('la main ne va pas a un spectateur hors ligne', () => {
  const { srv, session, gens } = ouvrir();
  debrancher(session, gens.S2);
  srv.chainWrite(session, gens.S1.participant, 'Premiere');
  assert.equal(tour(srv, session), gens.S3.participant.id, 'S2 est parti : on ne l’attend pas 90 secondes');
  srv.chainWrite(session, gens.S3.participant, 'Deuxieme');
  assert.equal(tour(srv, session), gens.S1.participant.id);
});

test('celui qui tient la main ne la perd pas pour une page rechargee', () => {
  const { srv, session, gens } = ouvrir();
  assert.equal(tour(srv, session), gens.S1.participant.id);
  debrancher(session, gens.S1);
  assert.equal(tour(srv, session), gens.S1.participant.id, 'une coupure ne passe pas le tour');
  brancher(session, gens.S1);
  srv.chainWrite(session, gens.S1.participant, 'Je suis revenu');
  assert.equal(tour(srv, session), gens.S2.participant.id);
});

test('personne en ligne : la chaine attend, et repart au premier qui revient', () => {
  const { srv, session, gens } = ouvrir();
  srv.chainPass(session, gens.S1.participant);
  for (const g of [gens.S1, gens.S2, gens.S3]) debrancher(session, g);
  const t0 = Date.now();
  // Le tour de S2 expire sans personne pour le prendre.
  const vide = srv.chainResolve(session, t0 + BattleServer.CHAIN_TURN_MS * 5);
  assert.equal(vide.turnId, null);
  assert.equal(vide.turnEndsAt, null, 'aucun sablier ne tourne dans le vide');
  brancher(session, gens.S3);
  const plusTard = t0 + BattleServer.CHAIN_TURN_MS * 9;
  const repris = srv.chainResolve(session, plusTard);
  assert.equal(repris.turnId, gens.S3.participant.id);
  assert.equal(repris.turnEndsAt, plusTard + BattleServer.CHAIN_TURN_MS, 'sablier plein pour celui qui revient');
});

test('quand le tour expire, le nouveau tenant l’apprend sur son canal', () => {
  const { srv, session, gens } = ouvrir();
  srv.publish(session);
  srv.io.sent.length = 0;
  // Le sablier de S1 est ecoule ; rien d'autre ne se passe que l'echeance.
  session.chainTurnEndsAt = Date.now() - 1;
  srv.onChainDeadline(session.code);
  const recus = srv.io.sent.filter((m) => m.ev === 'you');
  const pour = (g) => recus.filter((m) => m.room === `sock-${g.participant.pseudo}`).at(-1)?.p;
  assert.equal(pour(gens.S2)?.chain.mine, true, 'S2 sait que c’est a lui');
  assert.equal(pour(gens.S1)?.chain.mine, false, 'S1 sait qu’il a laisse passer');
  assert.equal(pour(gens.S3)?.chain.ahead, 1, 'S3 passe juste apres');
  assert.equal(pour(gens.S1)?.chain.ahead, 2, 'S1 attend deux tours, pas un');
  assert.equal(recus.filter((m) => m.room === `sock-${gens.C1.participant.pseudo}`).length, 0, 'un createur n’est pas derange');
});

test('la fin de tour sonne toute seule : un minuteur, pas un regard', async () => {
  const { srv, session, gens } = ouvrir();
  srv.publish(session);
  session.chainTurnEndsAt = Date.now() + 40;
  srv.armChain(session);
  await sleep(160);
  assert.equal(session.chainTurn, gens.S2.participant.id, 'personne n’a rien demande, et la main est passee');
  assert.ok(srv.chainTimers.has(session.code), 'le tour suivant a son echeance');
  srv.disarmChain(session.code);
});

test('les lignes appartiennent a leur manche', () => {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'Deux manches', mediaType: 'text', config: { rounds: 2 } });
  srv.publishSession(session.code, hostToken);
  const juge = srv.join(session.code, { pseudo: 'JUGE', spectator: true });
  const autre = srv.join(session.code, { pseudo: 'JUGE2', spectator: true });
  autre.participant.joinedAt = juge.participant.joinedAt + 1000;
  brancher(session, juge);
  brancher(session, autre);
  srv.start(session.code, hostToken);
  srv.chainWrite(session, juge.participant, 'Ligne de la manche 1');
  srv.forceCloseCreation(session.code, hostToken);
  srv.startDiffusion(session.code, hostToken);
  srv.showResults(session.code, hostToken);
  srv.nextRound(session.code, hostToken);

  assert.equal(repo.chainLines(session.id).length, 0, 'la manche 2 s’ouvre sur une page blanche');
  assert.equal(repo.chainLines(session.id, 1).length, 1, 'la manche 1 garde la sienne');
  assert.equal(tour(srv, session), juge.participant.id, 'et le tour repart du premier');
  assert.equal(views.youView(session, juge.participant).chain.last, null, 'rien a prolonger de la manche passee');
  srv.chainWrite(session, juge.participant, 'Ligne de la manche 2');
  srv.forceCloseCreation(session.code, hostToken);
  srv.startDiffusion(session.code, hostToken);
  assert.deepEqual(views.participantView(session).chain.revealed.map((l) => l.body), ['Ligne de la manche 2']);
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
