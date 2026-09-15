'use strict';

/**
 * LA ROULETTE — un sort tire au hasard, et devant temoin.
 *
 * Arena impose des contraintes : c'est sa premisse. La roulette ne fait que la
 * rendre visible — au lieu que l'animateur decide, on tire.
 *
 * Trois choses la tiennent, et chacune repond a une facon de perdre la
 * confiance de la salle :
 *
 *   - LA GRAINE EST GARDEE. Un tirage qu'on ne peut pas rejouer est un tirage
 *     qu'on ne peut pas defendre. La meme graine et la meme liste rendent le
 *     meme sort, donc la salle peut demander a verifier.
 *   - LES TIRAGES SE COMPTENT. Si l'animateur peut relancer en secret jusqu'a
 *     obtenir ce qui lui plait, la roue n'a plus aucune autorite. On ne
 *     l'empeche pas de relancer — parfois il faut — mais le compte s'affiche.
 *   - CE QUI EST TIRE EST RECOPIE. Une roue renommee, un sort corrige, un
 *     participant parti : rien n'a le droit de reecrire ce qui s'est passe.
 *
 * Ce module est pur de toute socket : il lit la base, il ecrit la base, il rend
 * des objets. C'est `battle.js` qui diffuse.
 */

const repo = require('./repo');
const { uuid, cleanPseudo, cleanText, clamp } = require('./util');

class RouletteError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'RouletteError';
    this.expected = true;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Le hasard, mais rejouable                                           */
/* ------------------------------------------------------------------ */

/**
 * Un generateur a graine, plutot que `Math.random`.
 *
 * `Math.random` ne se rejoue pas : un tirage conteste ne pourrait pas etre
 * refait devant la personne qui le contexte. Avec une graine gardee en base,
 * n'importe qui remonte le meme resultat, et la roue devient verifiable au
 * lieu d'etre crue.
 *
 * Mulberry32 : trente-deux bits, une ligne, statistiquement suffisant pour
 * choisir parmi huit cases. Ce n'est pas de la cryptographie et ca n'a pas a
 * l'etre — personne ne gagne d'argent ici.
 */
function generateur(graine) {
  let a = 0;
  for (let i = 0; i < graine.length; i++) {
    a = (a + graine.charCodeAt(i) * (i + 1) * 2654435761) >>> 0;
  }
  return function suivant() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Melange de Fisher-Yates, pilote par le generateur a graine. */
function melanger(liste, tirer) {
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(tirer() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

/**
 * Une case, tiree au poids.
 *
 * Un poids a zero retire la case du tirage sans effacer son texte : on prepare
 * une roue en plusieurs fois, et on n'aime pas perdre une formule trouvee la
 * semaine derniere.
 */
function tirerCase(cases, tirer) {
  const jouables = cases.filter((c) => c.weight > 0);
  if (!jouables.length) return null;
  const total = jouables.reduce((somme, c) => somme + c.weight, 0);
  let seuil = tirer() * total;
  for (const c of jouables) {
    seuil -= c.weight;
    if (seuil < 0) return c;
  }
  return jouables[jouables.length - 1];
}

/* ------------------------------------------------------------------ */
/* Les roues                                                           */
/* ------------------------------------------------------------------ */

const LONGUEUR_NOM = 60;
const LONGUEUR_LIBELLE = 120;
const LONGUEUR_DETAIL = 280;
/** Bornes d'un effet. Larges, mais finies : une faute de frappe ne doit pas
 *  retirer mille points a quelqu'un. */
const POINTS_MAX = 20;
const CHRONO_MAX_MS = 15 * 60000;

function exigerRoue(wheelId) {
  const roue = repo.wheel(wheelId);
  if (!roue) throw new RouletteError('Cette roue n’existe plus.', 404);
  return roue;
}

function creerRoue({ name, note = '' } = {}) {
  const propre = cleanPseudo(name, LONGUEUR_NOM);
  if (!propre) throw new RouletteError('Donnez un nom a cette roue.');
  const now = Date.now();
  return repo.addWheel({
    id: uuid(), name: propre, note: cleanText(note, LONGUEUR_DETAIL), createdAt: now, updatedAt: now,
  });
}

function renommerRoue({ wheelId, name, note } = {}) {
  const roue = exigerRoue(wheelId);
  const propre = name === undefined ? roue.name : cleanPseudo(name, LONGUEUR_NOM);
  if (!propre) throw new RouletteError('Donnez un nom a cette roue.');
  repo.updateWheel(
    roue.id,
    propre,
    note === undefined ? roue.note : cleanText(note, LONGUEUR_DETAIL),
    Date.now(),
  );
  return repo.wheel(roue.id);
}

function supprimerRoue({ wheelId } = {}) {
  const roue = exigerRoue(wheelId);
  // Les tirages deja faits ne partent pas avec elle : ils ont recopie ce qu'il
  // leur fallait, et l'histoire d'une session ne se reecrit pas.
  repo.removeWheel(roue.id);
  return { id: roue.id };
}

/** Normalise un effet : bornes, et zero quand il n'y a rien. */
function effetPropre(brut = {}) {
  const points = clamp(Math.trunc(Number(brut.points) || 0), -POINTS_MAX, POINTS_MAX);
  const chronoMs = clamp(Math.trunc(Number(brut.chronoMs) || 0), -CHRONO_MAX_MS, CHRONO_MAX_MS);
  return { points, chronoMs };
}

function ajouterCase({ wheelId, label, detail = '', weight = 1, points = 0, chronoMs = 0 } = {}) {
  const roue = exigerRoue(wheelId);
  const propre = cleanText(label, LONGUEUR_LIBELLE);
  if (!propre) throw new RouletteError('Une case sans texte ne dit rien.');
  const cases = repo.slots(roue.id);
  const effet = effetPropre({ points, chronoMs });
  const ajoutee = repo.addSlot({
    id: uuid(),
    wheelId: roue.id,
    label: propre,
    detail: cleanText(detail, LONGUEUR_DETAIL),
    weight: clamp(Math.trunc(Number(weight) || 0), 0, 99),
    ...effet,
    position: cases.length,
  });
  repo.touchWheel(roue.id, Date.now());
  return ajoutee;
}

function modifierCase({ slotId, label, detail, weight, points, chronoMs } = {}) {
  const ancienne = repo.slot(slotId);
  if (!ancienne) throw new RouletteError('Cette case n’existe plus.', 404);
  const propre = label === undefined ? ancienne.label : cleanText(label, LONGUEUR_LIBELLE);
  if (!propre) throw new RouletteError('Une case sans texte ne dit rien.');
  const effet = effetPropre({
    points: points === undefined ? ancienne.points : points,
    chronoMs: chronoMs === undefined ? ancienne.chronoMs : chronoMs,
  });
  repo.updateSlot({
    id: ancienne.id,
    label: propre,
    detail: detail === undefined ? ancienne.detail : cleanText(detail, LONGUEUR_DETAIL),
    weight: weight === undefined ? ancienne.weight : clamp(Math.trunc(Number(weight) || 0), 0, 99),
    ...effet,
  });
  repo.touchWheel(ancienne.wheelId, Date.now());
  return repo.slot(ancienne.id);
}

function retirerCase({ slotId } = {}) {
  const ancienne = repo.slot(slotId);
  if (!ancienne) throw new RouletteError('Cette case n’existe plus.', 404);
  repo.removeSlot(ancienne.id);
  // Les positions se resserrent : un trou dans la numerotation finirait par
  // decaler un deplacement.
  repo.slots(ancienne.wheelId).forEach((c, i) => repo.moveSlot(c.id, i));
  repo.touchWheel(ancienne.wheelId, Date.now());
  return { id: ancienne.id, wheelId: ancienne.wheelId };
}

function deplacerCase({ slotId, vers } = {}) {
  const ancienne = repo.slot(slotId);
  if (!ancienne) throw new RouletteError('Cette case n’existe plus.', 404);
  const cases = repo.slots(ancienne.wheelId);
  const depuis = cases.findIndex((c) => c.id === ancienne.id);
  const cible = clamp(Math.trunc(Number(vers) || 0), 0, cases.length - 1);
  const [deplacee] = cases.splice(depuis, 1);
  cases.splice(cible, 0, deplacee);
  cases.forEach((c, i) => repo.moveSlot(c.id, i));
  repo.touchWheel(ancienne.wheelId, Date.now());
  return { wheelId: ancienne.wheelId };
}

/* ------------------------------------------------------------------ */
/* Le tirage                                                           */
/* ------------------------------------------------------------------ */

const CIBLES = new Set(['one', 'some', 'all']);

/** Les points d'un sort ne bougent plus un classement deja devoile. */
const PHASES_POINTS = new Set(['config', 'lobby', 'creation', 'upload', 'diffusion']);
/** Le chrono est partage : on ne l'avance que pendant qu'il court. */
const PHASES_CHRONO = new Set(['creation', 'upload']);
/**
 * Les phases ou les rendus n'ont pas encore ete entendus.
 *
 * C'est la que l'anonymat du vote est en jeu. Arena vote en aveugle, et une
 * contrainte individuelle du genre « inclure un sample de vache » le casse :
 * a la diffusion, qui entend la vache sait qui c'est. Ce n'est pas reparable,
 * c'est inherent a une contrainte individuelle dans un jeu a vote aveugle —
 * mais l'animateur doit pouvoir etre prevenu avant de tirer. Passe la
 * diffusion, la question ne se pose plus : la salle a deja tout entendu.
 */
const PHASES_AVEUGLES = new Set(['config', 'lobby', 'creation', 'upload']);

/**
 * Qui peut etre tire.
 *
 * L'animateur n'est pas dans la roue : il la tourne. Un disqualifie non plus,
 * son sort ne changerait rien. Les spectateurs sont dehors par defaut — ils ne
 * concourent pas, donc un malus sur eux ne veut rien dire — mais l'animateur
 * peut les inclure pour un gag qui ne touche a aucun score.
 */
function eligibles(session, { includeSpectators = false } = {}) {
  return [...session.participants.values()]
    .filter((p) => !p.isHost && !p.disqualified && (includeSpectators || !p.spectator))
    .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
}

/**
 * Le tirage.
 *
 * `shared` faux veut dire « un sort chacun, et differents » : c'est ce que
 * l'animateur demande quand il distribue. On tire donc sans remise parmi les
 * cases tant qu'il en reste ; quand il y a plus de monde que de cases, on
 * recommence un tour — et `epuise` le dit, pour que la page puisse prevenir
 * plutot que de laisser croire a une coincidence.
 */
function tirer(session, {
  wheelId, target = 'one', howMany = 1, shared = false, includeSpectators = false, seed = null,
} = {}) {
  if (!CIBLES.has(target)) throw new RouletteError('Cible inconnue.');

  const roue = exigerRoue(wheelId);
  const cases = repo.slots(roue.id).filter((c) => c.weight > 0);
  if (!cases.length) {
    throw new RouletteError(`« ${roue.name} » n’a aucune case jouable : toutes sont a zero.`);
  }

  const monde = eligibles(session, { includeSpectators });
  if (!monde.length) {
    throw new RouletteError('Personne a tirer : la salle est vide, ou tout le monde regarde.');
  }

  const combien = target === 'all'
    ? monde.length
    : clamp(Math.trunc(Number(target === 'one' ? 1 : howMany) || 1), 1, monde.length);

  const graine = String(seed || `${session.code}:${Date.now()}:${uuid()}`);
  const suivant = generateur(graine);

  const vises = melanger(monde, suivant).slice(0, combien);

  /*
   * Les sorts.
   *
   * Partage : une seule case pour tout le monde. Sinon une chacun, sans remise
   * tant que la roue en a.
   */
  const sorts = [];
  let epuise = false;
  if (shared) {
    const unique = tirerCase(cases, suivant);
    for (const p of vises) sorts.push({ participant: p, caseTiree: unique });
  } else {
    let restantes = [...cases];
    for (const p of vises) {
      if (!restantes.length) { restantes = [...cases]; epuise = true; }
      const choisie = tirerCase(restantes, suivant);
      restantes = restantes.filter((c) => c.id !== choisie.id);
      sorts.push({ participant: p, caseTiree: choisie });
    }
  }

  /*
   * Ce qui s'applique vraiment, et ce qui reste une consigne.
   *
   * Les points ne corrigent plus un classement deja devoile. Le chrono est
   * partage par toute la salle : l'avancer pour une seule personne n'existe
   * pas dans Arena, et pretendre le faire serait mentir a l'ecran.
   */
  const now = Date.now();
  const pointsApplicables = PHASES_POINTS.has(session.phase);
  const chronoApplicable = PHASES_CHRONO.has(session.phase) && target === 'all' && shared;

  const spin = repo.addSpin({
    id: uuid(),
    sessionId: session.id,
    wheelId: roue.id,
    wheelName: roue.name,
    target,
    howMany: combien,
    shared: shared ? 1 : 0,
    phase: session.phase,
    seed: graine,
    at: now,
  });

  const fates = sorts.map(({ participant, caseTiree }, i) => repo.addFate({
    id: uuid(),
    spinId: spin.id,
    participantId: participant.id,
    pseudo: participant.pseudo,
    label: caseTiree.label,
    detail: caseTiree.detail,
    points: caseTiree.points,
    chronoMs: caseTiree.chronoMs,
    /*
     * Chaque effet porte son propre etat.
     *
     * Ils n'obeissent pas a la meme regle : les points ne corrigent plus un
     * classement devoile, le chrono ne bouge que pour la salle entiere pendant
     * qu'il court. Un seul drapeau pour les deux obligeait les pages a
     * redeviner laquelle avait joue.
     */
    pointsAppliedAt: (caseTiree.points !== 0 && pointsApplicables) ? now : null,
    chronoAppliedAt: (caseTiree.chronoMs !== 0 && chronoApplicable) ? now : null,
    position: i,
  }));

  repo.logEvent(session.id, 'roulette:spin', {
    wheel: roue.name, target, shared, combien, graine, tirages: repo.countSpins(session.id),
  });

  return {
    spin,
    fates,
    /** Le chrono a-t-il vraiment bouge, et de combien. */
    chronoMs: chronoApplicable ? (sorts[0]?.caseTiree.chronoMs ?? 0) : 0,
    chronoApplicable,
    pointsApplicables,
    epuise,
    /** Combien de fois la roue a tourne dans cette session, celui-ci compris. */
    tirages: repo.countSpins(session.id),
  };
}

module.exports = {
  RouletteError,
  generateur, melanger, tirerCase, eligibles,
  creerRoue, renommerRoue, supprimerRoue,
  ajouterCase, modifierCase, retirerCase, deplacerCase,
  tirer,
  POINTS_MAX, CHRONO_MAX_MS, PHASES_POINTS, PHASES_CHRONO, PHASES_AVEUGLES,
};
