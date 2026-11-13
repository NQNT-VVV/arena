'use strict';

/**
 * Les regles que le serveur applique ET que les pages doivent connaitre.
 *
 * Une page qui grise un bouton a besoin de la meme regle que le serveur qui
 * refuse le geste. La lui faire redeclarer serait un miroir, et un miroir
 * finit par mentir : la regle vit donc ici, `battle.js` l'applique, et
 * `views.js` l'envoie aux pages — sur le modele de `rouletteRules`.
 *
 * Ce module ne depend de rien : `battle.js` et `views.js` le lisent tous les
 * deux sans se lire l'un l'autre.
 */

/* ------------------------------------------------------------------ */
/* Elements imposes                                                    */
/* ------------------------------------------------------------------ */

/**
 * Phases ou l'animateur peut encore deposer un element.
 *
 * `creation` en fait partie : oublier un sample et s'en apercevoir dix
 * minutes apres le depart arrive, et interdire l'ajout obligerait a relancer
 * toute la session. Les participants recoivent le nouvel element en direct.
 */
const ASSET_ADD_PHASES = new Set(['config', 'lobby', 'creation']);

/**
 * Phases ou il peut en retirer un.
 *
 * Volontairement plus etroit que l'ajout : retirer une contrainte alors que
 * des gens ont deja construit dessus invalide leur travail.
 */
const ASSET_REMOVE_PHASES = new Set(['config', 'lobby']);

/**
 * Entre deux manches : le classement est affiche et il reste une manche.
 *
 * C'est le seul moment, une fois la partie lancee, ou plus personne ne
 * travaille sur rien. La consigne et le pack s'y changent donc librement —
 * sans quoi trois manches etaient trois fois la meme.
 */
function entreDeuxManches(session) {
  return session.phase === 'results' && (session.round ?? 1) < (session.config?.rounds ?? 1);
}

const peutAjouterElement = (session) => ASSET_ADD_PHASES.has(session.phase) || entreDeuxManches(session);
const peutRetirerElement = (session) => ASSET_REMOVE_PHASES.has(session.phase) || entreDeuxManches(session);

/* ------------------------------------------------------------------ */
/* Acces aux rendus                                                    */
/* ------------------------------------------------------------------ */

const AUTHORS_PHASES = new Set(['results', 'archived']);
const REVEALED_PHASES = new Set(['diffusion', 'results', 'archived']);

/** Le rendu vient-il d'une manche deja jouee ? Elle a ete devoilee en entier avant de passer a la suivante. */
const mancheJouee = (session, sub) => (sub.round ?? 1) < (session.round ?? 1);

/**
 * Peut-on servir le rendu complet, sous son vrai nom ?
 *
 * Une fois les auteurs reveles : au classement, ou pour toute manche deja
 * jouee. La regle ne regardait que la phase de la session — des la manche 2
 * lancee, les rendus de la manche 1 repondaient 404 a tout le monde.
 */
const rendusReveles = (session, sub) => AUTHORS_PHASES.has(session.phase) || mancheJouee(session, sub);

/** Peut-on servir l'extrait de diffusion, anonyme ? Des la diffusion, et pour toute manche jouee. */
const extraitVisible = (session, sub) => REVEALED_PHASES.has(session.phase) || mancheJouee(session, sub);

module.exports = {
  rendusReveles, extraitVisible,
  ASSET_ADD_PHASES, ASSET_REMOVE_PHASES,
  entreDeuxManches, peutAjouterElement, peutRetirerElement,
};
