/**
 * REBUILD THE TRACK — les trois modules purs.
 *
 *   - L'ANALYSE : tempo et tonalite, eprouves sur des signaux synthetiques
 *     dont on connait la reponse. Une piste de clics a 125 BPM doit sortir a
 *     125, un enchainement i–iv–V–i en do diese mineur doit sortir C#m.
 *   - L'ATTRIBUTION : ses quatre regles, verifiees sur des centaines de
 *     tirages de toutes tailles plutot que sur trois cas choisis.
 *   - LA MOYENNE : une manche sans rendu compte zero, et pourquoi c'est la
 *     regle juste.
 *
 * Aucun serveur, aucune base, aucun fichier.
 */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const analyse = require('../server/analyse.js');
const { attribuer, attribuerUn } = require('../server/attribution.js');
const { classementGeneral } = require('../server/manches.js');

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

/** Hasard rejouable (mulberry32). */
function graine(g) {
  let a = g >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Signaux synthetiques                                                */
/* ------------------------------------------------------------------ */

const SR = analyse.SR;

function clics(bpm, secondes = 30) {
  const x = new Float32Array(SR * secondes);
  const periode = (60 / bpm) * SR;
  const bruit = graine(bpm);
  for (let t = 0; t < x.length; t += periode) {
    const debut = Math.round(t);
    for (let i = 0; i < 400 && debut + i < x.length; i++) x[debut + i] += (bruit() - 0.5) * Math.exp(-i / 60);
  }
  return x;
}

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** Des accords tenus, chacun sur une part egale de la duree, avec une harmonique. */
function accords(suite, secondes = 24) {
  const x = new Float32Array(SR * secondes);
  const duree = Math.floor(x.length / suite.length);
  suite.forEach((notes, k) => {
    for (let i = 0; i < duree; i++) {
      const t = i / SR;
      let v = 0;
      for (const n of notes) v += Math.sin(2 * Math.PI * freq(n) * t) + 0.3 * Math.sin(4 * Math.PI * freq(n) * t);
      x[k * duree + i] = v * 0.1;
    }
  });
  return x;
}

/** i – iv – V – i : la cadence qui installe une tonalite mineure. */
const cadenceMineure = (t) => [[t, t + 3, t + 7], [t + 5, t + 8, t + 12], [t + 7, t + 11, t + 14], [t, t + 3, t + 7]];
/** I – IV – V – I, en majeur. */
const cadenceMajeure = (t) => [[t, t + 4, t + 7], [t + 5, t + 9, t + 12], [t + 7, t + 11, t + 14], [t, t + 4, t + 7]];

/* ------------------------------------------------------------------ */
/* Analyse                                                             */
/* ------------------------------------------------------------------ */

test('le tempo tombe juste, a l\'unite pres, de 80 a 174 BPM', () => {
  for (const bpm of [80, 90, 100, 110, 125, 128, 140, 150, 160, 174]) {
    const lu = analyse.estimerBpm(clics(bpm));
    assert.ok(lu !== null, `${bpm} : rien lu`);
    assert.ok(Math.abs(lu - bpm) <= 0.5, `${bpm} lu ${lu}`);
  }
});

test('l\'exemple de la consigne : 125 s\'affiche 125, pas 124', () => {
  assert.equal(Math.round(analyse.estimerBpm(clics(125))), 125);
});

test('la tonalite est trouvee, en majeur comme en mineur', () => {
  for (const [nom, suite, attendu] of [
    ['C#m', cadenceMineure(61), 'C#m'],
    ['Am', cadenceMineure(57), 'Am'],
    ['F#m', cadenceMineure(66), 'F#m'],
    ['F', cadenceMajeure(65), 'F'],
    ['C', cadenceMajeure(60), 'C'],
    ['A#', cadenceMajeure(58), 'A#'],
  ]) {
    assert.equal(analyse.estimerTonalite(accords(suite))?.code, attendu, nom);
  }
});

test('la tonalite survit a une batterie par-dessus', () => {
  /*
   * La regression qui a fait ajouter la separation harmonique/percussive : un
   * do diese mineur sous une piste de clics sortait mi majeur, sa relative.
   * Tout vrai extrait a une batterie ; un detecteur qui ne marche que sur des
   * accords nus ne sert a rien.
   */
  const avecBatterie = (suite, bpm) => {
    const x = accords(suite);
    const bruit = graine(bpm * 7);
    for (let t = 0; t < x.length; t += (60 / bpm) * SR) {
      const d = Math.round(t);
      for (let i = 0; i < 300 && d + i < x.length; i++) x[d + i] += (bruit() - 0.5) * 0.9 * Math.exp(-i / 45);
    }
    return x;
  };
  for (const bpm of [90, 125, 174]) {
    assert.equal(analyse.estimerTonalite(avecBatterie(cadenceMineure(61), bpm))?.code, 'C#m', `C#m a ${bpm} BPM`);
    assert.equal(analyse.estimerTonalite(avecBatterie(cadenceMajeure(55), bpm))?.code, 'G', `G a ${bpm} BPM`);
  }
});

test('un silence ou un extrait trop court ne dit rien, plutot que de dire faux', () => {
  assert.equal(analyse.estimerBpm(new Float32Array(SR * 20)), null);
  assert.equal(analyse.estimerTonalite(new Float32Array(SR * 20)), null);
  assert.equal(analyse.estimerBpm(clics(125, 3)), null, 'trois secondes ne font pas un tempo');
});

test('une tonalite saisie a la main est lue comme on l\'ecrit', () => {
  const cas = {
    'C# minor': 'C#m', 'c#m': 'C#m', 'C#Minor': 'C#m', 'Db min': 'C#m', 'Db': 'C#',
    'F maj': 'F', 'F': 'F', 'Am': 'Am', 'a mineur': 'Am', 'Bb': 'A#', 'bbm': 'A#m', 'F#M': 'F#',
    'H': null, 'x': null, '': null, 'C##': null,
  };
  for (const [brut, attendu] of Object.entries(cas)) assert.equal(analyse.lireTonalite(brut), attendu, JSON.stringify(brut));
  assert.equal(analyse.nomTonalite('C#m'), 'C# minor');
  assert.equal(analyse.nomTonalite('F'), 'F major');
});

test('la FFT retrouve une sinusoide sur sa case', () => {
  const n = 1024;
  const re = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 37 * i) / n));
  const im = new Float64Array(n);
  analyse.fft(re, im);
  const mags = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
  assert.equal(mags.indexOf(Math.max(...mags)), 37);
});

/* ------------------------------------------------------------------ */
/* Attribution                                                         */
/* ------------------------------------------------------------------ */

const ids = (prefixe, n) => Array.from({ length: n }, (_, i) => `${prefixe}${i + 1}`);

test('regle 1 : chacun recoit exactement un extrait, quelles que soient les tailles', () => {
  for (let e = 1; e <= 12; e++) {
    for (let p = 1; p <= 15; p++) {
      const out = attribuer({ extraits: ids('e', e), participants: ids('p', p), alea: graine(e * 100 + p) });
      assert.equal(out.size, p, `${e} extraits, ${p} participants`);
      for (const ex of out.values()) assert.ok(ex.startsWith('e'));
    }
  }
});

test('regle 2 : extraits tous differents des qu\'il y en a assez, sinon repartis a un pres', () => {
  for (let e = 1; e <= 12; e++) {
    for (let p = 1; p <= 15; p++) {
      const out = attribuer({ extraits: ids('e', e), participants: ids('p', p), alea: graine(e * 31 + p) });
      const usage = new Map();
      for (const ex of out.values()) usage.set(ex, (usage.get(ex) ?? 0) + 1);
      if (e >= p) assert.equal(usage.size, p, `${e} >= ${p} : un extrait sert deux fois`);
      const n = [...ids('e', e)].map((x) => usage.get(x) ?? 0);
      if (p >= e) assert.ok(Math.max(...n) - Math.min(...n) <= 1, `${e} extraits, ${p} participants : ${n}`);
    }
  }
});

test('regle 3 : personne ne retombe sur un extrait deja reconstruit, quand c\'est evitable', () => {
  for (let s = 0; s < 200; s++) {
    const alea = graine(s);
    const extraits = ids('e', 6);
    const participants = ids('p', 4);
    const m1 = attribuer({ extraits, participants, alea });
    const historique = [...m1].map(([participantId, extraitId]) => ({ participantId, extraitId }));
    const m2 = attribuer({ extraits, participants, historique, alea });
    for (const [p, e] of m2) assert.notEqual(e, m1.get(p), `tirage ${s} : ${p} retombe sur ${e}`);
  }
});

test('regle 4 : les extraits jamais joues passent avant les autres', () => {
  for (let s = 0; s < 200; s++) {
    const alea = graine(1000 + s);
    const extraits = ids('e', 8);
    const participants = ids('p', 4);
    const m1 = attribuer({ extraits, participants, alea });
    const historique = [...m1].map(([participantId, extraitId]) => ({ participantId, extraitId }));
    const m2 = attribuer({ extraits, participants, historique, alea });
    const dejaJoues = new Set(m1.values());
    for (const e of m2.values()) assert.equal(dejaJoues.has(e), false, `tirage ${s} : ${e} ressert alors que quatre neufs attendent`);
  }
});

test('l\'unicite passe avant l\'historique : un deja-eu plutot qu\'un doublon', () => {
  // Deux extraits, deux joueurs, et tous deux ont deja eu e1. Eviter
  // l'historique obligerait a donner e2 aux deux.
  const historique = [{ participantId: 'p1', extraitId: 'e1' }, { participantId: 'p2', extraitId: 'e1' }];
  for (let s = 0; s < 50; s++) {
    const out = attribuer({ extraits: ['e1', 'e2'], participants: ['p1', 'p2'], historique, alea: graine(s) });
    assert.deepEqual([...out.values()].sort(), ['e1', 'e2'], `tirage ${s}`);
  }
});

test('le tirage se rejoue : meme hasard, meme attribution', () => {
  const a = attribuer({ extraits: ids('e', 7), participants: ids('p', 5), alea: graine(42) });
  const b = attribuer({ extraits: ids('e', 7), participants: ids('p', 5), alea: graine(42) });
  assert.deepEqual([...a], [...b]);
});

test('sans extrait, personne ne recoit rien — et ce n\'est pas une erreur', () => {
  assert.equal(attribuer({ extraits: [], participants: ['p1'] }).size, 0);
  assert.equal(attribuerUn({ extraits: [], participantId: 'p1' }), null);
});

test('un retardataire recoit le moins distribue, et pas ce qu\'il a deja eu', () => {
  const manche = [{ participantId: 'p1', extraitId: 'e1' }, { participantId: 'p2', extraitId: 'e2' }];
  for (let s = 0; s < 30; s++) {
    assert.equal(attribuerUn({ extraits: ['e1', 'e2', 'e3'], participantId: 'p3', manche, alea: graine(s) }), 'e3');
  }
  const historique = [{ participantId: 'p3', extraitId: 'e3' }];
  for (let s = 0; s < 30; s++) {
    const e = attribuerUn({ extraits: ['e1', 'e2', 'e3'], participantId: 'p3', manche, historique, alea: graine(s) });
    assert.notEqual(e, 'e3', 'le retardataire retombe sur un extrait deja reconstruit');
  }
});

/* ------------------------------------------------------------------ */
/* La moyenne                                                          */
/* ------------------------------------------------------------------ */

const joueurs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

test('la moyenne porte sur toutes les manches, une absence compte zero', () => {
  const g = classementGeneral({
    participants: joueurs,
    manches: [
      { round: 1, rows: [{ participantId: 'a', score: 4 }, { participantId: 'b', score: 3 }] },
      { round: 2, rows: [{ participantId: 'a', score: 2 }, { participantId: 'b', score: 3 }, { participantId: 'c', score: 5 }] },
    ],
  });
  const de = (id) => g.find((l) => l.participantId === id);
  assert.equal(de('a').moyenne, 3);
  assert.equal(de('b').moyenne, 3);
  assert.equal(de('c').moyenne, 2.5, 'ne jouer que sa meilleure manche ne doit pas suffire');
  assert.deepEqual(de('c').scores, [null, 5]);
  assert.equal(de('c').joues, 1);
});

test('les ex aequo partagent leur place, et l\'assiduite departage l\'ordre d\'affichage', () => {
  const g = classementGeneral({
    participants: joueurs,
    manches: [
      { round: 1, rows: [{ participantId: 'a', score: 4 }, { participantId: 'b', score: 4 }, { participantId: 'c', score: 1 }] },
    ],
  });
  assert.deepEqual(g.map((l) => [l.participantId, l.rank]).sort(), [['a', 1], ['b', 1], ['c', 3]]);
});

test('un rendu hors classement compte zero ; un joueur qui n\'a jamais rendu n\'apparait pas', () => {
  const g = classementGeneral({
    participants: joueurs,
    manches: [{ round: 1, rows: [{ participantId: 'a', score: null }, { participantId: 'b', score: 2 }] }],
  });
  assert.equal(g.find((l) => l.participantId === 'a').moyenne, 0);
  assert.equal(g.some((l) => l.participantId === 'd'), false);
});

test('un participant disqualifie ou parti n\'est pas classe', () => {
  const g = classementGeneral({
    participants: [{ id: 'a' }],
    manches: [{ round: 1, rows: [{ participantId: 'a', score: 1 }, { participantId: 'z', score: 5 }] }],
  });
  assert.deepEqual(g.map((l) => l.participantId), ['a']);
});

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
