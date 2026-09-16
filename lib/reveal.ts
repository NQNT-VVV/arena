import { hex, hexOf } from './hex';
import type { Spin } from './types';

/**
 * LA REVELATION — la choregraphie d'un tirage, calculee d'avance.
 *
 * Deux registres, toujours les deux a l'ecran. LE CHAMP montre tout ce qui
 * pouvait sortir : une plaque par personne, un cran par case, et le cran est
 * large en proportion de son poids. Il est muet. LE MOT porte, en tres grand,
 * ce qui est pointe a l'instant : c'est la seule chose qui change.
 *
 * TROIS REGLES TIENNENT CE MODULE.
 *
 *   - LE MOT NE COURT QUE SUR UNE VARIABLE QUE LE SERVEUR A TIREE. Les autres
 *     sont posees, d'une coupe, sans faire semblant. C'est ce qui traite d'un
 *     coup « tout le monde » (personne n'a ete tire : on l'enonce), « tout le
 *     monde, meme sort » (le seul vrai tirage est celui de la case, il recoit
 *     toute la ceremonie), le participant unique et la roue a une seule case.
 *
 *   - LA DECELERATION EST UNE PROPRIETE DE LA CADENCE, PAS DE L'INTERPOLATION.
 *     Des coupes franches a 150, 150, 180, 230, 300, 400, 540 ms decelerent
 *     violemment et restent entierement des coupes : rien ne glisse, rien n'est
 *     interpole, le marqueur ne se deplace pas — il change d'hote. Un metronome
 *     qui ralentit n'est pas un glissando.
 *
 *   - LA DUREE EST CONSTANTE POUR UN CHAMP DONNE. L'arrivee est connue avant
 *     que quoi que ce soit ne bouge ; on ne cherche donc pas combien de crans
 *     il faut pour y tomber, on FIXE le nombre de paliers et on calcule le
 *     depart. L'animateur sait combien de temps ca prend, quel que soit le tire.
 *
 * Ce module est pur : sans React, sans horloge, sans DOM. Il rend la liste
 * complete des images et leurs horodatages relatifs a `spin.at` — une
 * quarantaine au plus. Le composant ne fait que rendre `frames[k]`, et n'en
 * deduit rien. C'est aussi ce qui le rend testable sans navigateur.
 */

/* ------------------------------------------------------------------ */
/* Le vocabulaire                                                      */
/* ------------------------------------------------------------------ */

/** Ou vit le marqueur, quand il vit. */
export type Champ = 'tableau' | 'reglette' | null;

/** Le palier de taille du mot, choisi sur la longueur : l'echelle est discrete. */
export type Taille = 's1' | 's2' | 's3';

export type EtatPlaque = 'vide' | 'marque' | 'tiree';
export type EtatCran = 'libre' | 'marque' | 'tiree' | 'usee';

/** Un instant de la revelation, entierement calcule : le rendu n'en deduit rien. */
export interface Frame {
  champ: Champ;
  /** Index du marqueur dans ce champ. */
  marque: number | null;
  plaques: EtatPlaque[];
  /** Le libelle tombe dans chaque plaque. Une puce d'effet au-dela de 12 sujets. */
  sorts: (string | null)[];
  crans: EtatCran[];
  /** Le surtitre du mot. */
  sur: string;
  /** Le mot. */
  texte: string;
  taille: Taille;
  /** Filet sang sur le mot : quelque chose est encore en train de se decider. */
  vivant: boolean;
  /** Les puces d'effet sont posees. */
  chips: boolean;
  /**
   * De quel sort viennent ces puces, par son index dans `spin.fates`.
   *
   * Un index plutot que les puces elles-memes : `effectsOf` met deja un effet
   * en mots ailleurs, et le dupliquer ici ferait deux verites pour une.
   */
  vedette: number | null;
  pied: string;
}

export interface Revelation {
  frames: Frame[];
  /** Horodatages relatifs a `spin.at`, en millisecondes. */
  at: number[];
  totalMs: number;
}

/** Le geste applique a une variable : elle a ete tiree, ou elle est posee. */
export type Geste = 'passe' | 'arrets' | 'donne' | 'pose';
export type PasseKind = 'passe' | 'passe_longue' | 'passe_solennelle';

export interface Plan {
  /** Le QUI : tire quand il restait un choix, pose sinon. */
  qui: { geste: 'passe' | 'arrets' | 'pose'; k: number };
  /** Le QUOI : il n'y a pas de tirage sans case, sauf roue a une seule case. */
  quoi: { geste: 'passe' | 'donne' | 'pose'; passe: PasseKind };
}

/* ------------------------------------------------------------------ */
/* Les constantes                                                      */
/* ------------------------------------------------------------------ */

/** Le champ apparait, et on le regarde avant que quoi que ce soit ne bouge. */
const POSE = 400;
/** « Personne n'a ete tire » : le temps de lire l'enonce, pas de le subir. */
const TENUE_SALLE = 700;
/** Le nom tire reste seul a l'ecran avant que la case parte. */
const TENUE_NOM = 520;
/** Le groupe constitue, avant la donne. */
const TENUE_GROUPE = 500;
/** Jeton du socle : inversion pleine, puis tenue. */
const FLASH = 80;
/**
 * Plancher absolu, jamais moins.
 *
 * A 30 i/s — la cadence d'une source navigateur OBS — 150 ms font 4,5 images.
 * En dessous, un changement plein-region a fort contraste est lisse par
 * l'estimation de mouvement de l'encodeur et arrive gris. Ce n'est pas l'oeil
 * la limite sur ce medium, c'est le quantificateur.
 */
const PALIER_MIN = 150;
/** Total, tous modes, tous effectifs. Au-dela, la course raccourcit. */
const PLAFOND = 9000;
/** La donne ne depend pas de l'effectif : elle tient dans cette enveloppe. */
const DONNE_MS = 2600;
/** Mouvement reduit : chaque arrivee est posee et tenue, sans course. */
const TENUE_REDUITE = 800;
/** Mouvement reduit : on ne donne pas MOINS de temps de lecture a qui en veut plus. */
const RALLONGE_REDUITE = 1200;

/** Au-dela, les plaques ne portent plus le libelle : il serait de la bouillie. */
const PLAQUES_AVEC_SORT = 12;

/* ------------------------------------------------------------------ */
/* Les rampes                                                          */
/* ------------------------------------------------------------------ */

const RAMPES: Record<PasseKind, number[]> = {
  passe: [150, 150, 180, 230, 300, 400, 540],
  passe_longue: [150, 150, 150, 190, 250, 320, 410, 530, 680],
  passe_solennelle: [150, 150, 150, 150, 190, 250, 320, 410, 530, 680, 820],
};

/**
 * Les paliers d'une passe.
 *
 * Les trois derniers sont les seuls garantis nets apres reencodage — un palier
 * a 530 ou 680 ms laisse a l'encodeur le temps d'affiner les aretes des
 * glyphes — et ce sont exactement ceux qui portent les trois derniers
 * candidats. La rampe est une rampe de NETTETE avant d'etre une dramaturgie :
 * les premiers paliers disent « ca tourne », ils ne se lisent pas.
 */
export function paliers(kind: PasseKind): number[] {
  return RAMPES[kind].slice();
}

/**
 * Les paliers du j-ieme arret d'une passe a k arrets.
 *
 * Le palier de depot est CONSTRUIT long, et s'allonge a mesure qu'il reste
 * moins de places : sans cela les k−1 premiers depots tomberaient dans la zone
 * rapide, c'est-a-dire la ou la rampe de nettete interdit de poser quoi que ce
 * soit qu'on doive lire. Aucun depot n'est sacrifie.
 */
export function paliersArret(j: number, k: number, rapides = 3): number[] {
  const depot = j >= k ? 600 : 400 + Math.round((200 * (j - 1)) / Math.max(1, k - 1));
  return [...Array.from({ length: Math.max(1, rapides) }, () => PALIER_MIN), depot];
}

/**
 * Le depart, deduit de l'arrivee.
 *
 * L'arrivee est connue : on fixe le nombre de paliers et on remonte. Personne
 * ne sait ou le marqueur « devrait » demarrer, et la duree ne depend plus de
 * qui est tire.
 */
export function departPour(cible: number, n: number, nb: number): number {
  if (n <= 0) return 0;
  return (((cible - (nb - 1)) % n) + n) % n;
}

/** Le temps de lire, plus une tranche par quarante signes de libelle. */
export function tenueLecture(len: number): number {
  const rallonge = 400 * Math.floor(Math.max(0, len - 40) / 40);
  return Math.min(3200, Math.max(2000, 2000 + rallonge));
}

/** L'echelle du systeme est discrete ; l'ajustement doit l'etre aussi. */
export function tailleDe(texte: string): Taille {
  if (texte.length <= 16) return 's1';
  if (texte.length <= 96) return 's2';
  return 's3';
}

/* ------------------------------------------------------------------ */
/* La derivation : cinq modes, deux axes                               */
/* ------------------------------------------------------------------ */

/**
 * Qui a ete tire, et quoi — les deux questions sont independantes.
 *
 * Les cinq modes atteignables se DERIVENT de ces deux axes au lieu d'etre
 * enumeres. C'est ce qui traite « plusieurs personnes, le meme sort » — jamais
 * decrit nulle part, mais que la regie propose et que le serveur execute — sans
 * branche speciale, et ce qui fait degenerer proprement « k personnes » en
 * « tout le monde » quand k vaut l'effectif.
 */
export function planDeTirage(spin: Spin): Plan {
  const champ = sujets(spin);
  const k = spin.fates.length;
  const distincts = new Set(spin.fates.map((f, i) => (f.slotIndex >= 0 ? `c${f.slotIndex}` : `l${i}:${f.label}`))).size;

  const quiTire = spin.target !== 'all' && k < champ.length && champ.length > 1;
  const qui: Plan['qui'] = quiTire
    ? { geste: k === 1 ? 'passe' : 'arrets', k }
    : { geste: 'pose', k };

  if (spin.slots.length <= 1) return { qui, quoi: { geste: 'pose', passe: 'passe_longue' } };
  if (spin.shared || distincts <= 1) {
    /*
     * Une seule inconnue, qui touche tout le monde : elle merite la plus longue
     * des rampes. C'est le mode que le code precedent n'animait pas du tout.
     */
    const solennelle = qui.geste === 'pose' && k > 1;
    return { qui, quoi: { geste: 'passe', passe: solennelle ? 'passe_solennelle' : 'passe_longue' } };
  }
  return { qui, quoi: { geste: 'donne', passe: 'passe_longue' } };
}

/* ------------------------------------------------------------------ */
/* Le champ                                                            */
/* ------------------------------------------------------------------ */

/**
 * Les sujets du tableau.
 *
 * `pool` est le vivier fige au tirage — sans l'animateur, sans les
 * disqualifies, sans les spectateurs quand ils sont dehors. Un tirage d'avant
 * la migration l'a vide : le tableau se replie alors sur la bande des pseudos
 * tires, et le pied le dit au lieu de faire croire a un champ.
 */
function sujets(spin: Spin): string[] {
  return spin.pool.length ? spin.pool : spin.fates.map((f) => f.pseudo);
}

/** Ou tombe un sort dans le champ des sujets. */
function placeSujet(spin: Spin, index: number, champ: string[]): number {
  const f = spin.fates[index];
  if (spin.pool.length && f.poolIndex >= 0 && f.poolIndex < champ.length) return f.poolIndex;
  const i = champ.indexOf(f.pseudo);
  return i >= 0 ? i : Math.min(index, Math.max(0, champ.length - 1));
}

/** La puce d'effet d'un sort, quand la plaque est trop petite pour son libelle. */
function puce(spin: Spin, index: number): string {
  const f = spin.fates[index];
  if (f.points) return `${f.points > 0 ? '+' : '−'}${Math.abs(f.points)}`;
  if (f.chronoMs) return `${f.chronoMs > 0 ? '+' : '−'}${Math.round(Math.abs(f.chronoMs) / 1000)}S`;
  return '·';
}

/** Ce qu'une plaque porte sous le pseudo : le libelle, ou sa puce. */
function marqueDeSort(spin: Spin, index: number, champ: string[]): string {
  return champ.length > PLAQUES_AVEC_SORT ? puce(spin, index) : spin.fates[index].label.toUpperCase();
}

/**
 * Comment nommer ceux que le sort touche.
 *
 * Exporte parce que le bandeau de diffusion, qui n'a de place que pour une
 * plaque, a besoin de la meme phrase que le surtitre du mot.
 */
export function destinataires(spin: Spin): string {
  return destinataire(spin, planDeTirage(spin));
}

function destinataire(spin: Spin, plan: Plan): string {
  if (plan.qui.geste === 'pose' && spin.fates.length > 1) return 'TOUTE LA SALLE';
  const noms = spin.fates.map((f) => f.pseudo.toUpperCase());
  if (noms.length === 1) return noms[0];
  const joint = noms.join(' · ');
  return joint.length <= 48 ? joint : `${hex(noms.length)} SUJETS`;
}

/* ------------------------------------------------------------------ */
/* La ligne finale                                                     */
/* ------------------------------------------------------------------ */

/** Le poids mecanique d'un sort : les points d'abord, le chrono pour departager. */
function poidsSort(f: Spin['fates'][number]): [number, number] {
  return [Math.abs(f.points), Math.abs(f.chronoMs)];
}

/**
 * Ce qui reste a l'ecran quand tout est tombe.
 *
 * On ne sacre jamais au hasard en pretendant classer : si aucun sort ne porte
 * d'effet mecanique — le cas exact d'une roue de contraintes pures — le mot ne
 * designe pas de tete d'affiche, il porte le decompte et dit que tout est
 * consigne. En cas d'egalite stricte, « PARMI LES PLUS LOURDS ».
 */
export function ligneFinale(spin: Spin): { sur: string; texte: string; vedette: number | null } {
  const n = spin.fates.length;
  if (!n) return { sur: 'AUCUN SORT DISTRIBUE', texte: hex(0), vedette: null };

  const plan = planDeTirage(spin);
  const distincts = new Set(spin.fates.map((f) => f.label)).size;
  if (n === 1 || spin.shared || distincts === 1) {
    return {
      sur: n === 1 ? spin.fates[0].pseudo.toUpperCase() : `POUR ${destinataire(spin, plan)}`,
      texte: spin.fates[0].label.toUpperCase(),
      vedette: 0,
    };
  }

  const mecanique = spin.fates.some((f) => f.points !== 0 || f.chronoMs !== 0);
  if (!mecanique) {
    return {
      sur: `${hex(n)} SORTS DISTRIBUES · AUCUN EFFET MECANIQUE · TOUT EST CONSIGNE`,
      texte: hex(n),
      vedette: null,
    };
  }

  let tete = 0;
  for (let i = 1; i < n; i++) {
    const [a, b] = poidsSort(spin.fates[i]);
    const [c, d] = poidsSort(spin.fates[tete]);
    if (a > c || (a === c && b > d)) tete = i;
  }
  const [pa, pb] = poidsSort(spin.fates[tete]);
  const exaequo = spin.fates.filter((f) => {
    const [a, b] = poidsSort(f);
    return a === pa && b === pb;
  }).length > 1;

  return {
    sur: exaequo ? 'PARMI LES PLUS LOURDS' : 'LE PLUS LOURD',
    texte: `${spin.fates[tete].pseudo.toUpperCase()} · ${spin.fates[tete].label.toUpperCase()}`,
    vedette: tete,
  };
}

/* ------------------------------------------------------------------ */
/* La choregraphie                                                     */
/* ------------------------------------------------------------------ */

interface Reglages {
  /** Paliers rapides avant chaque depot d'une passe a k arrets. */
  rapides: number;
  /** Les depots vont par paires : la donne ne descend pas sous son plancher. */
  paires: boolean;
  /** La donne est au plancher de nettete. */
  plancher: boolean;
  /** La passe longue redevient une passe. */
  courte: boolean;
}

/**
 * La degradation, si le total depasse le plafond.
 *
 * Elle ne supprime JAMAIS un registre ni un mecanisme : elle raccourcit la
 * course, dans cet ordre. Une revelation degradee reste la meme revelation,
 * plus courte — on ne retire ni la reglette, ni le mot, ni la tenue de lecture.
 */
const ECHELLE: Reglages[] = [
  { rapides: 3, paires: false, plancher: false, courte: false },
  { rapides: 2, paires: false, plancher: false, courte: false },
  { rapides: 1, paires: false, plancher: false, courte: false },
  { rapides: 1, paires: true, plancher: true, courte: false },
  { rapides: 1, paires: true, plancher: true, courte: true },
];

export function revelation(spin: Spin, reduit = false): Revelation {
  if (reduit) return construire(spin, ECHELLE[0], true);
  for (const reglages of ECHELLE) {
    const essai = construire(spin, reglages, false);
    if (essai.totalMs <= PLAFOND) return essai;
  }
  return construire(spin, ECHELLE[ECHELLE.length - 1], false);
}

function construire(spin: Spin, reglages: Reglages, reduit: boolean): Revelation {
  const plan = planDeTirage(spin);
  const champ = sujets(spin);
  const n = champ.length;
  const nbSorts = spin.fates.length;
  const poidsTotal = spin.slots.reduce((somme, c) => somme + c.weight, 0);
  const cible = destinataire(spin, plan);

  /* L'etat courant des deux champs : on en prend un instantane par image. */
  const plaques: EtatPlaque[] = Array.from({ length: n }, () => 'vide');
  const sorts: (string | null)[] = Array.from({ length: n }, () => null);
  const crans: EtatCran[] = Array.from({ length: spin.slots.length }, () => 'libre');

  const frames: Frame[] = [];
  const at: number[] = [];
  let t = 0;

  /* Le pluriel se decide : « 0x01 SUJETS TOUCHES » se lit comme une faute. */
  const touches = `${hex(nbSorts)} SUJET${nbSorts > 1 ? 'S' : ''} TOUCHE${nbSorts > 1 ? 'S' : ''}`;
  const repete = (k: number) => `${hex(k)} SORT${k > 1 ? 'S' : ''} SE REPETE${k > 1 ? 'NT' : ''}`;
  const piedSujets = (designes: number) => {
    if (!spin.pool.length) return 'CHAMP NON ENREGISTRE · TIRAGE ANTERIEUR';
    if (n === 1) return '0x01 SUJET DANS LA ROUE · AUCUN CHOIX';
    const compte = plan.qui.geste === 'pose' ? touches : `${hexOf(designes, plan.qui.k)} DESIGNE`;
    return `${hex(n)} SUJETS DANS LA ROUE · ${compte}`;
  };
  const piedRoue = (suffixe: string) => {
    if (!spin.slots.length) return 'ROUE NON ENREGISTREE · TIRAGE ANTERIEUR';
    if (spin.slots.length === 1) return `0x01 CASE JOUABLE · AUCUN CHOIX · ${suffixe}`;
    return `${hex(spin.slots.length)} CASES JOUABLES · POIDS TOTAL ${hex(poidsTotal)} · ${suffixe}`;
  };

  const image = (
    champActif: Champ,
    marque: number | null,
    mot: { sur: string; texte: string; vivant: boolean; chips?: boolean; vedette?: number | null },
    pied: string,
  ): Frame => ({
    champ: champActif,
    marque,
    plaques: plaques.slice(),
    sorts: sorts.slice(),
    crans: crans.slice(),
    sur: mot.sur,
    texte: mot.texte,
    taille: tailleDe(mot.texte),
    vivant: mot.vivant,
    chips: !!mot.chips,
    vedette: mot.vedette ?? null,
    pied,
  });

  const pousser = (dureeMs: number, frame: Frame) => {
    at.push(t);
    frames.push(frame);
    t += dureeMs;
  };

  /* -------------------------------------------------------------- */
  /* La pose : le champ apparait, et rien d'autre                    */
  /* -------------------------------------------------------------- */

  pousser(POSE, image(null, null, {
    sur: `LA ROUE · ${spin.wheelName.toUpperCase()}`,
    texte: spin.spent ? 'LA ROUE A REFAIT UN TOUR' : 'ON TIRE',
    vivant: true,
  }, piedSujets(0)));

  /* -------------------------------------------------------------- */
  /* LE QUI                                                          */
  /* -------------------------------------------------------------- */

  const placeDe = spin.fates.map((_, i) => placeSujet(spin, i, champ));

  if (plan.qui.geste === 'pose') {
    /*
     * Zero inconnue de nom : le champ s'allume ENTIER, en une coupe. Cela
     * ENONCE « toute la salle » au lieu de faire semblant de la tirer, et tout
     * le budget de mouvement part dans la question qui reste vraiment ouverte.
     */
    for (let i = 0; i < n; i++) plaques[i] = 'tiree';
    const seul = n <= 1 && nbSorts === 1;
    pousser(TENUE_SALLE + (reduit ? RALLONGE_REDUITE : 0), image(null, null, {
      sur: seul ? 'LE SEUL SUJET' : 'PERSONNE N’A ETE TIRE',
      texte: seul ? champ[0].toUpperCase() : 'C’EST POUR TOUTE LA SALLE',
      vivant: false,
    }, piedSujets(nbSorts)));
  } else if (plan.qui.geste === 'passe') {
    const place = placeDe[0];
    if (!reduit) {
      const rampe = paliers('passe');
      const depart = departPour(place, n, rampe.length);
      for (let i = 0; i < rampe.length; i++) {
        const ou = (depart + i) % n;
        plaques.forEach((_, j) => { plaques[j] = 'vide'; });
        plaques[ou] = 'marque';
        pousser(rampe[i], image('tableau', ou, {
          sur: 'ON TIRE QUI',
          texte: champ[ou].toUpperCase(),
          vivant: true,
        }, piedSujets(0)));
      }
    }
    plaques.forEach((_, j) => { plaques[j] = 'vide'; });
    plaques[place] = 'tiree';
    pousser(FLASH + (reduit ? TENUE_REDUITE : TENUE_NOM), image(null, null, {
      sur: 'TIRE',
      texte: spin.fates[0].pseudo.toUpperCase(),
      vivant: false,
    }, piedSujets(1)));
  } else {
    /*
     * Une seule passe, qui colle k fois en chemin : la salle voit le groupe se
     * constituer. Le marqueur ne court que sur les plaques encore libres — une
     * plaque deja designee ne redevient jamais un candidat, et aucun palier
     * n'est perdu a pointer quelqu'un qui est deja pris.
     */
    const k = plan.qui.k;
    for (let j = 1; j <= k; j++) {
      const place = placeDe[j - 1];
      const restants: number[] = [];
      for (let i = 0; i < n; i++) if (plaques[i] !== 'tiree') restants.push(i);
      const rang = restants.indexOf(place);

      if (!reduit && restants.length > 1 && rang >= 0) {
        const rampe = paliersArret(j, k, reglages.rapides);
        const depart = departPour(rang, restants.length, rampe.length);
        for (let i = 0; i < rampe.length; i++) {
          const ou = restants[(depart + i) % restants.length];
          for (const p of restants) plaques[p] = 'vide';
          plaques[ou] = 'marque';
          pousser(rampe[i], image('tableau', ou, {
            sur: `ON TIRE QUI · ${hexOf(j, k)}`,
            texte: champ[ou].toUpperCase(),
            vivant: true,
          }, piedSujets(j - 1)));
        }
      }
      for (const p of restants) plaques[p] = 'vide';
      plaques[place] = 'tiree';
      pousser(FLASH, image(null, null, {
        sur: `ON TIRE QUI · ${hexOf(j, k)}`,
        texte: spin.fates[j - 1].pseudo.toUpperCase(),
        vivant: true,
      }, piedSujets(j)));
    }
    pousser(TENUE_GROUPE + (reduit ? RALLONGE_REDUITE : 0), image(null, null, {
      sur: `LE GROUPE · ${hex(k)} SUJETS DESIGNES`,
      texte: cible,
      vivant: false,
    }, piedSujets(k)));
  }

  /* -------------------------------------------------------------- */
  /* LE QUOI                                                         */
  /* -------------------------------------------------------------- */

  const caseDe = spin.fates.map((f) => (f.slotIndex >= 0 && f.slotIndex < crans.length ? f.slotIndex : -1));

  if (plan.quoi.geste === 'passe') {
    const arrivee = caseDe[0];
    if (!reduit && arrivee >= 0 && crans.length > 1) {
      const kind: PasseKind = reglages.courte && plan.quoi.passe !== 'passe_solennelle' ? 'passe' : plan.quoi.passe;
      const rampe = paliers(kind);
      const depart = departPour(arrivee, crans.length, rampe.length);
      for (let i = 0; i < rampe.length; i++) {
        const ou = (depart + i) % crans.length;
        crans.forEach((_, j) => { crans[j] = 'libre'; });
        crans[ou] = 'marque';
        pousser(rampe[i], image('reglette', ou, {
          sur: `ON TIRE QUOI POUR ${cible}`,
          texte: spin.slots[ou].label.toUpperCase(),
          vivant: true,
        }, piedRoue(plan.qui.geste === 'pose' ? touches : `${hexOf(plan.qui.k, plan.qui.k)} DESIGNE`)));
      }
    }
    if (arrivee >= 0) {
      crans.forEach((_, j) => { crans[j] = 'libre'; });
      crans[arrivee] = 'tiree';
    }
    for (let i = 0; i < nbSorts; i++) sorts[placeDe[i]] = marqueDeSort(spin, i, champ);
    if (reduit) {
      pousser(TENUE_REDUITE, image(null, null, {
        sur: `POUR ${cible}`,
        texte: spin.fates[0]?.label.toUpperCase() ?? '',
        vivant: false,
      }, piedRoue(touches)));
    }
  } else if (plan.quoi.geste === 'donne') {
    /*
     * La donne repond a la seule question qui reste : non pas « suis-je
     * choisi » — en distribution tout le monde l'est — mais DANS QUELLE CASE JE
     * TOMBE. La reglette qui se vide rend visible la regle sans remise du
     * serveur ; quand le vivier se recharge, les crans se rallument d'un coup,
     * et le seul moment ou une repetition est legitime devient le plus
     * spectaculaire au lieu de passer pour un bug.
     *
     * Le mot n'ecrit rien pendant la donne : il porterait un texte sous le
     * plancher de nettete. Il tient un decompte stable. Ce qui bouge, ce sont
     * les plaques et la reglette — de l'information de FORME, qui survit au flou.
     */
    const paires = reglages.paires || nbSorts > 16;
    const lot = paires ? 2 : 1;
    const etapes = Math.ceil(nbSorts / lot);
    const palier = reglages.plancher
      ? PALIER_MIN
      : Math.min(320, Math.max(PALIER_MIN, Math.round(DONNE_MS / Math.max(1, etapes))));

    /* `consommes` est le tour en cours ; `vus` sert a compter les vraies repetitions. */
    const consommes = new Set<number>();
    const vus = new Set<number>();
    let tour = false;

    if (reduit) {
      for (let i = 0; i < nbSorts; i++) {
        sorts[placeDe[i]] = marqueDeSort(spin, i, champ);
        if (caseDe[i] >= 0) crans[caseDe[i]] = 'usee';
      }
      pousser(TENUE_REDUITE, image(null, null, {
        sur: 'LA DONNE',
        texte: hexOf(nbSorts, nbSorts),
        vivant: false,
      }, piedRoue(touches)));
    } else {
      for (let e = 0; e < etapes; e++) {
        for (let d = 0; d < lot; d++) {
          const i = e * lot + d;
          if (i >= nbSorts) break;
          sorts[placeDe[i]] = marqueDeSort(spin, i, champ);
          const c = caseDe[i];
          if (c >= 0) {
            if (consommes.has(c)) {
              // La roue a manque de cases et a refait un tour : tout se rallume.
              consommes.clear();
              crans.forEach((_, j) => { crans[j] = 'libre'; });
              tour = true;
            }
            crans.forEach((v, j) => { if (v === 'tiree') crans[j] = 'usee'; });
            crans[c] = 'tiree';
            consommes.add(c);
            vus.add(c);
          }
        }
        const faits = Math.min(nbSorts, (e + 1) * lot);
        pousser(palier, image(null, null, {
          sur: 'LA DONNE',
          texte: hexOf(faits, nbSorts),
          vivant: true,
        }, tour
          ? `LA ROUE A REFAIT UN TOUR · ${repete(faits - vus.size)}`
          : piedRoue(`${hex(consommes.size)} CONSOMMEES`)));
      }
    }
    crans.forEach((v, j) => { if (v === 'tiree') crans[j] = 'usee'; });
  } else {
    /* Roue a une seule case : rien n'a ete tire, rien ne doit etre dramatise. */
    if (caseDe[0] >= 0) crans[caseDe[0]] = 'tiree';
    for (let i = 0; i < nbSorts; i++) sorts[placeDe[i]] = marqueDeSort(spin, i, champ);
  }

  /* -------------------------------------------------------------- */
  /* La tenue de lecture                                             */
  /* -------------------------------------------------------------- */

  const fin = ligneFinale(spin);
  pousser(
    FLASH + tenueLecture(fin.texte.length) + (reduit ? RALLONGE_REDUITE : 0),
    image(null, null, { ...fin, vivant: false, chips: true }, piedRoue(touches)),
  );

  return { frames, at, totalMs: t };
}
