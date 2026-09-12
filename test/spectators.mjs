/**
 * Mode spectateur.
 *
 * Un spectateur vient juger sans creer. Ce qui se verifie ici tient a l'equite
 * du classement : il vote comme les autres, il ne depose rien, il ne figure pas
 * au palmares, et il ne peut pas arriver une fois la diffusion commencee — les
 * votants absents comptant pour la note par defaut, des juges en retard
 * fausseraient tous les rendus deja passes.
 */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);

const DATA_DIR = process.env.TEST_DATA_DIR || '/tmp/arena-test-spectators';
rmSync(DATA_DIR, { recursive: true, force: true });
process.env.NODE_ENV = 'development';
process.env.DATA_DIR = DATA_DIR;
process.env.SESSION_SECRET = 'test-secret';

const { BattleServer, BattleError } = require('../server/battle.js');
const views = require('../server/views.js');
const repo = require('../server/repo.js');

const fakeIo = () => ({ sent: [], to(room) { const s = this; return { emit(ev, p) { s.sent.push({ room, ev, p }); } }; } });

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

/** Une session ouverte, avec des createurs et des spectateurs. */
function ouvrir({ createurs = 2, spectateurs = 1 } = {}) {
  const srv = new BattleServer(fakeIo());
  const { session, hostToken } = srv.createSession({ name: 'Battle', mediaType: 'text' });
  srv.setPhase(session, 'lobby');
  const gens = [];
  for (let i = 0; i < createurs; i++) gens.push({ role: 'createur', ...srv.join(session.code, { pseudo: `CREATEUR${i + 1}` }) });
  for (let i = 0; i < spectateurs; i++) gens.push({ role: 'spectateur', ...srv.join(session.code, { pseudo: `JUGE${i + 1}`, spectator: true }) });
  return { srv, session, hostToken, gens };
}

/* ------------------------------------------------------------------ */

test('un spectateur rejoint et son role est enregistre', () => {
  const { gens } = ouvrir();
  const juge = gens.find((g) => g.role === 'spectateur');
  assert.equal(juge.participant.spectator, true);
  // Et il survit a une relecture depuis la base : ce n'est pas qu'en memoire.
  assert.equal(repo.participant(juge.participant.id).spectator, true);
});

test('le role ne se devine pas : sans le demander, on est createur', () => {
  const { gens } = ouvrir();
  assert.equal(gens.find((g) => g.role === 'createur').participant.spectator, false);
});

test('le depot est ferme au spectateur', () => {
  const { srv, session, gens } = ouvrir();
  srv.setPhase(session, 'creation');
  const juge = gens.find((g) => g.role === 'spectateur');
  throws(() => srv.openSubmissionSlot(session.code, juge.participant.id, juge.token), 'spectateur');
});

test('le depot reste ouvert au createur', () => {
  const { srv, session, gens } = ouvrir();
  srv.setPhase(session, 'creation');
  const createur = gens.find((g) => g.role === 'createur');
  const prep = srv.openSubmissionSlot(session.code, createur.participant.id, createur.token);
  assert.equal(prep.participant.id, createur.participant.id);
});

test('un spectateur vote, et sa voix compte dans le denominateur', () => {
  const { srv, session, gens } = ouvrir({ createurs: 2, spectateurs: 2 });
  const [a, b] = gens.filter((g) => g.role === 'createur');
  srv.setPhase(session, 'creation');
  for (const g of [a, b]) {
    const prep = srv.openSubmissionSlot(session.code, g.participant.id, g.token);
    srv.saveSubmission(session, g.participant, { textBody: `RENDU DE ${g.participant.pseudo}`, kind: 'text', inline: 1, late: 0 }, prep.existing);
  }
  srv.setPhase(session, 'upload');
  srv.setPhase(session, 'diffusion');
  const sub = repo.submissions(session.id)[0];
  // Quatre inscrits, l'auteur ne vote pas sur lui-meme : trois voix attendues.
  assert.equal(srv.get(session.code).eligibleVoters(sub), 3);
});

test('un spectateur ne peut pas rejoindre une fois la diffusion commencee', () => {
  const { srv, session } = ouvrir();
  srv.setPhase(session, 'creation');
  srv.setPhase(session, 'upload');
  srv.setPhase(session, 'diffusion');
  throws(() => srv.join(session.code, { pseudo: 'RETARDATAIRE', spectator: true }), 'diffusion a commence');
});

test('les compteurs n’attendent pas de rendu d’un spectateur', () => {
  const { session } = ouvrir({ createurs: 3, spectateurs: 2 });
  const vue = views.participantView(session);
  assert.equal(vue.counts.participants, 3, 'trois createurs attendus au depot');
  assert.equal(vue.counts.spectators, 2, 'deux spectateurs annonces a part');
});

test('le roster dit qui juge et qui cree', () => {
  const { session } = ouvrir({ createurs: 1, spectateurs: 1 });
  const roster = views.hostView(session).roster;
  assert.equal(roster.filter((r) => r.spectator).length, 1);
  assert.equal(roster.filter((r) => !r.spectator).length, 1);
});

test('un spectateur n’apparait pas au classement', () => {
  const { srv, session, gens } = ouvrir({ createurs: 2, spectateurs: 1 });
  const createurs = gens.filter((g) => g.role === 'createur');
  srv.setPhase(session, 'creation');
  for (const g of createurs) {
    const prep = srv.openSubmissionSlot(session.code, g.participant.id, g.token);
    srv.saveSubmission(session, g.participant, { textBody: 'X', kind: 'text', inline: 1, late: 0 }, prep.existing);
  }
  srv.setPhase(session, 'upload');
  srv.setPhase(session, 'diffusion');
  srv.setPhase(session, 'results');
  const podium = views.podiumView({ ...srv.get(session.code), revealedRank: Number.MAX_SAFE_INTEGER });
  const auteurs = podium.rows.filter((r) => r.author).map((r) => r.author.pseudo);
  assert.equal(auteurs.length, 2, 'seuls les deux createurs sont classes');
  assert.ok(!auteurs.some((p) => p.startsWith('JUGE')), 'aucun spectateur au classement');
});

test('a la reprise, le role choisi a l’entree est conserve', () => {
  const { srv, session, gens } = ouvrir();
  const juge = gens.find((g) => g.role === 'spectateur');
  // Une reprise qui pretendrait le contraire ne change rien : le serveur
  // retrouve le participant par son jeton, et son role avec lui.
  const repris = srv.join(session.code, {
    participantId: juge.participant.id, token: juge.token, spectator: false,
  });
  assert.equal(repris.resumed, true);
  assert.equal(repris.participant.spectator, true);
});

test('le lien spectateur mene au bon role', () => {
  // La route « /s/CODE » n'ajoute rien au jeu : elle oriente seulement la page
  // d'entree. Ce qui se verifie ici, c'est qu'elle ne se confond pas avec le
  // lien des createurs et qu'elle porte bien le role.
  const { mount } = require('../server/api.js');
  const routes = [];
  const noop = () => {};
  const app = {
    get(path, ...rest) { routes.push({ path, handler: rest[rest.length - 1] }); },
    post: noop, put: noop, patch: noop, delete: noop, use: noop, all: noop, set: noop,
  };
  mount(app, new BattleServer(fakeIo()));
  const joueur = routes.find((r) => r.path === '/j/:code');
  const juge = routes.find((r) => r.path === '/s/:code');
  assert.ok(joueur && juge, 'les deux liens courts existent');
  const cible = (route) => {
    let dest = null;
    route.handler({ params: { code: 'k7x2' } }, { redirect: (url) => { dest = url; } });
    return dest;
  };
  assert.equal(cible(joueur), '/play?code=K7X2');
  assert.equal(cible(juge), '/play?code=K7X2&role=spectateur');
});

test('le classement porte de quoi reecouter sans telecharger', () => {
  const { srv, session, gens } = ouvrir({ createurs: 2, spectateurs: 0 });
  srv.setPhase(session, 'creation');
  for (const g of gens) {
    const prep = srv.openSubmissionSlot(session.code, g.participant.id, g.token);
    srv.saveSubmission(session, g.participant, { textBody: `TEXTE DE ${g.participant.pseudo}`, kind: 'text', inline: 1, late: 0 }, prep.existing);
  }
  srv.setPhase(session, 'upload');
  srv.setPhase(session, 'diffusion');
  srv.setPhase(session, 'results');
  const podium = views.podiumView({ ...srv.get(session.code), revealedRank: Number.MAX_SAFE_INTEGER });
  for (const row of podium.rows.filter((r) => !r.hidden)) {
    assert.ok(row.rendition, 'chaque ligne porte son rendu');
    assert.equal(row.rendition.kind, 'text');
    // Le classement doit se suffire a lui-meme : de quoi rejouer dans la page,
    // sans passer par un telechargement.
    assert.ok(row.rendition.textBody, 'le texte est la, pas seulement un lien');
    assert.ok(row.author, 'l’auteur est revele a ce stade');
  }
});

/*
 * Le canal personnel part des l'arrivee.
 *
 * C'est la garde qui manquait. L'etat personnel n'etait pousse qu'apres un vote
 * ou un depot : quelqu'un qui venait d'entrer restait sans, et la page ne
 * pouvait pas savoir s'il creait ou s'il regardait. Elle supposait qu'il
 * creait, et ouvrait le depot a un spectateur.
 */
test('a l’arrivee, chacun recoit son etat personnel avec son role', () => {
  const io = fakeIo();
  const srv = new BattleServer(io);
  const { session } = srv.createSession({ name: 'Battle', mediaType: 'text' });
  srv.setPhase(session, 'lobby');

  for (const [pseudo, spectator] of [['CREATEUR1', false], ['JUGE1', true]]) {
    const { participant } = srv.join(session.code, { pseudo, spectator });
    const socket = { id: `sock-${participant.id}`, data: {}, join() {} };
    io.sent.length = 0;
    srv.attachParticipant(socket, session, participant);

    const perso = io.sent.filter((m) => m.ev === 'you');
    assert.equal(perso.length, 1, `${pseudo} doit recevoir un etat personnel en entrant`);
    assert.equal(perso[0].room, socket.id, 'et sur sa seule socket');
    assert.equal(perso[0].p.spectator, spectator, 'qui porte son role, sans avoir a le deviner');
  }
});

/* ------------------------------------------------------------------ */

for (const [name, fn] of checks) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${checks.length} verifications passees`);
