/**
 * LA ROULETTE — le tirage, et ce qui le rend defendable.
 *
 * Trois proprietes portent cette suite, parce que ce sont les trois par
 * lesquelles une roue perd l'autorite qu'elle est censee avoir :
 *
 *   - LA GRAINE REJOUE. Meme graine, meme liste, meme sort. Un tirage conteste
 *     doit pouvoir etre refait devant celui qui le contexte.
 *   - LES POIDS TIENNENT. Une case a zero ne sort jamais, et une case trois
 *     fois plus lourde sort environ trois fois plus souvent.
 *   - CE QUI EST TIRE NE SE REECRIT PAS. Renommer une roue, corriger un sort,
 *     supprimer la roue entiere : l'histoire de la session ne bouge pas.
 *
 * Et une quatrieme, qui vient de la salle plutot que du hasard : un effet
 * mecanique ne s'applique que si la phase le permet. Sinon le sort reste une
 * consigne, et le serveur le dit au lieu de faire semblant.
 */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);

const DATA_DIR = process.env.TEST_DATA_DIR || '/tmp/arena-test-roulette';
rmSync(DATA_DIR, { recursive: true, force: true });
process.env.NODE_ENV = 'development';
process.env.DATA_DIR = DATA_DIR;
process.env.SESSION_SECRET = 'test-secret';

const { BattleServer } = require('../server/battle.js');
const roulette = require('../server/roulette.js');
const { RouletteError } = roulette;
const views = require('../server/views.js');
const repo = require('../server/repo.js');

const fakeIo = () => ({ sent: [], to(room) { const s = this; return { emit(ev, p) { s.sent.push({ room, ev, p }); } }; } });

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

function refuse(fn, needle) {
  try { fn(); } catch (err) {
    assert.ok(err instanceof RouletteError, `attendu RouletteError, recu ${err.name} : ${err.message}`);
    if (needle) assert.ok(err.message.includes(needle), `message « ${err.message} » ne contient pas « ${needle} »`);
    return err;
  }
  assert.fail('aucun refus');
}

/* ------------------------------------------------------------------ */
/* Outillage                                                           */
/* ------------------------------------------------------------------ */

let compteur = 0;

/** Une session en creation, avec des createurs et des spectateurs nommes. */
function ouvrir({ createurs = 4, spectateurs = 0, phase = 'creation' } = {}) {
  const srv = new BattleServer(fakeIo());
  const { session } = srv.createSession({ name: `Battle ${++compteur}`, mediaType: 'text' });
  srv.setPhase(session, 'lobby');
  const gens = {};
  let t = Date.now();
  for (let i = 0; i < createurs; i++) {
    const g = srv.join(session.code, { pseudo: `CREATEUR${i + 1}` });
    g.participant.joinedAt = t += 1000;
    gens[`C${i + 1}`] = g;
  }
  for (let i = 0; i < spectateurs; i++) {
    const g = srv.join(session.code, { pseudo: `JUGE${i + 1}`, spectator: true });
    g.participant.joinedAt = t += 1000;
    gens[`S${i + 1}`] = g;
  }
  if (phase !== 'lobby') {
    srv.setPhase(session, 'creation');
    for (const suivante of ['upload', 'diffusion', 'results']) {
      if (phase === 'creation') break;
      srv.setPhase(session, suivante);
      if (suivante === phase) break;
    }
  }
  return { srv, session, gens };
}

/** Une roue avec des cases nommees, et les effets qu'on veut. */
function roue(nom, cases) {
  const w = roulette.creerRoue({ name: nom });
  for (const c of cases) roulette.ajouterCase({ wheelId: w.id, ...c });
  return w;
}

const MALUS = [
  { label: 'Sans kick', weight: 1, points: -2 },
  { label: 'Mono seulement', weight: 1, points: -1 },
  { label: 'Trente secondes de moins', weight: 1, chronoMs: -30000 },
  { label: 'Rien du tout', weight: 1 },
  { label: 'Le double de temps', weight: 1, chronoMs: 60000 },
];

/* ------------------------------------------------------------------ */
/* Les roues                                                           */
/* ------------------------------------------------------------------ */

test('une roue se cree, se nomme, et porte ses cases', () => {
  const w = roue('Malus legers', MALUS);
  assert.equal(w.name, 'Malus legers');
  assert.equal(repo.slots(w.id).length, 5);
  assert.deepEqual(repo.slots(w.id).map((c) => c.position), [0, 1, 2, 3, 4]);
});

test('une roue sans nom est refusee, une case sans texte aussi', () => {
  refuse(() => roulette.creerRoue({ name: '   ' }), 'Donnez un nom');
  const w = roue('Vide', []);
  refuse(() => roulette.ajouterCase({ wheelId: w.id, label: '  ' }), 'ne dit rien');
});

test('les effets sont bornes : une faute de frappe ne coute pas mille points', () => {
  const w = roue('Demesure', [{ label: 'Enorme', points: 9999, chronoMs: 99999999 }]);
  const c = repo.slots(w.id)[0];
  assert.equal(c.points, roulette.POINTS_MAX * -1 === c.points ? c.points : roulette.POINTS_MAX);
  assert.equal(c.chronoMs, roulette.CHRONO_MAX_MS);
});

test('retirer une case resserre les positions', () => {
  const w = roue('A trous', MALUS);
  const cases = repo.slots(w.id);
  roulette.retirerCase({ slotId: cases[1].id });
  assert.deepEqual(repo.slots(w.id).map((c) => c.position), [0, 1, 2, 3]);
});

test('deplacer une case reordonne sans trou', () => {
  const w = roue('A trier', MALUS);
  const cases = repo.slots(w.id);
  roulette.deplacerCase({ slotId: cases[4].id, vers: 0 });
  const apres = repo.slots(w.id);
  assert.equal(apres[0].label, 'Le double de temps');
  assert.deepEqual(apres.map((c) => c.position), [0, 1, 2, 3, 4]);
});

/* ------------------------------------------------------------------ */
/* Le hasard, et ce qui le rend defendable                             */
/* ------------------------------------------------------------------ */

test('la meme graine rend le meme tirage', () => {
  const { srv, session } = ouvrir();
  const w = roue('Rejouable', MALUS);
  const un = roulette.tirer(session, { wheelId: w.id, target: 'one', seed: 'graine-fixe' });
  const deux = roulette.tirer(session, { wheelId: w.id, target: 'one', seed: 'graine-fixe' });
  assert.equal(un.fates[0].pseudo, deux.fates[0].pseudo, 'la meme personne');
  assert.equal(un.fates[0].label, deux.fates[0].label, 'et le meme sort');
  assert.notEqual(un.spin.id, deux.spin.id, 'mais deux tirages distincts en base');
  void srv;
});

test('une graine differente ne rend pas toujours la meme chose', () => {
  const { session } = ouvrir({ createurs: 8 });
  const w = roue('Varie', MALUS);
  const vus = new Set();
  for (let i = 0; i < 20; i++) {
    vus.add(roulette.tirer(session, { wheelId: w.id, target: 'one', seed: `g${i}` }).fates[0].pseudo);
  }
  assert.ok(vus.size > 1, 'huit personnes et vingt tirages ne peuvent pas donner toujours la meme');
});

test('une case a zero ne sort jamais, mais son texte reste', () => {
  const { session } = ouvrir();
  const w = roue('Avec une muette', [
    { label: 'Jamais celle-la', weight: 0, points: -5 },
    { label: 'Toujours celle-ci', weight: 1 },
  ]);
  assert.equal(repo.slots(w.id).length, 2, 'la case existe toujours');
  for (let i = 0; i < 30; i++) {
    const t = roulette.tirer(session, { wheelId: w.id, target: 'one', seed: `z${i}` });
    assert.equal(t.fates[0].label, 'Toujours celle-ci');
  }
});

test('une roue dont toutes les cases sont muettes se refuse en le disant', () => {
  const { session } = ouvrir();
  const w = roue('Toute muette', [{ label: 'Rien', weight: 0 }]);
  refuse(() => roulette.tirer(session, { wheelId: w.id }), 'aucune case jouable');
});

test('un poids triple sort environ trois fois plus souvent', () => {
  const { session } = ouvrir();
  const w = roue('Pesee', [
    { label: 'Lourde', weight: 3 },
    { label: 'Legere', weight: 1 },
  ]);
  let lourdes = 0;
  const essais = 600;
  for (let i = 0; i < essais; i++) {
    if (roulette.tirer(session, { wheelId: w.id, target: 'one', seed: `p${i}` }).fates[0].label === 'Lourde') {
      lourdes += 1;
    }
  }
  const part = lourdes / essais;
  assert.ok(part > 0.68 && part < 0.82, `attendu environ 0.75, mesure ${part.toFixed(3)}`);
});

/* ------------------------------------------------------------------ */
/* Les trois modes                                                     */
/* ------------------------------------------------------------------ */

test('une seule personne : un vise, un sort', () => {
  const { session } = ouvrir({ createurs: 5 });
  const w = roue('Un seul', MALUS);
  const t = roulette.tirer(session, { wheelId: w.id, target: 'one' });
  assert.equal(t.fates.length, 1);
  assert.equal(t.spin.howMany, 1);
});

test('plusieurs personnes : le compte demande, et jamais deux fois la meme', () => {
  const { session } = ouvrir({ createurs: 6 });
  const w = roue('Quelques-uns', MALUS);
  const t = roulette.tirer(session, { wheelId: w.id, target: 'some', howMany: 3 });
  assert.equal(t.fates.length, 3);
  assert.equal(new Set(t.fates.map((f) => f.participantId)).size, 3, 'trois personnes distinctes');
});

test('plus de vises que de monde : on ne tire pas des fantomes', () => {
  const { session } = ouvrir({ createurs: 2 });
  const w = roue('Trop demande', MALUS);
  const t = roulette.tirer(session, { wheelId: w.id, target: 'some', howMany: 99 });
  assert.equal(t.fates.length, 2);
});

test('tout le monde, meme sort : une seule case pour la salle entiere', () => {
  const { session } = ouvrir({ createurs: 4 });
  const w = roue('Collectif', MALUS);
  const t = roulette.tirer(session, { wheelId: w.id, target: 'all', shared: true });
  assert.equal(t.fates.length, 4);
  assert.equal(new Set(t.fates.map((f) => f.label)).size, 1, 'un seul sort, partage');
});

test('tout le monde, un sort chacun : et ils sont DIFFERENTS', () => {
  const { session } = ouvrir({ createurs: 4 });
  const w = roue('Distribution', MALUS);
  const t = roulette.tirer(session, { wheelId: w.id, target: 'all', shared: false });
  assert.equal(t.fates.length, 4);
  assert.equal(new Set(t.fates.map((f) => f.label)).size, 4, 'quatre sorts distincts');
  assert.equal(t.epuise, false, 'cinq cases pour quatre personnes : rien n’est epuise');
});

test('plus de monde que de cases : on recommence un tour, et on le dit', () => {
  const { session } = ouvrir({ createurs: 7 });
  const w = roue('Courte', [
    { label: 'A' }, { label: 'B' }, { label: 'C' },
  ]);
  const t = roulette.tirer(session, { wheelId: w.id, target: 'all', shared: false });
  assert.equal(t.fates.length, 7);
  assert.equal(t.epuise, true, 'la page doit pouvoir prevenir plutot que laisser croire a un hasard');
  // Les trois premiers d'un tour sont distincts : on ne repioche pas au hasard.
  assert.equal(new Set(t.fates.slice(0, 3).map((f) => f.label)).size, 3);
});

/* ------------------------------------------------------------------ */
/* Qui est dans la roue                                                */
/* ------------------------------------------------------------------ */

test('l’animateur n’est pas dans la roue : il la tourne', () => {
  const { session } = ouvrir({ createurs: 3 });
  const monde = roulette.eligibles(session);
  assert.equal(monde.length, 3);
  assert.ok(monde.every((p) => !p.isHost));
});

test('les spectateurs sont dehors par defaut : un malus sur eux ne veut rien dire', () => {
  const { session } = ouvrir({ createurs: 3, spectateurs: 2 });
  assert.equal(roulette.eligibles(session).length, 3);
  assert.equal(roulette.eligibles(session, { includeSpectators: true }).length, 5);
});

test('un disqualifie n’est jamais tire', () => {
  const { session, gens } = ouvrir({ createurs: 3 });
  gens.C2.participant.disqualified = 1;
  const monde = roulette.eligibles(session);
  assert.equal(monde.length, 2);
  assert.ok(!monde.some((p) => p.id === gens.C2.participant.id));
});

test('sans personne a tirer, on le dit plutot que de tirer dans le vide', () => {
  const { session } = ouvrir({ createurs: 0, spectateurs: 2 });
  const w = roue('Personne', MALUS);
  refuse(() => roulette.tirer(session, { wheelId: w.id }), 'Personne a tirer');
});

/* ------------------------------------------------------------------ */
/* Ce qui s'applique, et ce qui reste une consigne                     */
/* ------------------------------------------------------------------ */

test('en creation, les points s’appliquent', () => {
  const { session } = ouvrir({ createurs: 3, phase: 'creation' });
  const w = roue('Points', [{ label: 'Moins deux', points: -2 }]);
  const t = roulette.tirer(session, { wheelId: w.id, target: 'one' });
  assert.equal(t.pointsApplicables, true);
  assert.ok(t.fates[0].pointsAppliedAt, 'le sort est marque applique');
  const totaux = repo.appliedPoints(session.id);
  assert.equal(totaux[t.fates[0].participantId], -2);
});

test('au classement, les points ne corrigent plus rien : le sort reste une consigne', () => {
  const { session } = ouvrir({ createurs: 3, phase: 'results' });
  const w = roue('Trop tard', [{ label: 'Moins deux', points: -2 }]);
  const t = roulette.tirer(session, { wheelId: w.id, target: 'one' });
  assert.equal(t.pointsApplicables, false);
  assert.equal(t.fates[0].pointsAppliedAt, null);
  assert.equal(Object.keys(repo.appliedPoints(session.id)).length, 0, 'rien n’entre dans le score');
});

test('chaque effet porte son propre etat : un seul drapeau mentait', () => {
  const { session } = ouvrir({ createurs: 3, phase: 'creation' });

  // Un sort purement chrono, pour la salle entiere : le chrono joue, et il n'y
  // a aucun point a appliquer. Avec un drapeau unique, ce sort arrivait marque
  // « non applique » alors qu'il venait de bouger l'horloge de tout le monde.
  const wChrono = roue('Chrono seul', [{ label: 'Une minute de plus', chronoMs: 60000 }]);
  const chrono = roulette.tirer(session, { wheelId: wChrono.id, target: 'all', shared: true });
  assert.equal(chrono.fates[0].pointsAppliedAt, null, 'aucun point : rien a appliquer');
  assert.ok(chrono.fates[0].chronoAppliedAt, 'mais le chrono a bien joue');

  // Un sort purement de points : l'inverse exactement.
  const wPoints = roue('Points seuls', [{ label: 'Moins trois', points: -3 }]);
  const points = roulette.tirer(session, { wheelId: wPoints.id, target: 'one' });
  assert.ok(points.fates[0].pointsAppliedAt);
  assert.equal(points.fates[0].chronoAppliedAt, null, 'un sort pour une personne ne touche pas l’horloge');

  // Et un sort qui porte les deux, dont un seul peut jouer.
  const wDeux = roue('Les deux', [{ label: 'Moins deux et moins trente', points: -2, chronoMs: -30000 }]);
  const seul = roulette.tirer(session, { wheelId: wDeux.id, target: 'one' });
  assert.ok(seul.fates[0].pointsAppliedAt, 'les points jouent');
  assert.equal(seul.fates[0].chronoAppliedAt, null, 'le chrono non : il est partage');
});

test('les regles du tirage sont envoyees a la regie, pas recopiees par elle', () => {
  const { session } = ouvrir({ createurs: 2 });
  const vue = views.hostView(session);
  assert.ok(Array.isArray(vue.rouletteRules.pointsPhases));
  assert.ok(vue.rouletteRules.pointsPhases.includes('diffusion'), 'les points corrigent jusqu’a la diffusion');
  assert.ok(!vue.rouletteRules.pointsPhases.includes('results'), 'plus apres le devoilement');
  assert.deepEqual(vue.rouletteRules.chronoPhases, ['creation', 'upload']);
  assert.ok(vue.rouletteRules.blindPhases.includes('creation'), 'le vote est encore aveugle pendant la creation');
  assert.ok(!vue.rouletteRules.blindPhases.includes('diffusion'), 'a la diffusion la salle a deja entendu');
  assert.equal(vue.rouletteRules.pointsMax, roulette.POINTS_MAX);
  assert.equal(vue.rouletteRules.chronoMaxMs, roulette.CHRONO_MAX_MS);
});

test('les vues disent ce qui a joue, effet par effet', () => {
  const { session, gens } = ouvrir({ createurs: 3, phase: 'creation' });
  const w = roue('Pour les vues', [{ label: 'Une minute de plus', chronoMs: 60000 }]);
  roulette.tirer(session, { wheelId: w.id, target: 'all', shared: true });

  const commun = views.participantView(session);
  const premier = commun.roulette.last.fates[0];
  assert.equal(premier.chronoApplied, true);
  assert.equal(premier.pointsApplied, false);
  assert.equal('applied' in premier, false, 'l’ancien drapeau unique a disparu');
  assert.equal('seed' in commun.roulette.last, false, 'la graine ne part pas a l’ecran');

  const sien = views.youView(session, gens.C1.participant).fate;
  assert.equal(sien.chronoApplied, true);
  assert.equal(sien.pointsApplied, false);
});

test('la graine reste a la regie, et nulle part ailleurs', () => {
  const { session } = ouvrir({ createurs: 2 });
  const w = roue('Discrete', [{ label: 'Un sort' }]);
  roulette.tirer(session, { wheelId: w.id, target: 'one' });

  assert.ok(views.hostView(session).lastSeed, 'la regie l’a, pour rejouer un tirage conteste');
  for (const [nom, vue] of [
    ['participant', views.participantView(session)],
    ['ecran', views.screenView(session)],
  ]) {
    assert.equal(
      JSON.stringify(vue).includes(views.hostView(session).lastSeed), false,
      `la graine ne traverse pas vers ${nom}`,
    );
  }
});

test('le chrono ne bouge que pour la salle entiere, et pendant qu’il court', () => {
  const collectif = ouvrir({ createurs: 3, phase: 'creation' });
  const w = roue('Chrono', [{ label: 'Une minute de plus', chronoMs: 60000 }]);

  const partage = roulette.tirer(collectif.session, { wheelId: w.id, target: 'all', shared: true });
  assert.equal(partage.chronoApplicable, true);
  assert.equal(partage.chronoMs, 60000);

  // Une seule personne : l'horloge d'Arena est partagee, il n'y a pas de
  // chrono individuel. Le sort reste lisible, il ne s'applique pas.
  const seul = roulette.tirer(collectif.session, { wheelId: w.id, target: 'one' });
  assert.equal(seul.chronoApplicable, false);
  assert.equal(seul.chronoMs, 0);

  const tard = ouvrir({ createurs: 3, phase: 'diffusion' });
  const apres = roulette.tirer(tard.session, { wheelId: w.id, target: 'all', shared: true });
  assert.equal(apres.chronoApplicable, false, 'le chrono ne court plus');
});

/* ------------------------------------------------------------------ */
/* Ce qui ne se reecrit pas                                            */
/* ------------------------------------------------------------------ */

test('les tirages se comptent, et le compte revient', () => {
  const { session } = ouvrir({ createurs: 3 });
  const w = roue('Comptee', MALUS);
  assert.equal(roulette.tirer(session, { wheelId: w.id }).tirages, 1);
  assert.equal(roulette.tirer(session, { wheelId: w.id }).tirages, 2);
  assert.equal(roulette.tirer(session, { wheelId: w.id }).tirages, 3);
});

test('renommer une roue ne reecrit pas un tirage passe', () => {
  const { session } = ouvrir({ createurs: 3 });
  const w = roue('Nom d’origine', [{ label: 'Texte d’origine' }]);
  const t = roulette.tirer(session, { wheelId: w.id, target: 'one' });

  roulette.renommerRoue({ wheelId: w.id, name: 'Nom change' });
  roulette.modifierCase({ slotId: repo.slots(w.id)[0].id, label: 'Texte change' });

  assert.equal(repo.spin(t.spin.id).wheelName, 'Nom d’origine');
  assert.equal(repo.fates(t.spin.id)[0].label, 'Texte d’origine');
});

test('supprimer la roue ne supprime pas ce qui a ete tire', () => {
  const { session } = ouvrir({ createurs: 3 });
  const w = roue('Jetable', [{ label: 'Son sort' }]);
  const t = roulette.tirer(session, { wheelId: w.id, target: 'one' });
  roulette.supprimerRoue({ wheelId: w.id });

  assert.equal(repo.wheel(w.id), null);
  const garde = repo.spin(t.spin.id);
  assert.ok(garde, 'le tirage reste');
  assert.equal(garde.wheelName, 'Jetable');
  assert.equal(repo.fates(t.spin.id)[0].label, 'Son sort');
});

test('un participant parti laisse son sort lisible', () => {
  const { srv, session, gens } = ouvrir({ createurs: 2 });
  const w = roue('Depart', [{ label: 'Son sort a lui' }]);
  const t = roulette.tirer(session, { wheelId: w.id, target: 'all', shared: true });
  const pseudo = t.fates[0].pseudo;

  repo.removeParticipant(t.fates[0].participantId);
  const apres = repo.fates(t.spin.id)[0];
  assert.equal(apres.pseudo, pseudo, 'le pseudo recopie survit');
  assert.equal(apres.participantId, null, 'le lien, lui, se detache');
  void srv; void gens;
});

test('la graine est gardee : le tirage peut etre refait devant temoin', () => {
  const { session } = ouvrir({ createurs: 5 });
  const w = roue('Verifiable', MALUS);
  const t = roulette.tirer(session, { wheelId: w.id, target: 'some', howMany: 2 });

  const garde = repo.spin(t.spin.id);
  assert.ok(garde.seed.length > 0, 'la graine est en base');

  const refait = roulette.tirer(session, { wheelId: w.id, target: 'some', howMany: 2, seed: garde.seed });
  assert.deepEqual(
    refait.fates.map((f) => `${f.pseudo}:${f.label}`),
    repo.fates(t.spin.id).map((f) => `${f.pseudo}:${f.label}`),
    'le meme tirage se rejoue a l’identique',
  );
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
