'use strict';

/**
 * API HTTP.
 *
 * Tout ce qui ne passe pas par la socket : sante, carte de visite d'une
 * session, QR, et surtout les fichiers — televersement, service et pack. Le
 * temps reel porte les etats, HTTP porte les octets.
 */

const QRCode = require('qrcode');
const { ZipArchive } = require('archiver');

const config = require('./config');
const files = require('./files');
const mime = require('./mime');
const repo = require('./repo');
const storage = require('./storage');
const views = require('./views');
const { receiveFiles, UploadError } = require('./upload');
const { uuid, safeFilename, cleanText, verifyMedia } = require('./util');
const { BattleServer } = require('./battle');

/**
 * Jeton porteur.
 *
 * Dans une entete, jamais dans l'URL : une URL se retrouve dans les journaux
 * du serveur, dans l'historique du navigateur et dans l'entete `Referer`.
 */
const tokenOf = (req) => String(req.get('X-Arena-Token') || '').trim();
const participantOf = (req) => String(req.get('X-Arena-Participant') || '').trim();

/** Enveloppe : une erreur attendue devient un refus lisible, le reste un 500 muet. */
const guard = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    if (err && err.expected) {
      res.status(err instanceof UploadError ? 413 : (err.status || 409)).json({ error: err.message });
      return;
    }
    console.error('[arena] api :', err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
};

function mount(app, battle) {
  /* ---------------------------------------------------------------- */
  /* Etat du service                                                   */
  /* ---------------------------------------------------------------- */

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      sessions: battle.sessions.size,
      storage: storage.name,
      uptime: Math.round(process.uptime()),
    });
  });

  /**
   * Carte de visite, avant d'entrer.
   *
   * Assez pour verifier qu'on ne s'est pas trompe de code. Ni la consigne, ni
   * les elements, ni la liste des presents : tout cela s'obtient une fois entre.
   */
  app.get('/api/session/:code', (req, res) => {
    const s = battle.get(req.params.code);
    if (!s) return res.status(404).json({ exists: false });
    res.json({
      exists: true,
      code: s.code,
      name: s.name,
      mediaType: s.mediaType,
      phase: s.phase,
      open: BattleServer.JOINABLE.has(s.phase),
      participants: s.participants.size,
    });
  });

  app.get('/api/qr', guard(async (req, res) => {
    const text = String(req.query.text || '').slice(0, 512);
    if (!text) return res.status(400).send('parametre « text » manquant');
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: String(req.query.dark || '#07060E'), light: String(req.query.light || '#FFFFFF') },
    });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  }));

  /** Lien court d'invitation. */
  app.get('/j/:code', (req, res) => {
    res.redirect(`/play?code=${encodeURIComponent(String(req.params.code).toUpperCase())}`);
  });

  /* ---------------------------------------------------------------- */
  /* Elements imposes                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Depot d'elements par l'animateur.
   *
   * Les octets vont du reseau au stockage sans passer par la memoire, et les
   * plafonds — nombre et poids cumule — sont appliques pendant le flux. Un
   * depassement interrompt la requete et efface ce qui avait deja ete ecrit :
   * une session ne doit pas se retrouver avec la moitie d'un pack.
   */
  app.post('/api/session/:code/assets', guard(async (req, res) => {
    const { session, slots, budget, nextPosition } = battle.openAssetSlot(req.params.code, tokenOf(req));

    let position = nextPosition;
    const { files: written } = await receiveFiles(req, {
      maxFiles: slots,
      maxBytes: budget,
      maxTotalBytes: budget,
      onFile: async ({ stream, filename }) => {
        const id = uuid();
        const name = safeFilename(filename);
        const ext = mime.safeExtension(name);
        // Le rang est pris a l'arrivee du fichier, pas a la fin de son
        // ecriture : les ecritures se terminent dans l'ordre des tailles, et
        // un pack de samples numerotes se retrouverait melange.
        const slot = position++;
        // La clef de stockage ne reprend jamais le nom fourni : un identifiant
        // tire au hasard ne peut pas contenir de chemin.
        const key = `sessions/${session.id}/assets/${id}${ext}`;
        const { bytes } = await storage.put(key, stream);
        return { id, key, bytes, filename: name, position: slot };
      },
      cleanup: (records) => Promise.all(records.map((r) => storage.remove(r.key).catch(() => {}))),
    });

    const saved = [];
    for (const record of written) {
      const identity = mime.identify(await files.readHead(record.key), record.filename);
      saved.push(battle.recordAsset(session, {
        id: record.id,
        filename: record.filename,
        storageKey: record.key,
        bytes: record.bytes,
        mime: identity.mime,
        kind: identity.kind,
        inline: mime.canDisplayInline(identity),
        position: record.position,
      }));
    }

    battle.publish(session);
    res.json({ ok: true, added: saved.length, assets: views.assetsView(session) });
  }));

  app.delete('/api/session/:code/assets/:assetId', guard(async (req, res) => {
    const { session, asset } = battle.removeAsset(req.params.code, tokenOf(req), req.params.assetId);
    // La ligne part avant le fichier : l'inverse laisserait, en cas d'echec du
    // disque, une entree qui pointe vers rien.
    await storage.remove(asset.storageKey).catch(() => {});
    battle.publish(session);
    res.json({ ok: true, assets: views.assetsView(session) });
  }));

  /**
   * Consultation d'un element.
   *
   * Pas de jeton : l'identifiant est un UUID, qui n'apparait que dans l'etat
   * envoye aux gens deja entres dans la session. C'est ce qui permet a une
   * balise `<audio src>` de fonctionner sans entete particuliere. Les elements
   * ne sont pas des secrets — ce sont les memes contraintes pour tout le monde,
   * et l'anonymat ne les concerne pas.
   */
  app.get('/api/asset/:assetId', guard(async (req, res) => {
    const asset = repo.asset(req.params.assetId);
    if (!asset) return res.status(404).json({ error: 'Element introuvable.' });
    await files.sendStored(req, res, {
      key: asset.storageKey,
      filename: asset.filename,
      identity: { mime: asset.mime, source: asset.inline ? 'bytes' : 'extension' },
      forceDownload: req.query.dl === '1',
      cacheSeconds: 3600,
    });
  }));

  /**
   * Pack complet.
   *
   * Genere a la volee, jamais mis en cache sur le disque : un pack tient
   * rarement plus longtemps que la session, et le recalculer coute moins cher
   * que de gerer son invalidation quand l'animateur ajoute un sample.
   */
  app.get('/api/session/:code/assets.zip', guard(async (req, res) => {
    const session = battle.require(req.params.code);
    const assets = repo.assets(session.id);
    if (!assets.length) return res.status(404).json({ error: 'Aucun element a telecharger.' });

    const stem = String(session.name).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'elements';
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': files.contentDisposition('attachment', `${stem}-elements.zip`),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });

    const zip = new ZipArchive();
    // Une erreur d'archive en cours d'envoi ne peut plus etre rattrapee par un
    // code HTTP : les entetes sont deja parties. On coupe la connexion, ce que
    // le client interprete comme un telechargement incomplet — c'est le seul
    // signal honnete qui reste.
    zip.on('error', (err) => {
      console.error('[arena] pack :', err);
      res.destroy();
    });
    zip.pipe(res);

    // Les noms d'origine sont conserves : l'animateur les a souvent deja
    // numerotes, et prefixer par-dessus donnerait « 01-01-kick.wav ». Seuls
    // les doublons sont distingues — un ZIP a deux entrees identiques se
    // decompresse en un seul fichier, silencieusement.
    const used = new Map();
    for (const asset of assets) {
      const seen = used.get(asset.filename) ?? 0;
      used.set(asset.filename, seen + 1);
      const dot = asset.filename.lastIndexOf('.');
      const name = seen === 0
        ? asset.filename
        : (dot > 0
          ? `${asset.filename.slice(0, dot)} (${seen + 1})${asset.filename.slice(dot)}`
          : `${asset.filename} (${seen + 1})`);
      zip.append(storage.createReadStream(asset.storageKey), { name });
    }
    await zip.finalize();
  }));

  /* ---------------------------------------------------------------- */
  /* Rendus des participants                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Depot d'un rendu.
   *
   * Un fichier, ou du texte saisi directement pour les battles d'ecriture. Le
   * meme point d'entree sert pendant la creation et pendant la fenetre de
   * grace : c'est l'horloge du serveur, et elle seule, qui decide du retard.
   */
  app.post('/api/session/:code/submission', guard(async (req, res) => {
    const slot = battle.openSubmissionSlot(req.params.code, participantOf(req), tokenOf(req));
    const { session, participant, late, maxBytes, allowedExt, existing } = slot;

    let written = null;
    let fields = {};

    if (String(req.get('content-type') || '').startsWith('multipart/')) {
      const received = await receiveFiles(req, {
        maxFiles: 1,
        maxBytes,
        onFile: async ({ stream, filename }) => {
          const name = safeFilename(filename);
          const ext = mime.safeExtension(name);
          // La liste blanche est verifiee avant d'ecrire : refuser apres coup
          // aurait deja consomme le disque et la bande passante.
          if (allowedExt.length && !allowedExt.includes(ext.replace('.', ''))) {
            stream.resume();
            throw new UploadError(`Format refuse. Attendus : ${allowedExt.join(', ')}.`);
          }
          const key = `sessions/${session.id}/submissions/${participant.id}/${uuid()}${ext}`;
          const { bytes } = await storage.put(key, stream);
          return { key, bytes, filename: name };
        },
        cleanup: (records) => Promise.all(records.map((r) => storage.remove(r.key).catch(() => {}))),
      });
      written = received.files[0] ?? null;
      fields = received.fields;
    } else {
      fields = req.body ?? {};
    }

    const textBody = cleanText(fields.body, config.limits.maxTextBodyChars);
    if (!written && !textBody) {
      return res.status(400).json({ error: 'Aucun fichier ni texte dans la requete.' });
    }

    const identity = written
      ? mime.identify(await files.readHead(written.key), written.filename)
      : { mime: 'text/plain', kind: 'text', source: 'bytes' };

    const saved = battle.saveSubmission(session, participant, {
      originalKey: written?.key ?? null,
      originalBytes: written?.bytes ?? Buffer.byteLength(textBody, 'utf8'),
      originalMime: identity.mime,
      filename: written?.filename ?? null,
      kind: written ? identity.kind : 'text',
      inline: written ? mime.canDisplayInline(identity) : true,
      textBody: textBody || null,
      late,
      status: 'ready',
    }, existing);

    // L'ancien fichier part apres l'ecriture du nouveau : dans l'autre sens, un
    // echec en cours de route laisserait le participant sans rien.
    if (existing?.originalKey && existing.originalKey !== saved.originalKey) {
      await storage.remove(existing.originalKey).catch(() => {});
    }

    battle.publish(session);
    battle.publishYou(session, participant);
    res.json({ ok: true, submission: views.ownSubmissionView(saved), late });
  }));

  app.delete('/api/session/:code/submission', guard(async (req, res) => {
    const { session, participant, removed } = battle.withdrawSubmission(
      req.params.code, participantOf(req), tokenOf(req),
    );
    if (removed.originalKey) await storage.remove(removed.originalKey).catch(() => {});
    battle.publish(session);
    battle.publishYou(session, participant);
    res.json({ ok: true });
  }));

  /**
   * Lecture d'un rendu.
   *
   * Deux portes, et une seule suffit :
   *
   *   - une signature valide, remise a l'auteur pour qu'il puisse verifier ce
   *     qu'il vient de deposer ;
   *   - la phase de diffusion ou d'apres, ou les rendus sont faits pour etre
   *     vus — l'identifiant opaque tient alors lieu de droit d'acces, et il
   *     n'est publie qu'a l'ecran en cours.
   *
   * Hors de ces cas : 404, et non 403. Confirmer l'existence d'un rendu a
   * quelqu'un qui n'y a pas droit est deja une information de trop.
   */
  const REVEALED_PHASES = new Set(['diffusion', 'results', 'archived']);

  app.get('/api/media/:renditionId', guard(async (req, res) => {
    const sub = repo.submissionByRendition(req.params.renditionId);
    if (!sub || !sub.originalKey) return res.status(404).json({ error: 'Rendu introuvable.' });

    const session = repo.sessionById(sub.sessionId);
    const signed = verifyMedia(config.secret, sub.renditionId, req.query.k);
    if (!signed && !(session && REVEALED_PHASES.has(session.phase))) {
      return res.status(404).json({ error: 'Rendu introuvable.' });
    }

    /**
     * Le nom du fichier est cache avant la revelation.
     *
     * « beat-alexis-v3.wav » annule tout le reste du dispositif. Le nom
     * d'origine n'est rendu qu'aux resultats — et a l'auteur, qui le connait
     * deja.
     */
    const revealed = signed || (session && (session.phase === 'results' || session.phase === 'archived'));
    const ext = sub.filename ? mime.safeExtension(sub.filename) : '';
    const shown = revealed && sub.filename ? sub.filename : `rendu${ext}`;

    await files.sendStored(req, res, {
      key: sub.originalKey,
      filename: shown,
      identity: { mime: sub.originalMime, source: sub.inline ? 'bytes' : 'extension' },
      forceDownload: req.query.dl === '1',
      cacheSeconds: 0,
    });
  }));
}

module.exports = { mount };
