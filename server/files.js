'use strict';

/**
 * Service des fichiers stockes.
 *
 * Passe par ici tout ce qui a ete depose par un humain : assets de l'animateur,
 * rendus des participants. Deux raisons de ne jamais exposer un dossier
 * statique a la place :
 *
 *   1. La phase de la session conditionne l'acces. Un dossier servi par le
 *      serveur web ne sait rien des phases.
 *   2. Les entetes sont decidees ici, pour tous les fichiers, sans exception
 *      possible — c'est ce qui empeche un fichier hostile de s'executer sur
 *      notre origine.
 */

const mime = require('./mime');
const storage = require('./storage');

/**
 * Nom de fichier utilisable dans une entete.
 *
 * On envoie les deux formes prevues par la norme : une version reduite a
 * l'ASCII pour les clients anciens, et la version complete encodee. Sans la
 * premiere, un accent dans un nom de sample casse l'entete entiere.
 */
function contentDisposition(kind, filename) {
  const fallback = String(filename || 'fichier')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .slice(0, 120) || 'fichier';
  const encoded = encodeURIComponent(String(filename || 'fichier')).slice(0, 240);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** `bytes=0-1023` et ses variantes. Une seule plage : le multipart n'apporte rien ici. */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;
  if (rawStart === '') {
    // Suffixe : « les N derniers octets ».
    const length = Number(rawEnd);
    if (!Number.isFinite(length) || length <= 0) return null;
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return { unsatisfiable: true };
  return { start, end: Math.min(end, size - 1) };
}

/**
 * Envoie un fichier du stockage.
 *
 * Gere les requetes partielles : sans elles, impossible de deplacer le curseur
 * dans un extrait audio ou video, et Safari refuse purement et simplement de
 * lire une source qui n'annonce pas `Accept-Ranges`.
 */
async function sendStored(req, res, { key, filename, identity, forceDownload = false, cacheSeconds = 0 }) {
  const stat = await storage.stat(key);
  if (!stat) {
    res.status(404).type('text/plain').send('Fichier introuvable.');
    return;
  }

  const inline = !forceDownload && mime.canDisplayInline(identity);
  const type = inline ? identity.mime : 'application/octet-stream';

  res.set({
    'Content-Type': type,
    // Interdit au navigateur de deviner un type plus permissif que celui-ci.
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', filename),
    // Prive : ces fichiers ne doivent pas finir dans un cache partage.
    'Cache-Control': cacheSeconds > 0 ? `private, max-age=${cacheSeconds}` : 'private, no-store',
    'Last-Modified': new Date(stat.modifiedAt).toUTCString(),
    ETag: `"${Buffer.from(`${key}:${stat.bytes}:${Math.round(stat.modifiedAt)}`).toString('base64url')}"`,
  });

  if (req.headers['if-none-match'] === res.get('ETag')) {
    res.status(304).end();
    return;
  }

  if (req.method === 'HEAD') {
    res.set('Content-Length', String(stat.bytes)).status(200).end();
    return;
  }

  const range = parseRange(req.headers.range, stat.bytes);
  if (range?.unsatisfiable) {
    res.set('Content-Range', `bytes */${stat.bytes}`).status(416).end();
    return;
  }

  if (range) {
    const length = range.end - range.start + 1;
    res.set({
      'Content-Range': `bytes ${range.start}-${range.end}/${stat.bytes}`,
      'Content-Length': String(length),
    }).status(206);
    storage.createReadStream(key, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  res.set('Content-Length', String(stat.bytes)).status(200);
  storage.createReadStream(key).pipe(res);
}

/**
 * Premiers octets d'un fichier stocke.
 *
 * Sert a identifier le contenu reel apres ecriture. On lit apres coup plutot
 * que d'intercepter le flux pendant le televersement : cela evite de mettre en
 * tampon le premier morceau de chaque fichier, pour une lecture de quatre
 * kilo-octets qui ne coute rien.
 */
function readHead(key, length = 4096) {
  return new Promise((resolve) => {
    const chunks = [];
    let stream;
    try {
      stream = storage.createReadStream(key, { start: 0, end: length - 1 });
    } catch {
      resolve(Buffer.alloc(0));
      return;
    }
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', () => resolve(Buffer.alloc(0)));
  });
}

module.exports = { sendStored, parseRange, contentDisposition, readHead };
