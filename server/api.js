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
const transcode = require('./transcode');
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
    if (existing) await transcode.removeRenditions(existing);

    // Le transcodage part en tache de fond ; la reponse n'attend pas.
    transcode.enqueue(saved);
    const fresh = repo.submission(saved.id) ?? saved;

    battle.publish(session);
    battle.publishYou(session, participant);
    res.json({ ok: true, submission: views.ownSubmissionView(fresh), late });
  }));

  app.delete('/api/session/:code/submission', guard(async (req, res) => {
    const { session, participant, removed } = battle.withdrawSubmission(
      req.params.code, participantOf(req), tokenOf(req),
    );
    if (removed.originalKey) await storage.remove(removed.originalKey).catch(() => {});
    await transcode.removeRenditions(removed);
    repo.removeJobsOf(removed.id);
    battle.publish(session);
    battle.publishYou(session, participant);
    res.json({ ok: true });
  }));

  /* ---------------------------------------------------------------- */
  /* Export du classement                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Archive de la session.
   *
   * Reservee a l'animateur, et seulement une fois les resultats affiches :
   * avant, ce serait le classement complet servi sur demande a qui devine
   * l'URL. Le format CSV existe parce qu'un classement finit souvent dans un
   * tableur ou dans un message recapitulatif.
   */
  const requireResults = (code, token) => {
    const session = battle.requireHost(code, token);
    if (session.phase !== 'results' && session.phase !== 'archived') {
      throw Object.assign(new Error('Le classement n’est pas encore etabli.'), { expected: true, status: 409 });
    }
    return session;
  };

  /** Classement complet, quel que soit l'etat de la revelation a l'ecran. */
  const fullPodium = (session) => views.podiumView({ ...session, revealedRank: Number.MAX_SAFE_INTEGER });

  app.get('/api/session/:code/results.json', guard(async (req, res) => {
    const session = requireResults(req.params.code, tokenOf(req));
    const podium = fullPodium(session);
    res.set('Content-Disposition', files.contentDisposition('attachment', `${session.code}-classement.json`));
    res.json({
      session: {
        code: session.code,
        name: session.name,
        mediaType: session.mediaType,
        brief: session.brief,
        createdAt: session.createdAt,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        config: views.configView(session.config),
      },
      participants: views.rosterView(session),
      assets: views.assetsView(session).map(({ url, ...rest }) => rest),
      results: podium.rows,
      events: repo.events(session.id),
    });
  }));

  app.get('/api/session/:code/results.csv', guard(async (req, res) => {
    const session = requireResults(req.params.code, tokenOf(req));
    const podium = fullPodium(session);

    // Guillemets doubles pour echapper un guillemet : c'est la convention que
    // les tableurs comprennent tous, contrairement a l'antislash.
    const cell = (v) => {
      const text = v === null || v === undefined ? '' : String(v);
      return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    // En mono-critere, la colonne du critere repeterait la note : on ne detaille
    // que lorsqu'un bareme a plusieurs axes a montrer.
    const criteria = session.config.criteria.length ? session.config.criteria : [];
    const header = ['rang', 'pseudo', 'note', ...criteria.map((c) => c.label), 'votants', 'attendus', 'hors_delai', 'penalite', 'fichier'];
    const lines = [header.join(';')];

    for (const row of podium.rows) {
      lines.push([
        row.unranked ? 'HC' : row.rank,
        row.author?.pseudo ?? '',
        row.score ?? row.raw,
        ...criteria.map((c) => row.criteria.find((x) => x.id === c.id)?.average ?? ''),
        row.voters,
        row.expected,
        row.late ? 'oui' : 'non',
        row.penalty || '',
        row.filename ?? '',
      ].map(cell).join(';'));
    }

    // Le prefixe BOM evite qu'Excel lise les accents de travers.
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': files.contentDisposition('attachment', `${session.code}-classement.csv`),
      'X-Content-Type-Options': 'nosniff',
    }).send(`\ufeff${lines.join('\n')}\n`);
  }));

  /**
   * Acces aux fichiers d'un rendu.
   *
   * Deux niveaux, et la distinction est le coeur de l'anonymat :
   *
   *   - **l'extrait** (`/preview`, `/peaks`, `/thumb`) est re-encode par le
   *     serveur, donc sans metadonnee, et deja coupe a la duree d'ecoute. Il
   *     est lisible par tous des la diffusion : l'identifiant opaque tient
   *     lieu de droit, et il n'est publie qu'a l'ecran en cours.
   *   - **l'original** porte encore ses tags ID3, son EXIF, son « cree par ».
   *     Il n'est servi qu'a son auteur, par signature, ou a tout le monde
   *     une fois les auteurs reveles — jamais pendant la diffusion.
   *
   * Hors de ces cas : 404, et non 403. Confirmer l'existence d'un rendu a
   * quelqu'un qui n'y a pas droit est deja une information de trop.
   */
  const REVEALED_PHASES = new Set(['diffusion', 'results', 'archived']);
  const AUTHORS_PHASES = new Set(['results', 'archived']);

  const loadMedia = (req) => {
    const sub = repo.submissionByRendition(req.params.renditionId);
    if (!sub || !sub.originalKey) return null;
    const session = repo.sessionById(sub.sessionId);
    if (!session) return null;
    const signed = verifyMedia(config.secret, sub.renditionId, req.query.k);
    return { sub, session, signed };
  };

  /** Nom montre : le vrai seulement a l'auteur ou apres la revelation. */
  const shownName = (sub, session, signed, ext) => {
    const revealed = signed || AUTHORS_PHASES.has(session.phase);
    if (revealed && sub.filename) return sub.filename.replace(/\.[^.]+$/, '') + ext;
    return `rendu${ext}`;
  };

  app.get('/api/media/:renditionId', guard(async (req, res) => {
    const found = loadMedia(req);
    if (!found) return res.status(404).json({ error: 'Rendu introuvable.' });
    const { sub, session, signed } = found;
    if (!signed && !AUTHORS_PHASES.has(session.phase)) {
      return res.status(404).json({ error: 'Rendu introuvable.' });
    }

    // Apres la revelation, la version complete nettoyee remplace l'original
    // quand elle existe : meme pour un telechargement d'archive, personne n'a
    // besoin des metadonnees d'origine.
    const full = sub.renditions?.files?.full;
    const useClean = full && !signed;
    const ext = useClean
      ? mime.safeExtension(full.key)
      : (sub.filename ? mime.safeExtension(sub.filename) : '');

    await files.sendStored(req, res, {
      key: useClean ? full.key : sub.originalKey,
      filename: shownName(sub, session, signed, ext),
      identity: useClean
        ? { mime: full.mime, source: 'bytes' }
        : { mime: sub.originalMime, source: sub.inline ? 'bytes' : 'extension' },
      forceDownload: req.query.dl === '1',
      cacheSeconds: 0,
    });
  }));

  /** Une variante nettoyee ; a defaut, l'original pour ne pas priver la salle du rendu. */
  const serveRendition = (name) => guard(async (req, res) => {
    const found = loadMedia(req);
    if (!found) return res.status(404).json({ error: 'Rendu introuvable.' });
    const { sub, session, signed } = found;
    if (!signed && !REVEALED_PHASES.has(session.phase)) {
      return res.status(404).json({ error: 'Rendu introuvable.' });
    }

    const file = sub.renditions?.files?.[name];
    if (file) {
      await files.sendStored(req, res, {
        key: file.key,
        filename: shownName(sub, session, signed, mime.safeExtension(file.key)),
        identity: { mime: file.mime, source: 'bytes' },
        forceDownload: req.query.dl === '1',
        // Les variantes sont immuables : un remplacement change d'identifiant.
        cacheSeconds: 3600,
      });
      return;
    }

    if (name !== 'preview') return res.status(404).json({ error: 'Variante indisponible.' });

    // Pas d'extrait — transcodage rate ou impossible. Plutot que d'ecarter le
    // rendu, on sert l'original et la page applique la coupure elle-meme.
    await files.sendStored(req, res, {
      key: sub.originalKey,
      filename: shownName(sub, session, signed, sub.filename ? mime.safeExtension(sub.filename) : ''),
      identity: { mime: sub.originalMime, source: sub.inline ? 'bytes' : 'extension' },
      forceDownload: req.query.dl === '1',
      cacheSeconds: 0,
    });
  });

  app.get('/api/media/:renditionId/preview', serveRendition('preview'));
  app.get('/api/media/:renditionId/peaks', serveRendition('peaks'));
  app.get('/api/media/:renditionId/thumb', serveRendition('thumb'));
}

module.exports = { mount };
