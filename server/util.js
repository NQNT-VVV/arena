'use strict';

const crypto = require('crypto');

/**
 * Alphabet des codes de session.
 *
 * Ni I ni 1, ni O ni 0 : un code se dicte a voix haute dans un salon vocal, et
 * se recopie depuis une photo d'ecran de television. Les paires ambigues
 * coutent plus cher que les six caracteres qu'elles feraient gagner.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** Code libre, avec abandon si le hasard s'acharne. */
function uniqueCode(isTaken, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const code = randomCode();
    if (!isTaken(code)) return code;
  }
  throw new Error('Impossible de tirer un code de session libre.');
}

const uuid = () => crypto.randomUUID();

/** Jeton porteur remis au client. Seule son empreinte est conservee. */
const newToken = () => crypto.randomBytes(32).toString('base64url');

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * Comparaison a duree constante.
 *
 * Un `===` sur des empreintes laisse fuir, par le temps de reponse, le nombre
 * de caracteres corrects. C'est theorique sur un reseau, gratuit a eviter.
 */
function tokenMatches(token, hash) {
  if (!token || !hash) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(String(hash));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const AVATARS = [
  '\u{1F3A7}', '\u{1F3A8}', '\u{1F3AC}', '\u{270D}\u{FE0F}', '\u{1F3B9}',
  '\u{1F58C}\u{FE0F}', '\u{1F4F8}', '\u{1F3A4}', '\u{1F579}\u{FE0F}', '\u{1F9E9}',
  '\u{1F525}', '\u{26A1}', '\u{1F308}', '\u{1F680}', '\u{1F48E}',
  '\u{1F98A}', '\u{1F419}', '\u{1F41D}', '\u{1F98B}', '\u{1F335}',
  '\u{1F355}', '\u{1F47D}', '\u{1F916}', '\u{1F47E}', '\u{1F984}',
  '\u{1F43A}', '\u{1F985}', '\u{1F42C}', '\u{1F319}', '\u{2604}\u{FE0F}',
];

/** Un avatar different des voisins tant qu'il en reste de libres. */
function pickAvatar(taken) {
  const free = AVATARS.filter((a) => !taken.has(a));
  const pool = free.length ? free : AVATARS;
  return pool[crypto.randomInt(pool.length)];
}

/** Caracteres de controle : jamais rien de legitime dans une saisie. */
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Caracteres de largeur nulle et marques de sens d'ecriture.
 *
 * Retires explicitement : sans cela deux participants peuvent porter un pseudo
 * visuellement identique, ce qui n'est pas une farce anodine quand un
 * classement est en jeu.
 */
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/g;

function cleanPseudo(raw, max = 22) {
  return String(raw ?? '')
    .replace(CONTROL, '')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Texte long : on garde les retours a la ligne, on jette le reste. */
function cleanText(raw, max) {
  return String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .replace(CONTROL, '')
    .replace(INVISIBLE, '')
    .trim()
    .slice(0, max);
}

/**
 * Nom de fichier affichable et sans danger.
 *
 * On garde le nom d'origine — un participant doit reconnaitre « 01-kick.wav »
 * dans la liste — mais debarrasse de tout ce qui pourrait etre interprete comme
 * un chemin. Le nom ne sert jamais de clef de stockage : celle-ci est un
 * identifiant tire au hasard.
 */
function safeFilename(raw, max = 120) {
  const base = String(raw ?? '').split(/[\\/]/).pop() || '';
  return base
    .replace(CONTROL, '')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || 'fichier';
}

/** Melange de Fisher-Yates, avec une source aleatoire cryptographique. */
function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

module.exports = {
  CODE_ALPHABET, CODE_LENGTH,
  randomCode, uniqueCode, uuid, newToken, hashToken, tokenMatches,
  AVATARS, pickAvatar, cleanPseudo, cleanText, safeFilename, shuffle, clamp,
};
