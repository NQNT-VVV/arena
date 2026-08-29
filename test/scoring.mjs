/**
 * Classement.
 *
 * Les cas verifies ici sont ceux qui font discuter en fin de soiree : le
 * votant qui a saute un passage, le rendu depose hors delai, l'egalite
 * parfaite, et la tentative de fausser le classement en s'abstenant.
 */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { rank } = require('../server/scoring.js');

const CONFIG = {
  criteria: [], defaultVote: 3, scale: 5, latePolicy: 'reject', latePenalty: 1,
};

const sub = (id, participantId, late = false) => ({ id, participantId, late });
const vote = (submission, n, total, criterion = '_') =>
  ({ submission_id: submission, criterion_id: criterion, n, total });

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

test('moyenne simple quand tout le monde a vote', () => {
  const out = rank({
    submissions: [sub('a', 'p1'), sub('b', 'p2')],
    // Trois votants ; chaque rendu est note par les deux autres.
    tally: [vote('a', 2, 9), vote('b', 2, 6)],
    voterIds: ['p1', 'p2', 'p3'],
    config: CONFIG,
  });
  assert.equal(out[0].submissionId, 'a');
  assert.equal(out[0].score, 4.5);
  assert.equal(out[0].rank, 1);
  assert.equal(out[1].score, 3);
  assert.equal(out[1].rank, 2);
});

test('un votant absent compte pour la note par defaut', () => {
  const out = rank({
    submissions: [sub('a', 'p1')],
    // Deux personnes devaient noter, une seule l'a fait, avec un 5.
    tally: [vote('a', 1, 5)],
    voterIds: ['p1', 'p2', 'p3'],
    config: CONFIG,
  });
  // (5 + 3) / 2 = 4, et non 5.
  assert.equal(out[0].score, 4);
  assert.equal(out[0].voters, 1);
  assert.equal(out[0].expected, 2);
});

test('s’abstenir partout ne fait pas gagner', () => {
  // p1 ne note personne, esperant que les autres restent sans note.
  const solo = rank({
    submissions: [sub('a', 'p1'), sub('b', 'p2'), sub('c', 'p3')],
    tally: [
      // Seuls p2 et p3 votent, et ils se donnent 5 mutuellement.
      vote('b', 1, 5), vote('c', 1, 5),
      // Le rendu de p1 recoit 5 de p2 et 5 de p3.
      vote('a', 2, 10),
    ],
    voterIds: ['p1', 'p2', 'p3'],
    config: CONFIG,
  });
  const byId = Object.fromEntries(solo.map((r) => [r.submissionId, r]));
  // b et c n'ont recu qu'un vote reel sur deux attendus : (5 + 3) / 2 = 4.
  assert.equal(byId.b.score, 4);
  assert.equal(byId.c.score, 4);
  // a a bien recu ses deux votes : 10 / 2 = 5. L'abstention de p1 ne lui a
  // rien rapporte de plus, elle a seulement prive les autres d'un vrai vote.
  assert.equal(byId.a.score, 5);
});

test('l’auteur n’est pas compte parmi ceux qui devaient noter', () => {
  const out = rank({
    submissions: [sub('a', 'p1')],
    tally: [],
    voterIds: ['p1'],
    config: CONFIG,
  });
  // Personne d'autre que l'auteur : aucun vote attendu, note par defaut.
  assert.equal(out[0].expected, 0);
  assert.equal(out[0].score, 3);
});

test('multi-criteres : moyenne ponderee', () => {
  const out = rank({
    submissions: [sub('a', 'p1')],
    tally: [vote('a', 2, 10, 'tech'), vote('a', 2, 4, 'idee')],
    voterIds: ['p1', 'p2', 'p3'],
    config: {
      ...CONFIG,
      criteria: [
        { id: 'tech', label: 'Technique', weight: 3 },
        { id: 'idee', label: 'Idee', weight: 1 },
      ],
    },
  });
  // tech = 5, idee = 2 ; (5*3 + 2*1) / 4 = 4.25
  assert.equal(out[0].score, 4.25);
  assert.equal(out[0].criteria.length, 2);
});

test('hors delai : ecarte du classement', () => {
  const out = rank({
    submissions: [sub('a', 'p1'), sub('b', 'p2', true)],
    tally: [vote('a', 2, 6), vote('b', 2, 10)],
    voterIds: ['p1', 'p2', 'p3'],
    config: { ...CONFIG, latePolicy: 'unranked' },
  });
  assert.equal(out[0].submissionId, 'a', 'le rendu dans les temps prend la tete');
  assert.equal(out[0].rank, 1);
  const late = out.find((r) => r.submissionId === 'b');
  assert.equal(late.unranked, true);
  assert.equal(late.score, null);
  assert.equal(late.rank, null);
  assert.equal(late.raw, 5, 'sa moyenne reste calculee, pour information');
});

test('hors delai : penalise mais classe', () => {
  const out = rank({
    submissions: [sub('a', 'p1'), sub('b', 'p2', true)],
    tally: [vote('a', 2, 9), vote('b', 2, 10)],
    voterIds: ['p1', 'p2', 'p3'],
    config: { ...CONFIG, latePolicy: 'penalty', latePenalty: 1 },
  });
  // b avait 5, penalise a 4 ; a garde 4.5 et passe devant.
  assert.equal(out[0].submissionId, 'a');
  assert.equal(out[1].score, 4);
  assert.equal(out[1].penalty, 1);
  assert.equal(out[1].rank, 2);
});

test('egalite : le plus juge passe devant, et l’ordre est stable', () => {
  const args = {
    submissions: [sub('zzz', 'p1'), sub('aaa', 'p2'), sub('mmm', 'p3')],
    tally: [
      vote('zzz', 2, 8),  // (8 + 0) / 2 = 4, deux votes
      vote('aaa', 1, 5),  // (5 + 3) / 2 = 4, un vote
      vote('mmm', 2, 8),  // 4, deux votes
    ],
    voterIds: ['p1', 'p2', 'p3'],
    config: CONFIG,
  };
  const out = rank(args);
  assert.deepEqual(out.map((r) => r.score), [4, 4, 4]);
  assert.equal(out[2].submissionId, 'aaa', 'le moins juge finit dernier');
  // Deux calculs successifs ne doivent pas se contredire.
  assert.deepEqual(rank(args).map((r) => r.submissionId), out.map((r) => r.submissionId));
});

test('aucun vote du tout : tout le monde a la note par defaut', () => {
  const out = rank({
    submissions: [sub('a', 'p1'), sub('b', 'p2')],
    tally: [],
    voterIds: ['p1', 'p2'],
    config: CONFIG,
  });
  assert.deepEqual(out.map((r) => r.score), [3, 3]);
  assert.deepEqual(out.map((r) => r.rank), [1, 2]);
});

for (const [name, fn] of checks) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { console.error(`  FAIL ${name}\n       ${err.message}`); process.exitCode = 1; }
}
console.log(`\n${passed}/${checks.length} verifications passees`);
