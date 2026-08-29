'use strict';

/**
 * Reception de fichiers, en flux.
 *
 * Rien n'est mis en memoire : les octets vont du reseau au stockage sans
 * escale. Un pack de rushes de deux gigaoctets ne doit pas faire grossir le
 * process d'un seul mega-octet — a deux participants qui televersent en meme
 * temps, la mise en tampon suffirait a tuer le serveur.
 *
 * Le plafond de taille est applique **pendant** le flux : au-dela, busboy cesse
 * d'alimenter le fichier et termine son flux. Ce qui a deja touche le disque
 * est efface avant de repondre.
 */

const busboy = require('busboy');

class UploadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UploadError';
    this.expected = true;
  }
}

/**
 * @param req              requete HTTP entrante
 * @param maxFiles         nombre de fichiers acceptes dans cette requete
 * @param maxBytes         plafond par fichier
 * @param maxTotalBytes    plafond cumule
 * @param onFile           ({stream, filename, mimeHint}) -> enregistrement ecrit
 * @param cleanup          appele avec les enregistrements deja ecrits, en cas d'echec
 */
function receiveFiles(req, { maxFiles = 1, maxBytes, maxTotalBytes = Infinity, onFile, cleanup } = {}) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({
        headers: req.headers,
        limits: {
          files: maxFiles,
          fileSize: maxBytes,
          fields: 24,
          fieldSize: 64 * 1024,
          fieldNameSize: 120,
        },
      });
    } catch {
      reject(new UploadError('Requete de televersement invalide.'));
      return;
    }

    const fields = Object.create(null);
    const tasks = [];
    const written = [];
    let total = 0;
    let firstError = null;
    let settled = false;

    /**
     * Enregistre le refus, sans interrompre la lecture.
     *
     * On ne debranche pas la requete et on ne detruit pas les flux : busboy
     * tronque de lui-meme le fichier en trop, termine son flux, puis absorbe le
     * reste du corps avant d'annoncer la fin. Couper court priverait busboy de
     * la frontiere multipart qu'il attend — le flux ne se terminerait jamais,
     * l'ecriture non plus, et la requete resterait pendante jusqu'a expiration.
     * C'est exactement le blocage que cette version evite.
     *
     * Le cout est de laisser arriver des octets dont on ne veut pas. Ils sont
     * jetes au fil de l'eau, jamais accumules, et le vrai garde-fou contre un
     * corps demesure est ailleurs : la limite de taille du serveur frontal.
     */
    const fail = (err) => {
      if (!firstError) firstError = err instanceof Error ? err : new UploadError(String(err));
    };

    bb.on('field', (name, value) => { fields[name] = value; });

    bb.on('file', (name, stream, info) => {
      // Un refus deja acte : on vide le flux sans rien ecrire.
      if (firstError) { stream.resume(); return; }

      let truncated = false;
      stream.on('limit', () => {
        truncated = true;
        fail(new UploadError(`« ${info.filename || 'ce fichier'} » depasse la taille autorisee.`));
      });

      const task = Promise.resolve()
        .then(() => onFile({ stream, field: name, filename: info.filename, mimeHint: info.mimeType }))
        .then((record) => {
          // Meme tronque, l'enregistrement est collecte : c'est ce qui permet
          // au nettoyage d'effacer le fragment ecrit sur le disque.
          if (record) written.push(record);
          if (truncated || firstError) return;
          total += record?.bytes ?? 0;
          if (total > maxTotalBytes) fail(new UploadError('Le poids total depasse la limite autorisee.'));
        })
        .catch(fail);

      tasks.push(task);
    });

    bb.on('filesLimit', () => fail(new UploadError(
      maxFiles === 1 ? 'Un seul fichier a la fois.' : `Pas plus de ${maxFiles} fichiers a la fois.`,
    )));
    bb.on('error', fail);
    req.on('error', fail);

    const finish = async () => {
      if (settled) return;
      settled = true;
      // On attend la fin des ecritures avant de conclure, y compris en cas
      // d'echec : nettoyer pendant qu'une ecriture est en cours laisserait le
      // fichier reapparaitre juste apres.
      await Promise.allSettled(tasks);
      if (firstError) {
        if (cleanup) await Promise.resolve(cleanup(written)).catch(() => {});
        reject(firstError);
        return;
      }
      resolve({ files: written, fields });
    };

    bb.on('close', finish);
    // Filet : si le client raccroche en cours de route, busboy peut ne jamais
    // annoncer sa fin. `settled` empeche la double conclusion.
    req.on('aborted', () => { fail(new UploadError('Televersement interrompu.')); finish(); });

    req.pipe(bb);
  });
}

module.exports = { receiveFiles, UploadError };
