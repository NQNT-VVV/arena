/**
 * Reconnaissance de type, et surtout refus d'affichage.
 *
 * Ces cas ne sont pas theoriques : un fichier televerse par un participant est
 * servi depuis notre propre origine. Laisser un « .png » qui contient du HTML
 * s'afficher avec un type que le navigateur accepte d'interpreter, c'est offrir
 * l'execution de script a toute la session.
 *
 * La regle verifiee ici : un type ne devient affichable que s'il a ete etabli
 * par les octets. Une extension est choisie par celui qui televerse.
 */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const mime = require('../server/mime.js');

const raw = (s) => Buffer.from(s, 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const riff = (form) => Buffer.concat([raw('RIFF'), Buffer.alloc(4), raw(form)]);
const ftyp = (brand) => Buffer.concat([Buffer.alloc(4), raw('ftyp'), raw(brand)]);

const CASES = [
  ['PNG reconnu par ses octets', PNG, 'photo.bin', 'image', true],
  ['WAV', riff('WAVE'), 'x', 'audio', true],
  ['WEBP', riff('WEBP'), 'x', 'image', true],
  ['AVIF', ftyp('avif'), 'x', 'image', true],
  ['MP4', ftyp('isom'), 'x', 'video', true],
  ['QuickTime', ftyp('qt  '), 'x', 'video', true],
  ['M4A', ftyp('M4A '), 'x', 'audio', true],
  ['AIFF', Buffer.concat([raw('FORM'), Buffer.alloc(4), raw('AIFF')]), 'x', 'audio', true],
  ['AAC brut', Buffer.from([0xff, 0xf1, 0, 0]), 'x', 'audio', true],
  ['MP3 avec tag ID3', raw('ID3xxxx'), 'son', 'audio', true],
  ['FLAC', raw('fLaC0000'), 'x', 'audio', true],
  ['Ogg', raw('OggS0000'), 'x', 'audio', true],
  ['Matroska', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]), 'x', 'video', true],
  ['texte sans extension', raw('Il etait une fois un texte.'), 'poeme', 'text', true],

  // Ce qui ne doit jamais s'afficher.
  ['SVG (peut porter du script)', raw('<svg onload=alert(1)>'), 'image.svg', 'other', false],
  ['HTML renomme en .png', raw('<html><script>alert(1)</script>'), 'innocent.png', 'other', false],
  ['XML renomme en .jpg', raw('<?xml version="1.0"?><a/>'), 'x.jpg', 'other', false],
  ['binaire inconnu', Buffer.from([0x00, 0x01, 0x02, 0xfe, 0xff, 0x7f, 0x00, 0x03]), 'truc.bin', 'other', false],
  ['archive ZIP', raw('PK\x03\x04....'), 'pack.zip', 'other', false],
  ['PDF', raw('%PDF-1.7'), 'doc.pdf', 'other', false],
];

let passed = 0;
let failed = 0;

for (const [label, head, filename, wantKind, wantInline] of CASES) {
  try {
    const id = mime.identify(head, filename);
    assert.equal(id.kind, wantKind, `type attendu « ${wantKind} », obtenu « ${id.kind} » (${id.mime})`);
    assert.equal(mime.canDisplayInline(id), wantInline, `affichage en ligne attendu ${wantInline}`);
    passed++;
    console.log(`  ok   ${label}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${label}\n       ${err.message}`);
  }
}

/** Une extension ne doit jamais suffire a rendre un fichier affichable. */
try {
  const byExtensionOnly = mime.identify(Buffer.alloc(0), 'rush.mov');
  assert.equal(byExtensionOnly.source, 'extension');
  assert.equal(mime.canDisplayInline(byExtensionOnly), false, 'une extension seule ne rend rien affichable');
  passed++;
  console.log('  ok   extension seule : reconnue, mais pas affichable');
} catch (err) {
  failed++;
  console.error(`  FAIL extension seule\n       ${err.message}`);
}

/** Les extensions traversantes sont rejetees avant d'atteindre le disque. */
try {
  assert.equal(mime.safeExtension('truc.../../etc/passwd'), '');
  assert.equal(mime.safeExtension('a.superlongueextension'), '');
  assert.equal(mime.safeExtension('SON.MP3'), '.mp3');
  passed++;
  console.log('  ok   extensions nettoyees');
} catch (err) {
  failed++;
  console.error(`  FAIL extensions nettoyees\n       ${err.message}`);
}

console.log(`\n${passed}/${passed + failed} verifications passees`);
if (failed) process.exitCode = 1;
