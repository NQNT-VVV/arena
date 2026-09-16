/**
 * LA REVELATION — la choregraphie, verifiee sans navigateur.
 *
 * `lib/reveal.ts` est une fonction pure : meme tirage, meme liste d'images, aux
 * memes millisecondes. C'est tout l'interet de l'avoir sortie du composant —
 * la mise en scene devient une valeur qu'on peut inspecter, au lieu d'un effet
 * de bord qu'il faut regarder tourner.
 *
 * Quatre proprietes portent cette suite, et ce sont les quatre par lesquelles
 * la revelation precedente mentait ou ratait son sujet :
 *
 *   - LE MOT NE COURT QUE SUR UNE VARIABLE QUE LE SERVEUR A TIREE. Aucune image
 *     de marqueur sur un champ ou rien n'a ete choisi, jamais.
 *   - LA DUREE EST CONSTANTE POUR UN CHAMP DONNE, et bornee. Elle ne depend pas
 *     de qui sort, et aucun mode ne depasse le plafond.
 *   - AUCUN PALIER SOUS LE PLANCHER DE NETTETE. En dessous, l'encodeur rend du
 *     gris et la salle ne lit rien.
 *   - CHAQUE IMAGE PORTE UN MOT. N'importe quelle image isolee du flux doit
 *     etre lisible par quelqu'un qui vient de decrocher.
 *
 * Le module est en TypeScript et le depot est en CommonJS : Node sait retirer
 * les types, il lui manque seulement de savoir que `./hex` designe `./hex.ts`.
 * Les deux crochets ci-dessous ne font que cela.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    const nu = specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier) ? `${specifier}.ts` : specifier;
    return next(nu, context);
  },
  load(url, context, next) {
    if (!url.endsWith('.ts')) return next(url, context);
    return {
      format: 'module',
      shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8')),
    };
  },
});

const {
  departPour, ligneFinale, paliers, planDeTirage, revelation, tailleDe, tenueLecture,
} = await import('../lib/reveal.ts');

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);

/* ------------------------------------------------------------------ */
/* Outillage                                                           */
/* ------------------------------------------------------------------ */

const SALLE = ['KAOLIN', 'MAVERICK', 'SOUS-SOL', 'NEUF', 'BRUME', 'TALON', 'ORVET', 'CALQUE'];

const CASES = [
  { label: 'Sans kick ni snare', weight: 3 },
  { label: 'Mono seulement', weight: 1 },
  { label: 'Rien du tout', weight: 5 },
  { label: 'Une minute de plus', weight: 1 },
  { label: 'Une voix, meme une syllabe', weight: 2 },
  { label: 'Deux points de bonus', weight: 1 },
  { label: 'Pas de reverb', weight: 4 },
  { label: 'Trente secondes de moins', weight: 1 },
  { label: 'Le double de temps', weight: 1 },
  { label: 'Un seul instrument', weight: 2 },
  { label: 'Tempo impose', weight: 1 },
  { label: 'Fin abrupte', weight: 3 },
];

/**
 * Un tirage plausible.
 *
 * `qui` donne les index de vivier touches, `quoi` les index de case en face :
 * le test decrit donc exactement ce que le serveur a tire, index par index,
 * comme la charge le fait.
 */
function tirage({
  pool = SALLE, slots = CASES, target = 'one', shared = false, spent = false,
  qui = [0], quoi = [0], effets = null,
} = {}) {
  return {
    id: 'spin-test', wheelName: 'Malus de soiree', target, howMany: qui.length,
    shared, phase: 'creation', at: 0, pool, slots, spent,
    fates: qui.map((p, i) => ({
      participantId: `p${p}`,
      pseudo: pool[p] ?? `ABSENT${p}`,
      label: slots[quoi[i]]?.label ?? 'Sort d’avant le champ',
      detail: '',
      points: effets ? (effets[i]?.points ?? 0) : 0,
      chronoMs: effets ? (effets[i]?.chronoMs ?? 0) : 0,
      pointsApplied: false,
      chronoApplied: false,
      poolIndex: p,
      slotIndex: quoi[i],
      position: i,
    })),
  };
}

/** Les durees reelles de chaque image, deduites des horodatages. */
function durees(r) {
  return r.at.map((t, i) => (i + 1 < r.at.length ? r.at[i + 1] : r.totalMs) - t);
}

const avecMarqueur = (r, champ) => r.frames.filter((f) => f.champ === champ && f.marque !== null);

/* ------------------------------------------------------------------ */
/* L'invariant : le mot ne court que sur ce qui a ete tire             */
/* ------------------------------------------------------------------ */

test('mode A — une personne, un sort : les deux inconnues courent, le nom d’abord', () => {
  const r = revelation(tirage({ target: 'one', qui: [2], quoi: [7] }));
  const sujets = avecMarqueur(r, 'tableau');
  const cases = avecMarqueur(r, 'reglette');

  assert.equal(sujets.length, 7, 'la passe sur les sujets');
  assert.equal(cases.length, 9, 'la passe longue sur les cases');
  assert.ok(r.at[r.frames.indexOf(sujets[0])] < r.at[r.frames.indexOf(cases[0])], 'le nom avant le sort');
  assert.equal(sujets[sujets.length - 1].marque, 2, 'la derniere image du marqueur EST l’arrivee');
  assert.equal(cases[cases.length - 1].marque, 7);
  assert.equal(r.totalMs, 7860);
});

test('mode B — plusieurs, un chacun : une passe a k arrets, puis la donne', () => {
  const r = revelation(tirage({ target: 'some', qui: [1, 4, 6], quoi: [0, 3, 9] }));
  assert.equal(avecMarqueur(r, 'reglette').length, 0, 'la donne n’a pas de marqueur : elle depose');
  assert.ok(avecMarqueur(r, 'tableau').length >= 9, 'trois arrets de trois paliers rapides, au moins');

  // Le groupe se constitue : chaque arret laisse une plaque de plus inversee.
  const tirees = r.frames.map((f) => f.plaques.filter((p) => p === 'tiree').length);
  assert.deepEqual([...new Set(tirees)].sort(), [0, 1, 2, 3]);
  assert.equal(r.totalMs, 7030);
});

test('mode C — tout le monde, un chacun : ZERO image de marqueur sur les sujets', () => {
  const r = revelation(tirage({ target: 'all', qui: [0, 1, 2, 3, 4, 5, 6, 7], quoi: [0, 1, 2, 3, 4, 5, 6, 7] }));
  assert.equal(avecMarqueur(r, 'tableau').length, 0, 'personne n’a ete tire : on l’enonce, on ne le mime pas');
  assert.equal(avecMarqueur(r, 'reglette').length, 0, 'la donne depose, elle ne court pas');

  // Le champ s'allume ENTIER, en une seule coupe, des la deuxieme image.
  assert.deepEqual(r.frames[1].plaques, Array(8).fill('tiree'));
  assert.equal(r.totalMs, 5740);
});

test('mode D — tout le monde, le meme sort : toute la ceremonie sur les cases', () => {
  const r = revelation(tirage({ target: 'all', shared: true, qui: [0, 1, 2, 3, 4, 5, 6, 7], quoi: Array(8).fill(4) }));
  assert.equal(avecMarqueur(r, 'tableau').length, 0);
  assert.equal(avecMarqueur(r, 'reglette').length, 11, 'la passe solennelle, la plus longue des cinq');

  // Le dernier palier du mode est aussi le plus long de toute la fonctionnalite.
  const d = durees(r);
  assert.equal(Math.max(...d.slice(0, -1)), 820);
  assert.equal(r.totalMs, 6980);
});

test('mode E — plusieurs, le meme sort : derive sans branche speciale', () => {
  const r = revelation(tirage({ target: 'some', shared: true, qui: [0, 3, 5], quoi: [2, 2, 2] }));
  assert.ok(avecMarqueur(r, 'tableau').length > 0, 'le QUI a bien ete tire');
  assert.equal(avecMarqueur(r, 'reglette').length, 9, 'une seule passe sur les cases, pas trois');
  assert.equal(r.totalMs, 8900);
});

test('le cinquieme mode degenere proprement quand k vaut l’effectif', () => {
  const tous = tirage({ pool: SALLE.slice(0, 3), target: 'some', qui: [0, 1, 2], quoi: [0, 1, 2] });
  assert.equal(planDeTirage(tous).qui.geste, 'pose', 'viser tout le monde n’est pas tirer');
  assert.equal(avecMarqueur(revelation(tous), 'tableau').length, 0);
});

test('un seul sujet : le marqueur ne court jamais sur un champ de un', () => {
  const r = revelation(tirage({ pool: ['SEUL'], target: 'one', qui: [0], quoi: [5] }));
  assert.equal(avecMarqueur(r, 'tableau').length, 0);
  assert.ok(avecMarqueur(r, 'reglette').length > 0, 'le suspense se reporte sur la seule inconnue reelle');
  // Et la salle sait POURQUOI rien ne tourne, sinon elle croit a une panne.
  assert.ok(r.frames[1].pied.includes('AUCUN CHOIX'));
});

test('une seule case jouable : rien ne tourne, et c’est juste', () => {
  const r = revelation(tirage({
    pool: ['SEUL'], slots: [{ label: 'Le seul sort', weight: 1 }],
    target: 'all', shared: true, qui: [0], quoi: [0],
  }));
  assert.equal(avecMarqueur(r, 'tableau').length, 0);
  assert.equal(avecMarqueur(r, 'reglette').length, 0);
  assert.equal(r.totalMs, 3180, 'deux coupes et une tenue');
});

/* ------------------------------------------------------------------ */
/* La cadence                                                          */
/* ------------------------------------------------------------------ */

test('aucun palier sous le plancher de nettete, hors le flash du socle', () => {
  const modes = [
    tirage({ target: 'one', qui: [3], quoi: [1] }),
    tirage({ target: 'some', qui: [1, 4, 6], quoi: [0, 3, 9] }),
    tirage({ target: 'all', qui: [0, 1, 2, 3, 4, 5, 6, 7], quoi: [0, 1, 2, 3, 4, 5, 6, 7] }),
    tirage({ target: 'all', shared: true, qui: [0, 1, 2, 3, 4, 5, 6, 7], quoi: Array(8).fill(4) }),
    tirage({ target: 'some', shared: true, qui: [0, 3, 5], quoi: [2, 2, 2] }),
  ];
  for (const s of modes) {
    for (const d of durees(revelation(s))) {
      assert.ok(d >= 150 || d === 80, `palier de ${d} ms : sous le plancher, l’encodeur rend du gris`);
    }
  }
});

test('la rampe decelere, et ne re-accelere jamais', () => {
  for (const kind of ['passe', 'passe_longue', 'passe_solennelle']) {
    const p = paliers(kind);
    for (let i = 1; i < p.length; i++) assert.ok(p[i] >= p[i - 1], `${kind} re-accelere au palier ${i}`);
    assert.ok(p[p.length - 1] >= 540, 'le dernier palier est une image qu’on garde');
  }
  assert.equal(paliers('passe').reduce((a, b) => a + b), 1950);
  assert.equal(paliers('passe_longue').reduce((a, b) => a + b), 2830);
  assert.equal(paliers('passe_solennelle').reduce((a, b) => a + b), 3800);
});

test('la duree ne depend pas de QUI sort : l’animateur sait combien ca prend', () => {
  const durees = new Set();
  for (let p = 0; p < SALLE.length; p++) {
    for (let c = 0; c < CASES.length; c++) {
      durees.add(revelation(tirage({ target: 'one', qui: [p], quoi: [c] })).totalMs);
    }
  }
  assert.deepEqual([...durees], [7860], 'la meme duree pour les 96 arrivees possibles');
});

test('le depart se deduit de l’arrivee, et le marqueur y tombe', () => {
  for (const n of [2, 3, 5, 8, 12]) {
    for (const nb of [4, 7, 9, 11]) {
      for (let cible = 0; cible < n; cible++) {
        const depart = departPour(cible, n, nb);
        assert.ok(depart >= 0 && depart < n, 'le depart est dans le champ');
        assert.equal((depart + nb - 1) % n, cible, 'le dernier palier EST l’arrivee');
      }
    }
  }
});

test('le plafond tient, meme sur une grande salle et beaucoup de vises', () => {
  const grande = Array.from({ length: 16 }, (_, i) => `SUJET${i}`);
  const r = revelation(tirage({
    pool: grande, target: 'all',
    qui: grande.map((_, i) => i),
    quoi: grande.map((_, i) => i % CASES.length),
  }));
  assert.ok(r.totalMs <= 9000, `${r.totalMs} ms : la salle attend`);
  // La donne reste bornee : la duree du mode est quasi independante de l'effectif.
  const petit = revelation(tirage({ target: 'all', qui: [0, 1, 2, 3, 4, 5, 6, 7], quoi: [0, 1, 2, 3, 4, 5, 6, 7] }));
  assert.ok(Math.abs(r.totalMs - petit.totalMs) < 400, 'huit ou seize, la salle attend pareil');
});

test('les horodatages sont croissants et partent de zero', () => {
  const r = revelation(tirage({ target: 'some', qui: [1, 4, 6], quoi: [0, 3, 9] }));
  assert.equal(r.frames.length, r.at.length);
  assert.equal(r.at[0], 0);
  for (let i = 1; i < r.at.length; i++) assert.ok(r.at[i] > r.at[i - 1]);
  assert.ok(r.at[r.at.length - 1] < r.totalMs);
});

/* ------------------------------------------------------------------ */
/* Ce que la salle lit                                                 */
/* ------------------------------------------------------------------ */

test('chaque image porte un mot : personne ne reconstitue rien', () => {
  const modes = [
    tirage({ target: 'one', qui: [3], quoi: [1] }),
    tirage({ target: 'all', qui: [0, 1, 2, 3, 4, 5, 6, 7], quoi: [0, 1, 2, 3, 4, 5, 6, 7] }),
    tirage({ target: 'all', shared: true, qui: [0, 1, 2], quoi: [4, 4, 4] }),
  ];
  for (const s of modes) {
    for (const f of revelation(s).frames) {
      assert.ok(f.texte.length > 0, 'une image muette est une image perdue');
      assert.ok(f.sur.length > 0);
      assert.ok(f.pied.length > 0);
      assert.ok(['s1', 's2', 's3'].includes(f.taille));
    }
  }
});

test('un seul element marque a la fois, et jamais deux champs en meme temps', () => {
  const r = revelation(tirage({ target: 'one', qui: [6], quoi: [10] }));
  for (const f of r.frames) {
    assert.ok(f.plaques.filter((p) => p === 'marque').length <= 1);
    assert.ok(f.crans.filter((c) => c === 'marque').length <= 1);
    const vivants = (f.plaques.includes('marque') ? 1 : 0) + (f.crans.includes('marque') ? 1 : 0);
    assert.ok(vivants <= 1, 'le sang ne dit qu’une chose a la fois');
  }
});

test('la donne rend visible la regle sans remise, et l’epuisement avec', () => {
  const courte = [{ label: 'A', weight: 1 }, { label: 'B', weight: 1 }, { label: 'C', weight: 1 }];
  const r = revelation(tirage({
    pool: SALLE.slice(0, 5), slots: courte, target: 'all',
    qui: [0, 1, 2, 3, 4], quoi: [0, 1, 2, 0, 1],
  }));

  // Les cases consommees s'eteignent, une par depot.
  const usees = r.frames.map((f) => f.crans.filter((c) => c === 'usee').length);
  assert.ok(Math.max(...usees) >= 2);
  // Puis la roue refait un tour, et TOUT se rallume dans la meme image.
  const tour = r.frames.findIndex((f) => f.pied.includes('LA ROUE A REFAIT UN TOUR'));
  assert.ok(tour > 0, 'le pied annonce le tour');
  assert.equal(r.frames[tour].crans.filter((c) => c === 'usee').length, 0, 'les crans se rallument d’un coup');
});

test('au-dela de douze sujets, la plaque porte une puce et non un libelle', () => {
  const grande = Array.from({ length: 14 }, (_, i) => `SUJET${i}`);
  const r = revelation(tirage({
    pool: grande, target: 'all',
    qui: grande.map((_, i) => i),
    quoi: grande.map((_, i) => i % CASES.length),
    effets: grande.map((_, i) => ({ points: i === 0 ? -2 : 0 })),
  }));
  const fin = r.frames[r.frames.length - 1];
  assert.equal(fin.sorts[0], '−2', 'la puce d’effet, lisible a 480p');
  assert.equal(fin.sorts[1], '·', 'et un signe quand il n’y a pas d’effet');
});

test('la ligne finale ne sacre jamais au hasard en pretendant classer', () => {
  const pese = tirage({
    target: 'all', qui: [0, 1, 2], quoi: [0, 1, 2],
    effets: [{ points: -1 }, { points: -3 }, { chronoMs: -30000 }],
  });
  assert.equal(ligneFinale(pese).sur, 'LE PLUS LOURD');
  assert.ok(ligneFinale(pese).texte.startsWith('MAVERICK'), 'celui qui prend −3');

  const exaequo = tirage({
    target: 'all', qui: [0, 1], quoi: [0, 1],
    effets: [{ points: -2 }, { points: -2 }],
  });
  assert.equal(ligneFinale(exaequo).sur, 'PARMI LES PLUS LOURDS');

  const consignes = tirage({ target: 'all', qui: [0, 1, 2], quoi: [0, 1, 2] });
  assert.ok(ligneFinale(consignes).sur.includes('AUCUN EFFET MECANIQUE'));
  assert.equal(ligneFinale(consignes).vedette, null, 'aucune puce a poser : rien ne s’est applique');
});

test('le mot se met en boite sans mesurer : l’echelle est discrete', () => {
  assert.equal(tailleDe('KAOLIN'), 's1');
  assert.equal(tailleDe('Sans kick ni snare'), 's2');
  assert.equal(tailleDe('x'.repeat(97)), 's3');
  assert.equal(tenueLecture(20), 2000);
  assert.equal(tenueLecture(120), 2800);
  assert.equal(tenueLecture(400), 3200, 'plafonnee');
});

/* ------------------------------------------------------------------ */
/* Les cas limites                                                     */
/* ------------------------------------------------------------------ */

test('mouvement reduit : la reponse, tenue plus longtemps, jamais moins', () => {
  const s = tirage({ target: 'one', qui: [2], quoi: [7] });
  const plein = revelation(s, false);
  const calme = revelation(s, true);

  assert.equal(avecMarqueur(calme, 'tableau').length, 0);
  assert.equal(avecMarqueur(calme, 'reglette').length, 0);
  assert.ok(calme.totalMs < plein.totalMs, 'la revelation se comprime');
  // Mais la tenue de lecture, elle, s'allonge : on ne donne pas MOINS de temps
  // a qui en demande plus de calme.
  const tenue = (r) => r.totalMs - r.at[r.at.length - 1];
  assert.ok(tenue(calme) > tenue(plein) + 1000);
  // Et la reponse est la, entiere.
  assert.equal(calme.frames[calme.frames.length - 1].plaques.filter((p) => p === 'tiree').length, 1);
});

test('un tirage d’avant le champ s’affiche pose, et se tait sur ce qu’il ignore', () => {
  const ancien = {
    ...tirage({ target: 'one', qui: [3], quoi: [2] }),
    pool: [], slots: [],
  };
  ancien.fates[0].poolIndex = -1;
  ancien.fates[0].slotIndex = -1;

  const r = revelation(ancien);
  assert.equal(avecMarqueur(r, 'tableau').length, 0);
  assert.equal(avecMarqueur(r, 'reglette').length, 0);
  assert.deepEqual(r.frames[0].crans, [], 'aucune reglette : on ne dessine pas une roue qu’on ignore');
  assert.ok(r.frames[0].pied.includes('TIRAGE ANTERIEUR'));
  // Le tableau se replie sur la bande des pseudos tires : ce qu'on sait encore.
  assert.equal(r.frames[r.frames.length - 1].plaques.length, 1);
});

test('la roue qui a refait un tour est annoncee des la pose', () => {
  const r = revelation(tirage({ spent: true, target: 'one', qui: [0], quoi: [0] }));
  assert.ok(r.frames[0].texte.includes('REFAIT UN TOUR'));
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
