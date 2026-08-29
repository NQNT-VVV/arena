'use strict';

/**
 * Types de fichiers : reconnaissance, et surtout ce qu'on accepte d'afficher.
 *
 * Le point sensible n'est pas de deviner juste, c'est de ne jamais servir un
 * fichier depose par un tiers avec un type qui permette au navigateur de
 * l'executer sur notre origine. Un « .png » qui contient du HTML doit sortir en
 * telechargement, pas s'afficher dans la page.
 */

const path = require('path');

/**
 * Signatures binaires.
 *
 * On reconnait le contenu plutot que l'extension : l'extension est choisie par
 * la personne qui televerse, les premiers octets non.
 */
const SIGNATURES = [
  { mime: 'image/jpeg', kind: 'image', ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', kind: 'image', ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', kind: 'image', ext: '.gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/bmp', kind: 'image', ext: '.bmp', bytes: [0x42, 0x4d] },
  { mime: 'application/pdf', kind: 'other', ext: '.pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'audio/mpeg', kind: 'audio', ext: '.mp3', bytes: [0x49, 0x44, 0x33] },            // ID3
  { mime: 'audio/mpeg', kind: 'audio', ext: '.mp3', bytes: [0xff, 0xfb] },                  // trame MPEG
  { mime: 'audio/mpeg', kind: 'audio', ext: '.mp3', bytes: [0xff, 0xf3] },
  { mime: 'audio/mpeg', kind: 'audio', ext: '.mp3', bytes: [0xff, 0xf2] },
  { mime: 'audio/aac', kind: 'audio', ext: '.aac', bytes: [0xff, 0xf1] },
  { mime: 'audio/aac', kind: 'audio', ext: '.aac', bytes: [0xff, 0xf9] },
  { mime: 'audio/flac', kind: 'audio', ext: '.flac', bytes: [0x66, 0x4c, 0x61, 0x43] },
  { mime: 'audio/midi', kind: 'other', ext: '.mid', bytes: [0x4d, 0x54, 0x68, 0x64] },
  { mime: 'application/zip', kind: 'other', ext: '.zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'application/x-7z-compressed', kind: 'other', ext: '.7z', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { mime: 'application/x-rar-compressed', kind: 'other', ext: '.rar', bytes: [0x52, 0x61, 0x72, 0x21] },
];

/**
 * Conteneurs dont la signature n'est pas au tout debut, ou ambigue.
 *
 * Chaque motif porte sa propre longueur minimale : « OggS » se reconnait en
 * quatre octets, un « ftyp » en douze. Un seuil unique pour tous ferait passer
 * les premiers pour du texte.
 */
function sniffContainers(head) {
  const ascii = (start, len) => (head.length >= start + len ? head.slice(start, start + len).toString('latin1') : '');

  // RIFF....WAVE / RIFF....AVI  et  OggS  et  ftyp (ISO base media)
  if (ascii(0, 4) === 'RIFF') {
    const form = ascii(8, 4);
    if (form === 'WAVE') return { mime: 'audio/wav', kind: 'audio', ext: '.wav' };
    if (form === 'AVI ') return { mime: 'video/x-msvideo', kind: 'video', ext: '.avi' };
    if (form === 'WEBP') return { mime: 'image/webp', kind: 'image', ext: '.webp' };
  }
  if (ascii(0, 4) === 'FORM' && ascii(8, 4).startsWith('AIF')) {
    return { mime: 'audio/aiff', kind: 'audio', ext: '.aiff' };
  }
  if (ascii(0, 4) === 'OggS') return { mime: 'audio/ogg', kind: 'audio', ext: '.ogg' };
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'M4A ' || brand === 'M4B ') return { mime: 'audio/mp4', kind: 'audio', ext: '.m4a' };
    if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', kind: 'image', ext: '.avif' };
    if (brand === 'qt  ') return { mime: 'video/quicktime', kind: 'video', ext: '.mov' };
    return { mime: 'video/mp4', kind: 'video', ext: '.mp4' };
  }
  // Matroska et WebM partagent l'en-tete EBML ; seul le contenu les distingue,
  // et ffmpeg s'en chargera. On les traite comme de la video.
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return { mime: 'video/webm', kind: 'video', ext: '.webm' };
  }
  return null;
}

/** Repli par extension, quand les octets ne disent rien de reconnaissable. */
const BY_EXTENSION = {
  '.mp3': ['audio/mpeg', 'audio'], '.wav': ['audio/wav', 'audio'], '.flac': ['audio/flac', 'audio'],
  '.m4a': ['audio/mp4', 'audio'], '.aac': ['audio/aac', 'audio'], '.ogg': ['audio/ogg', 'audio'],
  '.opus': ['audio/ogg', 'audio'], '.aiff': ['audio/aiff', 'audio'], '.aif': ['audio/aiff', 'audio'],
  '.png': ['image/png', 'image'], '.jpg': ['image/jpeg', 'image'], '.jpeg': ['image/jpeg', 'image'],
  '.gif': ['image/gif', 'image'], '.webp': ['image/webp', 'image'], '.avif': ['image/avif', 'image'],
  '.svg': ['image/svg+xml', 'other'],   // jamais « image » : un SVG execute du script
  '.mp4': ['video/mp4', 'video'], '.mov': ['video/quicktime', 'video'], '.webm': ['video/webm', 'video'],
  '.mkv': ['video/x-matroska', 'video'], '.avi': ['video/x-msvideo', 'video'], '.m4v': ['video/mp4', 'video'],
  '.txt': ['text/plain', 'text'], '.md': ['text/plain', 'text'], '.rtf': ['application/rtf', 'other'],
  '.pdf': ['application/pdf', 'other'], '.zip': ['application/zip', 'other'],
};

/** Extension nettoyee d'un nom de fichier : minuscule, alphanumerique, courte. */
function safeExtension(filename) {
  const raw = path.extname(String(filename || '')).toLowerCase();
  const clean = raw.replace(/[^a-z0-9.]/g, '');
  return /^\.[a-z0-9]{1,8}$/.test(clean) ? clean : '';
}

/**
 * Identifie un fichier a partir de ses premiers octets et de son nom.
 * `kind` pilote l'affichage : audio, image, video, text, other.
 */
function identify(head, filename) {
  const buf = Buffer.isBuffer(head) ? head : Buffer.alloc(0);

  for (const sig of SIGNATURES) {
    if (buf.length < sig.bytes.length) continue;
    if (sig.bytes.every((b, i) => buf[i] === b)) {
      return { mime: sig.mime, kind: sig.kind, ext: sig.ext, source: 'bytes' };
    }
  }

  const container = buf.length >= 4 ? sniffContainers(buf) : null;
  if (container) return { ...container, source: 'bytes' };

  const ext = safeExtension(filename);

  // Du texte lisible reste du texte, meme sans extension — sauf s'il s'agit de
  // balisage. Un SVG ou une page HTML sont du texte au sens strict, mais les
  // afficher n'a aucun sens ici et les servir avec leur vrai type en aurait
  // encore moins : ils repartent en telechargement.
  if (buf.length && isProbablyText(buf)) {
    if (isMarkup(buf)) return { mime: 'application/octet-stream', kind: 'other', ext, source: 'bytes' };
    return { mime: 'text/plain', kind: 'text', ext: ext || '.txt', source: 'bytes' };
  }

  const known = BY_EXTENSION[ext];
  if (known) return { mime: known[0], kind: known[1], ext, source: 'extension' };

  return { mime: 'application/octet-stream', kind: 'other', ext, source: 'extension' };
}

/** Debut de document balise : XML, SVG, HTML. */
function isMarkup(buf) {
  const head = buf.slice(0, 256).toString('latin1').trimStart().toLowerCase();
  return head.startsWith('<?xml')
    || head.startsWith('<svg')
    || head.startsWith('<html')
    || head.startsWith('<!doctype')
    || head.startsWith('<head')
    || head.startsWith('<script');
}

function isProbablyText(buf) {
  const sample = buf.slice(0, 512);
  let suspicious = 0;
  for (const byte of sample) {
    // Octets de controle hors tabulation, saut de ligne et retour chariot.
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte === 127) suspicious++;
  }
  return suspicious / Math.max(1, sample.length) < 0.02;
}

/**
 * Types qu'on accepte d'afficher directement dans la page.
 *
 * Liste blanche, jamais liste noire. Tout ce qui n'y figure pas sort en
 * `application/octet-stream` avec une entete de telechargement : c'est ce qui
 * empeche un fichier hostile de s'executer sur notre origine, quelle que soit
 * l'extension qu'on lui a donnee.
 */
const INLINE_SAFE = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
  'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/aiff',
  'video/mp4', 'video/webm', 'video/quicktime',
  'text/plain',
]);

/**
 * Affichable dans la page ?
 *
 * Deux conditions, et la seconde compte autant que la premiere : le type doit
 * figurer dans la liste blanche, **et** avoir ete etabli par les octets. Un
 * verdict tire de l'extension vient de la personne qui televerse ; le croire
 * reviendrait a la laisser choisir l'entete `Content-Type` que nous servons
 * depuis notre propre origine.
 *
 * Concretement : du HTML renomme « photo.png » repart en telechargement.
 */
function canDisplayInline(identity) {
  if (!identity) return false;
  return identity.source === 'bytes' && INLINE_SAFE.has(identity.mime);
}

module.exports = { identify, safeExtension, canDisplayInline, INLINE_SAFE };
