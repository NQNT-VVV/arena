'use strict';

/**
 * Qui reconstruit quel extrait.
 *
 * Module pur : il recoit les extraits, les participants et ce qui a deja ete
 * distribue aux manches precedentes, et rend une attribution. Le hasard lui est
 * passe — `alea`, une fonction qui rend un nombre dans [0, 1) — pour qu'un test
 * puisse rejouer un tirage a l'identique.
 *
 * LES QUATRE REGLES, DE LA PLUS FORTE A LA PLUS FAIBLE
 *
 *   1. Chacun recoit exactement un extrait.
 *   2. Autant que possible, chacun recoit un extrait different. Quand il y a
 *      moins d'extraits que de participants, ils sont repartis le plus
 *      egalement possible : jamais un extrait trois fois tant qu'un autre ne
 *      sert qu'une fois.
 *   3. Autant que possible, personne ne retombe sur un extrait qu'il a deja
 *      reconstruit a une manche precedente.
 *   4. Autant que possible, les extraits encore jamais joues passent avant les
 *      autres : une manche 2 qui ressert les extraits de la manche 1 alors que
 *      des neufs attendent, c'est une manche gachee.
 *
 * LA METHODE
 *
 * On distribue par NIVEAUX. Au premier niveau, chaque extrait sert au plus une
 * fois ; ceux qui n'ont rien recu passent au niveau suivant, ou chaque extrait
 * sert de nouveau au plus une fois, et ainsi de suite. C'est ce qui garantit
 * la regle 2 : un extrait ne peut servir une troisieme fois que si tous ont
 * servi deux fois.
 *
 * A chaque niveau, le partage est un couplage maximal entre participants et
 * extraits (algorithme de Kuhn), ou un participant n'est relie qu'aux extraits
 * qu'il n'a jamais eus — regle 3. Les extraits sont essayes du plus neuf au
 * plus joue — regle 4. Ceux qui restent sans rien recoivent ensuite les
 * extraits encore libres A CE NIVEAU, meme deja eus : la regle 3 cede devant
 * la regle 2, et un niveau de doublons ne s'ouvre que quand tous les extraits
 * ont servi.
 */

const crypto = require('crypto');

const aleaCrypto = () => crypto.randomInt(2 ** 32) / 2 ** 32;

/** Melange de Fisher-Yates, sur le hasard donne. */
function melanger(liste, alea) {
  const out = [...liste];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Couplage maximal : `relies(p)` rend les extraits permis a p, dans l'ordre de
 * preference. Rend Map(participant -> extrait) pour ceux qui ont ete servis.
 */
function coupler(participants, relies) {
  const tenu = new Map(); // extrait -> participant
  const essayer = (p, vus) => {
    for (const e of relies(p)) {
      if (vus.has(e)) continue;
      vus.add(e);
      if (!tenu.has(e) || essayer(tenu.get(e), vus)) {
        tenu.set(e, p);
        return true;
      }
    }
    return false;
  };
  for (const p of participants) essayer(p, new Set());
  const out = new Map();
  for (const [e, p] of tenu) out.set(p, e);
  return out;
}

/**
 * Attribue un extrait a chaque participant.
 *
 *   attribuer({
 *     extraits: ['e1', 'e2', 'e3'],
 *     participants: ['p1', 'p2'],
 *     historique: [{ participantId: 'p1', extraitId: 'e1' }, ...], // manches passees
 *     alea,
 *   }) -> Map(participantId -> extraitId)
 *
 * Rend une Map vide s'il n'y a aucun extrait : la manche se joue alors sans,
 * et c'est a l'appelant de dire pourquoi.
 */
function attribuer({ extraits, participants, historique = [], alea = aleaCrypto }) {
  const out = new Map();
  if (!extraits.length || !participants.length) return out;

  const dejaEus = new Map();
  const joues = new Map();
  for (const { participantId, extraitId } of historique) {
    if (!dejaEus.has(participantId)) dejaEus.set(participantId, new Set());
    dejaEus.get(participantId).add(extraitId);
    joues.set(extraitId, (joues.get(extraitId) ?? 0) + 1);
  }

  // Preference : du moins joue au plus joue, au hasard a egalite.
  const ordre = melanger(extraits, alea).sort((a, b) => (joues.get(a) ?? 0) - (joues.get(b) ?? 0));

  let restants = melanger(participants, alea);
  while (restants.length) {
    // D'abord, servir sans faire retomber personne sur un extrait deja eu.
    const niveau = coupler(restants, (p) => ordre.filter((e) => !dejaEus.get(p)?.has(e)));
    for (const [p, e] of niveau) out.set(p, e);
    restants = restants.filter((p) => !niveau.has(p));

    // Puis donner les extraits restes libres a ce niveau, meme deja eus : un
    // extrait deja reconstruit vaut mieux qu'un doublon, parce que l'unicite
    // (regle 2) passe avant l'historique (regle 3).
    const pris = new Set(niveau.values());
    const libres = ordre.filter((e) => !pris.has(e));
    const rattrapes = coupler(restants, () => libres);
    for (const [p, e] of rattrapes) out.set(p, e);
    restants = restants.filter((p) => !rattrapes.has(p));
  }
  return out;
}

/**
 * Un extrait pour un retardataire, sans toucher aux autres.
 *
 * Quelqu'un qui arrive pendant la creation doit pouvoir jouer : on lui donne
 * l'extrait le moins distribue de la manche, en evitant ceux qu'il a deja eus.
 * Reattribuer toute la manche changerait l'extrait de gens qui ont deja
 * commence a travailler dessus.
 */
function attribuerUn({ extraits, participantId, manche = [], historique = [], alea = aleaCrypto }) {
  if (!extraits.length) return null;
  const servis = new Map();
  for (const { extraitId } of manche) servis.set(extraitId, (servis.get(extraitId) ?? 0) + 1);
  const joues = new Map();
  const dejaEus = new Set();
  for (const h of historique) {
    joues.set(h.extraitId, (joues.get(h.extraitId) ?? 0) + 1);
    if (h.participantId === participantId) dejaEus.add(h.extraitId);
  }
  const candidats = melanger(extraits, alea).sort((a, b) => (dejaEus.has(a) - dejaEus.has(b))
    || (servis.get(a) ?? 0) - (servis.get(b) ?? 0)
    || (joues.get(a) ?? 0) - (joues.get(b) ?? 0));
  return candidats[0];
}

module.exports = { attribuer, attribuerUn, melanger, coupler };
