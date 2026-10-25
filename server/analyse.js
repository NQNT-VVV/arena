'use strict';

/**
 * BPM et tonalite d'un extrait, estimes a l'oreille de la machine.
 *
 * Deux usages, et aucun n'a besoin d'etre parfait : proposer une valeur a
 * l'animateur au moment ou il depose ses extraits, et l'afficher au participant
 * qui doit reconstruire le morceau. L'animateur corrige d'un geste ce qui est
 * faux, et une valeur corrigee n'est jamais ecrasee par un nouveau calcul.
 *
 * Il faut le dire franchement : ces estimations se trompent. Le tempo se
 * trompe surtout d'octave — un morceau a 87 BPM dont le charley joue en
 * croches se lit 174, et l'inverse — parce que les deux lectures sont
 * egalement vraies pour le signal. La tonalite hesite surtout entre une
 * tonalite et sa relative (do majeur, la mineur), qui partagent toutes leurs
 * notes. C'est pour cela que l'interface propose ×2 et ÷2 a cote du tempo, et
 * que la source « auto » ou « manuel » est toujours affichee.
 *
 * Les fonctions de calcul sont pures (un tableau d'echantillons en entree, un
 * nombre ou un nom en sortie) : elles s'eprouvent sur des signaux synthetiques,
 * sans fichier ni ffmpeg. Seule `analyserFichier` touche au disque.
 */

const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

/** Frequence d'echantillonnage de travail : assez pour la tonalite, peu couteuse. */
const SR = 11025;

/** Ce qu'on ecoute d'un extrait : deux minutes suffisent a tout. */
const DUREE_MAX_S = 120;

/* ------------------------------------------------------------------ */
/* FFT                                                                 */
/* ------------------------------------------------------------------ */

/** Transformee de Fourier rapide, radix 2, en place. `re.length` est une puissance de deux. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));

/**
 * Parcourt le signal par trames et rend le module du spectre de chacune.
 * `rappel(mag, indice)` recoit un tableau reutilise : il ne doit pas le garder.
 */
function spectres(x, taille, pas, rappel) {
  const fenetre = hann(taille);
  const re = new Float64Array(taille);
  const im = new Float64Array(taille);
  const mag = new Float64Array(taille / 2);
  let f = 0;
  for (let debut = 0; debut + taille <= x.length; debut += pas, f++) {
    for (let i = 0; i < taille; i++) {
      re[i] = x[debut + i] * fenetre[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < taille / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    rappel(mag, f);
  }
  return f;
}

/* ------------------------------------------------------------------ */
/* Tempo                                                               */
/* ------------------------------------------------------------------ */

const BPM_MIN = 70;
const BPM_MAX = 180;

/**
 * Le tempo, en battements par minute, ou `null` si le signal n'en dit rien.
 *
 * 1. L'ENVELOPPE D'ATTAQUES : pour chaque trame, la somme des hausses du
 *    spectre (en logarithme) par rapport a la trame precedente. Un coup de
 *    grosse caisse, une note qui commence, font monter cette courbe ; une note
 *    tenue, non. On retire la moyenne locale pour ne garder que les attaques.
 * 2. L'AUTOCORRELATION de cette enveloppe : si les attaques reviennent toutes
 *    les 0,48 s, la courbe ressemble a elle-meme decalee de 0,48 s.
 * 3. LE CHOIX : le decalage le plus ressemblant entre 70 et 180 BPM, pondere
 *    par une preference douce pour les tempos autour de 120. La preference ne
 *    tranche qu'entre des candidats presque egaux — c'est-a-dire entre deux
 *    octaves du meme tempo, la ou le signal ne peut pas trancher seul.
 *
 * Le resultat est arrondi au dixieme ; l'affichage l'arrondit a l'unite.
 */
function estimerBpm(x, sr = SR) {
  if (!x || x.length < sr * 8) return null;
  const taille = 1024;
  const pas = 256;
  const fps = sr / pas;

  const nTrames = Math.floor((x.length - taille) / pas) + 1;
  const flux = new Float64Array(nTrames);
  let avant = null;
  spectres(x, taille, pas, (mag, f) => {
    const log = Float64Array.from(mag, (m) => Math.log1p(100 * m));
    if (avant) {
      let s = 0;
      for (let k = 1; k < log.length; k++) {
        const d = log[k] - avant[k];
        if (d > 0) s += d;
      }
      flux[f] = s;
    }
    avant = log;
  });

  // Moyenne glissante sur une demi-seconde, retiree, puis redressement.
  const demi = Math.max(1, Math.round(fps / 4));
  const attaques = new Float64Array(nTrames);
  let somme = 0;
  for (let i = 0; i < nTrames; i++) {
    somme += flux[i];
    if (i >= 2 * demi + 1) somme -= flux[i - 2 * demi - 1];
    const centre = i - demi;
    if (centre >= 0) {
      const n = Math.min(i + 1, 2 * demi + 1);
      attaques[centre] = Math.max(0, flux[centre] - somme / n);
    }
  }

  const lagMin = Math.floor((60 * fps) / BPM_MAX);
  const lagMax = Math.ceil((60 * fps) / BPM_MIN);
  if (nTrames <= lagMax * 2) return null;

  const ac = new Float64Array(lagMax + 2);
  let energie = 0;
  for (let t = 0; t < nTrames; t++) energie += attaques[t] * attaques[t];
  if (energie <= 1e-9) return null;
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
    let s = 0;
    for (let t = 0; t + lag < nTrames; t++) s += attaques[t] * attaques[t + lag];
    ac[lag] = s / (nTrames - lag);
  }

  const prior = (bpm) => Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.0) ** 2);
  let meilleur = -1;
  let lagChoisi = -1;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    // Un sommet local seulement : sans cette condition, le flanc d'un pic
    // voisin pourrait l'emporter par le seul jeu de la preference.
    if (ac[lag] < ac[lag - 1] || ac[lag] < ac[lag + 1]) continue;
    const bpm = (60 * fps) / lag;
    const score = ac[lag] * prior(bpm);
    if (score > meilleur) {
      meilleur = score;
      lagChoisi = lag;
    }
  }
  if (lagChoisi < 0 || ac[lagChoisi] <= 0) return null;

  /*
   * Affiner la periode.
   *
   * Une trame vaut pres de deux BPM a ces tempos : lu sur le seul premier pic,
   * un morceau a 125 sortait a 124,3 — et s'affichait 124. On lit donc aussi
   * le pic des multiples (2, 3, 4 periodes plus loin), ou la meme erreur d'une
   * trame pese deux, trois, quatre fois moins, et on moyenne les periodes
   * qu'ils donnent. Chaque pic est interpole par une parabole : il tombe
   * rarement pile sur une trame.
   */
  const pic = (centre) => {
    let l = centre;
    for (let d = -2; d <= 2; d++) {
      const k = centre + d;
      if (k > 0 && k < nTrames - 1 && autoc(k) > autoc(l)) l = k;
    }
    const a = autoc(l - 1);
    const b = autoc(l);
    const c = autoc(l + 1);
    const denom = a - 2 * b + c;
    const dec = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
    return { lag: l + Math.max(-0.5, Math.min(0.5, dec)), force: b };
  };
  const memo = new Map();
  function autoc(lag) {
    if (lag < 1 || lag >= nTrames) return 0;
    if (!memo.has(lag)) {
      let s = 0;
      for (let t = 0; t + lag < nTrames; t++) s += attaques[t] * attaques[t + lag];
      memo.set(lag, s / (nTrames - lag));
    }
    return memo.get(lag);
  }
  let poids = 0;
  let periode = 0;
  for (let k = 1; k <= 4; k++) {
    const centre = Math.round(lagChoisi * k);
    if (centre + 3 >= nTrames / 2) break;
    const p = pic(centre);
    // Un multiple qui ne ressemble pas a un pic n'a rien a dire de la periode.
    if (p.force < ac[lagChoisi] * 0.3) continue;
    periode += (p.lag / k) * k;
    poids += k;
  }
  if (!poids) return null;
  const bpm = (60 * fps) / (periode / poids);
  return Math.round(bpm * 10) / 10;
}

/* ------------------------------------------------------------------ */
/* Tonalite                                                            */
/* ------------------------------------------------------------------ */

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Profils de Krumhansl et Kessler : le poids de chaque degre dans une
 * tonalite, mesure aupres d'auditeurs. La tonique pese le plus, puis la
 * quinte et la tierce — et c'est la tierce qui distingue majeur et mineur.
 */
const PROFIL_MAJEUR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROFIL_MINEUR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? NaN : num / Math.sqrt(da * db);
}

/**
 * L'energie de chaque classe de hauteur (do, do#, …), sur tout l'extrait.
 *
 * LA BATTERIE D'ABORD. Un coup de caisse claire ou de charley est un bruit a
 * large bande : il verse de l'energie dans les douze classes a la fois, et un
 * morceau en do diese mineur se lisait mi majeur — sa relative, qui partage
 * toutes ses notes — des qu'une batterie jouait par-dessus. On separe donc
 * l'harmonique du percussif avant de compter, par la methode classique : une
 * mediane glissante DANS LE TEMPS, case de frequence par case de frequence.
 * Une note tenue occupe sa case sur toute la fenetre et survit a la mediane ;
 * une attaque ne l'occupe qu'un instant et disparait.
 *
 * La fenetre mediane fait dix-sept trames, pres de 0,8 s : plus que la duree
 * d'une attaque, moins que la duree d'un accord.
 */
function chroma(x, sr = SR) {
  const taille = 2048;
  const pas = 512;
  const demiFenetre = 8;
  const out = new Float64Array(12);
  const binMin = Math.ceil((60 * taille) / sr);
  const binMax = Math.min(taille / 2 - 1, Math.floor((2100 * taille) / sr));
  const nBins = binMax - binMin + 1;
  const classe = new Int8Array(nBins);
  for (let i = 0; i < nBins; i++) {
    const f = ((binMin + i) * sr) / taille;
    const midi = 69 + 12 * Math.log2(f / 440);
    classe[i] = ((Math.round(midi) % 12) + 12) % 12;
  }

  // Le spectrogramme de la bande utile, trame par trame.
  const trames = [];
  spectres(x, taille, pas, (mag) => {
    trames.push(Float32Array.from({ length: nBins }, (_, i) => mag[binMin + i]));
  });
  const n = trames.length;
  if (!n) return out;

  const fenetre = new Float32Array(2 * demiFenetre + 1);
  for (let b = 0; b < nBins; b++) {
    for (let t = 0; t < n; t++) {
      let k = 0;
      for (let u = Math.max(0, t - demiFenetre); u <= Math.min(n - 1, t + demiFenetre); u++) fenetre[k++] = trames[u][b];
      const vue = fenetre.subarray(0, k).sort();
      const harmonique = vue[k >> 1];
      out[classe[b]] += Math.sqrt(harmonique);
    }
  }
  return out;
}

/**
 * La tonalite, ou `null`.
 *
 * Rend `{ tonique, mode, code, confiance }` : `code` vaut « C#m » pour do
 * diese mineur, « F » pour fa majeur — la notation des logiciels de musique.
 * La confiance est l'ecart entre la meilleure correlation et la suivante :
 * pres de zero, l'estimation hesite, et il vaut mieux le savoir.
 */
function estimerTonalite(x, sr = SR) {
  if (!x || x.length < sr * 4) return null;
  const c = chroma(x, sr);
  if (c.every((v) => v === 0)) return null;
  const essais = [];
  for (let t = 0; t < 12; t++) {
    const tourne = (profil) => Array.from({ length: 12 }, (_, i) => profil[(i - t + 12) % 12]);
    essais.push({ t, mode: 'majeur', r: correlation(c, tourne(PROFIL_MAJEUR)) });
    essais.push({ t, mode: 'mineur', r: correlation(c, tourne(PROFIL_MINEUR)) });
  }
  const valides = essais.filter((e) => Number.isFinite(e.r)).sort((a, b) => b.r - a.r);
  if (!valides.length || valides[0].r < 0.3) return null;
  const [premier, second] = valides;
  const tonique = NOTES[premier.t];
  return {
    tonique,
    mode: premier.mode,
    code: `${tonique}${premier.mode === 'mineur' ? 'm' : ''}`,
    confiance: Math.round((premier.r - (second?.r ?? 0)) * 1000) / 1000,
  };
}

/** « C#m » → « C# minor », « F » → « F major » : la lecture longue, a l'anglaise. */
function nomTonalite(code) {
  const m = /^([A-G]#?)(m?)$/.exec(String(code || ''));
  if (!m) return null;
  return `${m[1]} ${m[2] ? 'minor' : 'major'}`;
}

/**
 * Une tonalite saisie a la main, ramenee a la notation canonique.
 *
 * On accepte ce que les gens ecrivent : « C# minor », « c#m », « Db min »,
 * « F maj », « Am ». Les bemols sont ramenes aux dieses equivalents — Db
 * devient C# —, parce qu'une seule ecriture par tonalite permet de comparer.
 * Rend `null` pour ce qui ne se lit pas.
 */
function lireTonalite(brut) {
  const t = String(brut ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const m = /^([A-Ga-g])\s*([#b♯♭]?)\s*(m|min|minor|mineur|-|maj|major|majeur|M)?$/i.exec(t.replace(/\s/g, ''))
    || /^([A-Ga-g])\s*([#b♯♭]?)\s+(m|min|minor|mineur|maj|major|majeur)$/i.exec(t);
  if (!m) return null;
  const lettre = m[1].toUpperCase();
  const alteration = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
  let i = NOTES.indexOf(lettre);
  if (alteration === '#') i += 1;
  if (alteration === 'b') i -= 1;
  i = ((i % 12) + 12) % 12;
  const suffixe = m[3] ?? '';
  // « M » seul veut dire majeur ; « m » seul, mineur. On ne peut donc pas
  // ignorer la casse sur ce caractere-la.
  const mineur = suffixe === 'm' || suffixe === '-' || /^(min|minor|mineur)$/i.test(suffixe);
  return `${NOTES[i]}${mineur ? 'm' : ''}`;
}

/* ------------------------------------------------------------------ */
/* Fichier                                                             */
/* ------------------------------------------------------------------ */

/**
 * Analyse un extrait stocke : le copie, le decode en mono 11 kHz, et calcule.
 *
 * Rend `{ bpm, tonalite }`, chacun pouvant etre `null`. Echoue si ffmpeg ne
 * sait pas lire le fichier — l'appelant marque alors l'analyse en echec, et
 * l'animateur saisit les valeurs a la main.
 */
async function analyserFichier(storageKey, { storage, run, pipeToFile, ffmpeg }) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'arena-analyse-'));
  try {
    const entree = path.join(dir, 'extrait');
    await pipeToFile(storage.createReadStream(storageKey), entree);
    const pcm = await run(ffmpeg, [
      '-v', 'error', '-nostdin',
      '-i', entree,
      '-t', String(DUREE_MAX_S),
      '-map', '0:a:0', '-vn',
      '-ac', '1', '-ar', String(SR),
      '-f', 'f32le', '-',
    ], { binary: true, timeoutMs: 120000 });
    const x = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
    const tonalite = estimerTonalite(x, SR);
    return { bpm: estimerBpm(x, SR), tonalite: tonalite?.code ?? null };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  SR, NOTES, BPM_MIN, BPM_MAX,
  fft, estimerBpm, chroma, estimerTonalite, nomTonalite, lireTonalite,
  analyserFichier,
};
