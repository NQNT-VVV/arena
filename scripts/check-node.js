#!/usr/bin/env node
'use strict';

/**
 * Controle de version, avant tout le reste.
 *
 * `better-sqlite3` est un module natif : son binaire est compile pour une
 * version precise de l'interface C++ de Node. Lance sous une autre version, il
 * echoue avec une trace illisible qui parle de NODE_MODULE_VERSION et ne dit
 * nulle part quoi faire. Ce fichier attrape le cas avant, et repond en francais.
 *
 * Volontairement sans aucune dependance et en JavaScript ancien : il doit
 * pouvoir s'executer sous la mauvaise version de Node, justement.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');

var REQUIRED_MAJOR = 22;
var major = Number(process.versions.node.split('.')[0]);

if (major >= REQUIRED_MAJOR) process.exit(0);

/** Version demandee par .nvmrc, quand le fichier existe. */
function pinnedMajor() {
  try {
    var raw = fs.readFileSync(path.join(__dirname, '..', '.nvmrc'), 'utf8').trim();
    var m = Number(String(raw).replace(/^v/, '').split('.')[0]);
    return Number.isFinite(m) ? m : null;
  } catch (err) {
    return null;
  }
}

/**
 * Le Node deja installe par nvm le plus adapte.
 *
 * La version epinglee dans .nvmrc passe avant la plus recente : le binaire
 * natif de la base est compile pour une interface C++ precise, et proposer un
 * Node 25 quand le paquet n'a de binaire que pour la 22 ne ferait que deplacer
 * la meme erreur d'un cran.
 */
function findNvmNode() {
  var dir = path.join(os.homedir(), '.nvm', 'versions', 'node');
  var pinned = pinnedMajor();
  var candidates = [];

  try {
    fs.readdirSync(dir).forEach(function (name) {
      var parts = String(name).replace(/^v/, '').split('.').map(Number);
      if (!(parts[0] >= REQUIRED_MAJOR)) return;
      var bin = path.join(dir, name, 'bin');
      if (!fs.existsSync(path.join(bin, 'node'))) return;
      candidates.push({ name: name, bin: bin, parts: parts });
    });
  } catch (err) { /* pas de nvm : on s'en passe */ }

  if (!candidates.length) return null;

  candidates.sort(function (a, b) {
    // La version epinglee d'abord, puis la plus recente — en comparant des
    // nombres : un tri de chaines placerait « v9 » apres « v22 ».
    var aPinned = pinned !== null && a.parts[0] === pinned;
    var bPinned = pinned !== null && b.parts[0] === pinned;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    for (var i = 0; i < 3; i++) {
      if ((b.parts[i] || 0) !== (a.parts[i] || 0)) return (b.parts[i] || 0) - (a.parts[i] || 0);
    }
    return 0;
  });

  return candidates[0];
}

var nvm = findNvmNode();
var lines = [];

lines.push('');
lines.push('  Arena a besoin de Node ' + REQUIRED_MAJOR + ' ou plus recent.');
lines.push('  Version en cours : ' + process.version + ' (interface native ' + process.versions.modules + ').');
lines.push('');

if (nvm) {
  lines.push('  Node ' + nvm.name + ' est deja installe. Pour cette session :');
  lines.push('');
  lines.push('      export PATH="' + nvm.bin + ':$PATH"');
  lines.push('');
  lines.push('  Ou, si nvm est charge dans ce shell :');
  lines.push('');
  lines.push('      nvm use');
  lines.push('');
  lines.push('  Si « nvm : commande introuvable » alors que ~/.nvm existe, c’est que');
  lines.push('  votre shell de connexion ne lit pas ~/.bashrc. Pour le reparer une');
  lines.push('  bonne fois, sur tous vos projets :');
  lines.push('');
  lines.push('      printf \'\\nif [ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi\\n\' >> ~/.profile');
  lines.push('');
  lines.push('  puis rouvrez le terminal.');
} else {
  lines.push('  Installez Node ' + REQUIRED_MAJOR + ', par exemple avec nvm :');
  lines.push('');
  lines.push('      nvm install 22 && nvm use');
}

lines.push('');
lines.push('  Pourquoi : la base est un module natif, compile pour une version');
lines.push('  precise de Node. C’est aussi la version de l’image Docker, ce qui');
lines.push('  garde le developpement et la production sur le meme terrain.');
lines.push('');

process.stderr.write(lines.join('\n') + '\n');
process.exit(1);
