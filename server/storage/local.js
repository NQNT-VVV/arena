'use strict';

/**
 * Stockage sur disque local.
 *
 * Driver par defaut. Il n'expose aucune URL : les fichiers sortent par la route
 * `/api/media`, qui verifie la phase de la session avant de servir quoi que ce
 * soit. Un dossier statique servi directement par Express contournerait cette
 * verification et rendrait chaque rendu accessible a qui devine son
 * identifiant, y compris pendant la diffusion anonyme.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { pipeline } = require('stream/promises');

const config = require('../config');

const ROOT = path.resolve(config.storage.localDir);
fs.mkdirSync(ROOT, { recursive: true });

/**
 * Chemin absolu d'une clef, avec refus de sortir du dossier.
 *
 * Une clef arrive parfois d'un identifiant reconstruit ailleurs dans le code ;
 * une seule concatenation distraite suffirait a ecrire hors du volume.
 */
function resolveKey(key) {
  const clean = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const full = path.resolve(ROOT, clean);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    throw new Error(`Clef de stockage hors du volume : ${key}`);
  }
  return full;
}

module.exports = {
  name: 'local',

  async put(key, readable) {
    const full = resolveKey(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    // Ecriture sous un nom temporaire puis renommage : un televersement
    // interrompu ne laisse pas un fichier tronque a la place du bon. Et si
    // l'ecriture echoue, le fragment part avec elle — sinon un depot refuse
    // laisserait sur le volume des octets que plus rien ne reference.
    const tmp = `${full}.part`;
    try {
      await pipeline(readable, fs.createWriteStream(tmp));
      await fsp.rename(tmp, full);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
    const { size } = await fsp.stat(full);
    return { key, bytes: size };
  },

  async putBuffer(key, buffer) {
    const full = resolveKey(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, buffer);
    return { key, bytes: buffer.length };
  },

  /** Flux de lecture, avec support des requetes partielles (seek audio/video). */
  createReadStream(key, opts = {}) {
    return fs.createReadStream(resolveKey(key), opts);
  },

  async stat(key) {
    try {
      const s = await fsp.stat(resolveKey(key));
      return { bytes: s.size, modifiedAt: s.mtimeMs };
    } catch {
      return null;
    }
  },

  async remove(key) {
    await fsp.rm(resolveKey(key), { force: true });
  },

  async removePrefix(prefix) {
    await fsp.rm(resolveKey(prefix), { recursive: true, force: true });
  },

  /** Chemin absolu sur le disque : reserve a ffmpeg, jamais expose au reseau. */
  localPath(key) {
    return resolveKey(key);
  },

  /**
   * URL directe. `null` en local : c'est l'application qui sert les octets.
   * Le driver S3 renverra ici une URL signee de courte duree.
   */
  async signedUrl() {
    return null;
  },
};
