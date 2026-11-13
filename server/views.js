'use strict';

/**
 * Serialisation reseau.
 *
 * C'est le seul module autorise a construire ce qui part vers un client. Le
 * metier manipule des sessions completes, avec les auteurs, les jetons et les
 * clefs de stockage ; rien de tout cela ne doit sortir par accident.
 *
 * L'anonymat de la phase de diffusion tient a cette regle : un rendu ne porte
 * jamais son auteur, sauf a passer par `authorOf()` — une fonction, un test,
 * un endroit a relire. Disperser ce test dans quarante gestionnaires
 * d'evenements reviendrait a le perdre au premier ajout de fonctionnalite.
 */

/* ------------------------------------------------------------------ */
/* La garde                                                            */
/* ------------------------------------------------------------------ */

/**
 * Phases ou un rendu a le droit de porter le nom de son auteur.
 *
 * La regie n'y echappe pas. L'animateur regarde la diffusion en meme temps que
 * les autres, souvent en partage d'ecran : lui accorder une vue nominative
 * ferait fuiter tout le monde d'un coup. Il verra les auteurs a la revelation,
 * comme la salle.
 */
const AUTHORS_VISIBLE = new Set(['results', 'archived']);

const config = require('./config');
const regles = require('./regles');
const repo = require('./repo');
const roulette = require('./roulette');
const { rank } = require('./scoring');

const { signMedia } = require('./util');
const { classementGeneral } = require('./manches');
const { nomTonalite } = require('./analyse');

function authorsVisible(session) {
  return AUTHORS_VISIBLE.has(session.phase);
}

/**
 * Auteur d'un rendu, ou null.
 *
 * Renvoyer `null` plutot que lever : un appelant qui oublie la garde produit
 * un rendu anonyme, pas une erreur 500 en pleine soiree. Le defaut sur en cas
 * de bug vaut mieux que le defaut bruyant.
 */
function authorOf(session, participantId) {
  if (!authorsVisible(session)) return null;
  const p = session.participants.get(participantId);
  if (!p) return null;
  return { id: p.id, pseudo: p.pseudo, avatar: p.avatar };
}

/* ------------------------------------------------------------------ */
/* Morceaux communs                                                    */
/* ------------------------------------------------------------------ */

/**
 * Reglages visibles de tous.
 *
 * Liste explicite plutot que `{...session.config}` : le jour ou la
 * configuration accueillera une clef d'API ou un secret de webhook, elle ne
 * partira pas dans le meme mouvement vers deux cents telephones.
 */
function configView(config) {
  return {
    durationMs: config.durationMs,
    graceMs: config.graceMs,
    alerts: config.alerts,
    endSound: config.endSound,
    playMaxS: config.playMaxS,
    fadeOutS: config.fadeOutS,
    scale: config.scale,
    defaultVote: config.defaultVote,
    criteria: config.criteria,
    latePolicy: config.latePolicy,
    latePenalty: config.latePenalty,
    hostVotes: config.hostVotes,
    autoAdvance: config.autoAdvance,
    autoNext: config.autoNext,
    voteWindowS: config.voteWindowS,
    playerAudio: config.playerAudio,
    allowedExt: config.allowedExt,
    maxFileBytes: config.maxFileBytes,
    mode: config.mode ?? 'battle',
    rounds: config.rounds ?? 1,
  };
}

/**
 * Horloge.
 *
 * On envoie des instants absolus, jamais des durees. Une duree se perime
 * pendant son trajet reseau ; un instant reste vrai, et le client le compare a
 * sa propre horloge une fois celle-ci recalee sur celle du serveur.
 */
function clockView(session) {
  return {
    startedAt: session.startedAt,
    createEndAt: session.createEndAt,
    graceEndAt: session.graceEndAt,
    pausedAt: session.pausedAt,
    remainingMs: session.remainingMs,
    durationMs: session.config.durationMs,
    graceMs: session.config.graceMs,
    alerts: session.config.alerts,
  };
}

/**
 * Trombinoscope.
 *
 * Les pseudos sont publics et le restent en diffusion : savoir qui participe
 * ne dit rien de qui a fait quoi. C'est la correspondance rendu -> auteur qui
 * est protegee, pas la liste des presents — la masquer priverait le lobby de
 * son interet sans rien proteger.
 */
function rosterView(session) {
  return [...session.participants.values()]
    .filter((p) => !p.isHost)
    .map((p) => ({
      id: p.id,
      pseudo: p.pseudo,
      avatar: p.avatar,
      connected: session.isOnline(p.id),
      disqualified: p.disqualified,
      /** Vient juger sans creer : on ne l'attend pas au depot. */
      spectator: p.spectator,
    }));
}

/**
 * Elements imposes.
 *
 * Aucun anonymat en jeu : ce sont les fichiers de l'animateur, les memes pour
 * tout le monde. On expose de quoi les consulter dans la page (`kind` et
 * `inline`) et de quoi les recuperer, un par un ou en pack.
 */
function assetsView(session) {
  return repo.assets(session.id).map((a) => ({
    id: a.id,
    filename: a.filename,
    bytes: a.bytes,
    mime: a.mime,
    kind: a.kind,
    /** Consultable directement dans la page, ou seulement telechargeable. */
    inline: a.inline,
    position: a.position,
    url: `/api/asset/${a.id}`,
  }));
}

function countsView(session, submitted = repo.submittedParticipantIds(session.id)) {
  const roster = [...session.participants.values()].filter((p) => !p.isHost);
  // « 04/06 ont rendu » ne doit compter que ceux de qui on attend un rendu :
  // un spectateur ne depose rien, l'inclure ferait croire a un retard.
  const creators = roster.filter((p) => !p.spectator);
  const spectators = roster.filter((p) => p.spectator);
  const enLigne = (liste) => liste.filter((p) => session.isOnline(p.id)).length;
  return {
    /** Les createurs — ceux de qui on attend un rendu. */
    participants: creators.length,
    spectators: spectators.length,
    /*
     * Deux comptes de presence, un par population.
     *
     * Il n'y en avait qu'un, tous roles confondus, affiche a cote du seul
     * nombre de createurs : avec trois spectateurs branches, l'ecran annoncait
     * « 7 en ligne sur 4 ». Chaque compte se lit maintenant contre le sien.
     */
    connected: enLigne(creators),
    spectatorsConnected: enLigne(spectators),
    submitted: submitted.length,
    // Renseigne par l'increment vote.
    voted: 0,
  };
}

/**
 * Le rendu d'un participant, tel qu'il le voit lui.
 *
 * Le lien porte une signature : une balise `<audio src>` ne sait pas envoyer
 * d'entete d'autorisation, et l'auteur doit pouvoir reecouter ce qu'il vient
 * de deposer sans attendre la diffusion. La signature ne vaut que pour ce
 * rendu-la.
 */
function ownSubmissionView(submission) {
  if (!submission) return null;
  return {
    id: submission.id,
    /** Sert au participant a reconnaitre son propre rendu pendant la diffusion. */
    renditionId: submission.renditionId,
    filename: submission.filename,
    bytes: submission.originalBytes,
    kind: submission.kind,
    inline: submission.inline,
    textBody: submission.textBody,
    uploadedAt: submission.uploadedAt,
    late: submission.late,
    status: submission.status,
    /** Un extrait nettoye existe-t-il ? Faux si le transcodage a echoue ou n'a pas lieu d'etre. */
    transcoded: !!submission.renditions?.files?.preview,
    durationMs: submission.renditions?.durationMs ?? null,
    /** Motif d'un transcodage rate, pour que l'auteur sache que son fichier passera tel quel. */
    error: submission.error,
    replacedCount: submission.replacedCount,
    url: submission.originalKey
      ? `/api/media/${submission.renditionId}?k=${signMedia(config.secret, submission.renditionId)}`
      : null,
  };
}

/**
 * Un rendu en cours de diffusion, tel que tout le monde le voit.
 *
 * La liste des champs est la liste des champs. Ce qui n'y figure pas ne sort
 * pas : ni `participantId`, ni `filename`, ni l'identifiant interne du rendu.
 * Le `renditionId` est un identifiant opaque, tire a nouveau a chaque
 * remplacement, qui ne se relie a rien.
 *
 * `late` est expose volontairement : un votant a le droit de savoir qu'un
 * rendu est arrive hors delai. Cela dit qu'il est en retard, pas qui il est.
 */
function anonymousCard(submission) {
  const files = submission.renditions?.files ?? {};
  const rid = submission.renditionId;
  return {
    renditionId: rid,
    kind: submission.kind,
    mime: files.preview?.mime ?? submission.originalMime,
    inline: submission.inline || !!files.preview,
    textBody: submission.textBody,
    bytes: files.preview?.bytes ?? submission.originalBytes,
    late: submission.late,
    /** Duree reelle mesuree par le transcodage, ou null si inconnue. */
    durationMs: submission.renditions?.durationMs ?? null,
    /** Vrai quand un extrait nettoye existe ; faux = original servi tel quel. */
    transcoded: !!files.preview,
    // L'extrait de diffusion, jamais l'original : c'est lui qui est nettoye
    // de ses metadonnees et deja coupe a la duree d'ecoute.
    url: submission.originalKey ? `/api/media/${rid}/preview` : null,
    peaksUrl: files.peaks ? `/api/media/${rid}/peaks` : null,
    thumbUrl: files.thumb ? `/api/media/${rid}/thumb` : null,
  };
}

/** Etat de la diffusion : ou en est-on, et sur quoi. */
function diffusionView(session) {
  if (session.phase !== 'diffusion') return null;
  const order = session.order ?? [];
  const currentId = order[session.cursor] ?? null;
  const submission = currentId ? repo.submission(currentId) : null;

  return {
    index: session.cursor,
    total: order.length,
    current: submission ? anonymousCard(submission) : null,
    voted: submission ? repo.countVoters(submission.id) : 0,
    // Tout le monde sauf l'auteur. Le nombre attendu ne dit pas qui est
    // l'auteur, seulement qu'il y en a un parmi les presents.
    eligible: submission ? session.eligibleVoters(submission) : 0,
    /**
     * Horloge du rendu : des instants absolus, comme pour le chrono.
     *
     * `startedAt` cale l'ecoute de tous a la meme seconde, `endsAt` l'arrete,
     * `advanceAt` dit quand le serveur passera au suivant — ou null si la regie
     * a coupe l'automatique.
     */
    startedAt: session.diffusionStartedAt,
    endsAt: session.diffusionEndsAt,
    advanceAt: session.diffusionAdvanceAt,
    autoNext: session.config.autoNext,
    playMaxS: session.config.playMaxS,
    voteWindowS: session.config.voteWindowS,
    playerAudio: session.config.playerAudio,
    /**
     * L'extrait que ce rendu reconstruit, en Rebuild The Track : son nom, son
     * tempo, sa tonalite — ce qu'il faut pour juger un remake. Sans le
     * fichier, et sans dire qui l'avait recu.
     */
    extrait: submission ? extraitDuRendu(session, submission) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Manches et Rebuild The Track                                        */
/* ------------------------------------------------------------------ */

const rebuild = (session) => (session.config.mode ?? 'battle') === 'rebuild';

/** Ou en est la partie : manche k sur N, et le mode. */
function mancheView(session) {
  const round = session.round ?? 1;
  const rounds = session.config.rounds ?? 1;
  return { round, rounds, derniere: round >= rounds, mode: session.config.mode ?? 'battle' };
}

/**
 * Un extrait tel qu'on l'affiche.
 *
 * `avecFichier` ajoute le lien de telechargement, signe : il ne part que vers
 * l'animateur et vers ceux a qui l'extrait a ete attribue. Le lien est signe
 * plutot que protege par un jeton parce qu'une balise `<audio src>` ne sait
 * pas envoyer d'en-tete.
 */
function extraitCarte(e, { avecFichier = false } = {}) {
  return {
    id: e.id,
    nom: e.filename,
    position: e.position,
    bpm: e.bpm,
    bpmSource: e.bpmSource,
    tonalite: e.tonalite,
    tonaliteNom: e.tonalite ? nomTonalite(e.tonalite) : null,
    tonaliteSource: e.tonaliteSource,
    analyse: e.analyse,
    ...(avecFichier ? {
      mime: e.mime,
      bytes: e.bytes,
      url: `/api/extrait/${e.id}?k=${signMedia(config.secret, `extrait:${e.id}`)}`,
    } : {}),
  };
}

/** L'extrait d'origine d'un rendu : celui que son auteur avait recu pour cette manche. */
function extraitDuRendu(session, submission) {
  if (!rebuild(session)) return null;
  const a = repo.attributionDe(session.id, submission.participantId, submission.round ?? null);
  const e = a ? repo.extrait(a.extraitId) : null;
  return e ? extraitCarte(e) : null;
}

/**
 * Les extraits, pour l'animateur.
 *
 * Avec, pour chacun, combien de fois il a deja ete joue et qui l'a dans la
 * manche en cours. `retirable` est faux des qu'il a servi une fois : il porte
 * l'histoire d'une manche jouee, et le classement de cette manche y renvoie.
 */
function extraitsView(session) {
  const toutes = repo.toutesAttributions(session.id);
  const round = session.round ?? 1;
  return repo.extraits(session.id).map((e) => {
    const siennes = toutes.filter((a) => a.extraitId === e.id);
    return {
      ...extraitCarte(e, { avecFichier: true }),
      joues: new Set(siennes.filter((a) => a.round < round).map((a) => a.round)).size,
      cetteManche: siennes.filter((a) => a.round === round)
        .map((a) => session.participants.get(a.participantId)?.pseudo)
        .filter(Boolean),
      retirable: siennes.length === 0,
    };
  });
}

/** Qui reconstruit quoi dans la manche en cours, pour l'animateur. */
function attributionsView(session) {
  return repo.attributions(session.id).map((a) => ({
    participantId: a.participantId,
    pseudo: session.participants.get(a.participantId)?.pseudo ?? null,
    extraitId: a.extraitId,
  }));
}

/** L'extrait du participant pour la manche en cours, avec son fichier. */
function monExtraitView(session, participant) {
  if (!rebuild(session) || participant.spectator || participant.isHost) return null;
  const a = repo.attributionDe(session.id, participant.id);
  const e = a ? repo.extrait(a.extraitId) : null;
  return e ? extraitCarte(e, { avecFichier: true }) : null;
}

/**
 * LES RENDUS CLASSES DE LA MANCHE — une seule definition.
 *
 * Un rendu est classe s'il a ete DIFFUSE (il figure dans l'ordre de passage)
 * et si son auteur n'est pas ecarte a l'instant ou l'on regarde. Le podium, le
 * nombre de crans a devoiler, « tout est devoile » et le classement fige d'une
 * manche partent tous d'ici.
 *
 * Il y avait deux comptes : l'ordre de passage d'un cote, les rendus des
 * non-ecartes de l'autre. Ils divergeaient des qu'on ecartait ou reintegrait
 * quelqu'un apres le debut de la diffusion — premiere place indevoilable, ou
 * manche suivante offerte puis refusee.
 *
 * Un reintegre dont le rendu n'est jamais passe n'entre pas au classement :
 * personne ne l'a ecoute, il n'aurait que des notes par defaut.
 */
function rendusClasses(session) {
  const diffuses = new Set(session.order ?? []);
  return repo.submissions(session.id).filter((sub) => {
    const author = session.participants.get(sub.participantId);
    return diffuses.has(sub.id) && sub.status === 'ready' && author && !author.disqualified;
  });
}

/** Combien de places le classement de la manche compte, donc combien de crans a devoiler. */
function totalClasses(session) {
  return rendusClasses(session).length;
}

/** Le classement calcule de la manche, et les rendus dont il part. */
function classer(session) {
  const submissions = rendusClasses(session);
  const voters = [...session.participants.values()].filter((p) => !p.isHost && !p.disqualified);
  const rows = rank({
    submissions,
    tally: repo.tally(session.id),
    voterIds: voters.map((p) => p.id),
    config: session.config,
    // Seuls les sorts REELLEMENT appliques comptent : un tirage fait apres le
    // devoilement reste une consigne, et le classement ne bouge pas pour lui.
    spun: repo.appliedPoints(session.id),
  });
  return { submissions, rows };
}

/**
 * Le classement complet de la manche courante, pour l'usage interne : figer
 * une manche, calculer la moyenne. Il ne part jamais tel quel vers un client —
 * le devoilement par crans passe par `podiumView`.
 */
function rangsManche(session) {
  return classer(session).rows.map((row) => ({ participantId: row.participantId, score: row.score, rank: row.rank }));
}

/** Le classement de la manche courante est-il entierement devoile ? */
function mancheDevoilee(session) {
  if (session.phase !== 'results' && session.phase !== 'archived') return false;
  return (session.revealedRank ?? 0) >= totalClasses(session);
}

/**
 * Le classement general : les manches figees, plus la courante une fois son
 * classement entierement devoile — jamais avant, sans quoi la moyenne
 * trahirait des places encore cachees.
 */
function classementGeneralDe(session) {
  const round = session.round ?? 1;
  const manches = repo.manchesFigees(session.id).filter((m) => m.round < round);
  if (mancheDevoilee(session)) manches.push({ round, rows: rangsManche(session) });
  const classables = [...session.participants.values()].filter((p) => !p.isHost && !p.disqualified && !p.spectator);
  return { manches: manches.length, lignes: classementGeneral({ manches, participants: classables }) };
}

/**
 * L'identite d'un classe au general.
 *
 * Sans la garde de `authorOf`, et c'est voulu : le general ne contient que
 * des manches DEJA devoilees — la courante n'y entre qu'une fois tout son
 * classement affiche. Pendant la manche 2, montrer qui menait apres la
 * manche 1 ne trahit rien de ce qui se joue maintenant.
 */
function classeDe(session, participantId) {
  const p = session.participants.get(participantId);
  return p ? { id: p.id, pseudo: p.pseudo, avatar: p.avatar } : null;
}

/** La vue du classement general, pour les trois surfaces. Nulle en une manche. */
function generalView(session) {
  if ((session.config.rounds ?? 1) <= 1) return null;
  const { manches, lignes } = classementGeneralDe(session);
  if (!manches) return null;
  return {
    manches,
    rows: lignes.map((l) => ({
      rank: l.rank,
      moyenne: l.moyenne,
      scores: l.scores.map((v) => (v === null ? null : Math.round(v * 100) / 100)),
      joues: l.joues,
      author: classeDe(session, l.participantId),
    })),
  };
}

/**
 * Classement, devoile par crans.
 *
 * Les places encore cachees ne partent pas amputees de leur auteur : elles ne
 * partent pas du tout. Envoyer la ligne complete en comptant sur l'interface
 * pour ne pas l'afficher, c'est publier le classement dans l'onglet reseau du
 * navigateur avant de l'annoncer a l'ecran.
 */
function podiumView(session) {
  if (!AUTHORS_VISIBLE.has(session.phase)) return null;

  const { submissions, rows } = classer(session);

  const revealed = session.revealedRank ?? 0;
  const byId = new Map(submissions.map((sub) => [sub.id, sub]));

  return {
    total: rows.length,
    revealed,
    complete: revealed >= rows.length,
    rows: rows.map((row, index) => {
      // On devoile du bas vers le haut : les dernieres lignes du tableau
      // d'abord, la premiere en dernier.
      const shown = index >= rows.length - revealed;
      if (!shown) return { position: index + 1, hidden: true };

      const submission = byId.get(row.submissionId);
      const author = authorOf(session, row.participantId);
      return {
        position: index + 1,
        hidden: false,
        rank: row.rank,
        score: row.score === null ? null : Math.round(row.score * 100) / 100,
        raw: Math.round(row.raw * 100) / 100,
        voters: row.voters,
        expected: row.expected,
        late: row.late,
        unranked: row.unranked,
        penalty: row.penalty,
        fate: row.fate,
        criteria: row.criteria.map((c) => ({
          id: c.id, label: c.label, average: Math.round(c.average * 100) / 100,
        })),
        author,
        rendition: submission ? anonymousCard(submission) : null,
        filename: submission?.filename ?? null,
      };
    }),
  };
}

/**
 * Les manches deja jouees, avec leurs rendus : pour les reecouter et les
 * telecharger une fois passe a la suite.
 *
 * Meme forme qu'un podium entierement devoile, pour que les pages le montrent
 * avec le meme composant. Le rang et la note viennent du classement FIGE ; le
 * detail des votes n'a pas ete garde et n'est pas invente. Envoye seulement au
 * classement et en fin de session : c'est la qu'on vient chercher un rendu, et
 * le joindre a chaque diffusion d'etat pendant la creation ferait voyager
 * toutes les cartes de toutes les manches a chaque depot.
 */
function manchesPasseesView(session) {
  if (!AUTHORS_VISIBLE.has(session.phase)) return null;
  const round = session.round ?? 1;
  if (round <= 1) return null;
  return repo.manchesFigees(session.id).filter((m) => m.round < round).map((m) => {
    const rendus = new Map(repo.submissions(session.id, m.round).map((sub) => [sub.participantId, sub]));
    // Les hors classement (rang nul) vont en bas, comme sur le podium.
    const rows = [...m.rows].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
    return {
      round: m.round,
      podium: {
        total: rows.length,
        revealed: rows.length,
        complete: true,
        rows: rows.map((r, index) => {
          const sub = rendus.get(r.participantId);
          return {
            position: index + 1,
            hidden: false,
            rank: r.rank,
            score: r.score === null ? null : Math.round(r.score * 100) / 100,
            unranked: r.rank === null,
            late: !!sub?.late,
            author: classeDe(session, r.participantId),
            rendition: sub ? anonymousCard(sub) : null,
            filename: sub?.filename ?? null,
          };
        }),
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Export de l'animateur                                               */
/* ------------------------------------------------------------------ */

/**
 * Tout ce que la partie a classe : chaque manche, puis le general.
 *
 * L'export ne portait que la manche en cours — trois manches jouees, un tiers
 * de la soiree dans le fichier, et aucun classement general.
 *
 * Les manches passees sortent de leur classement FIGE (`manche_resultat`) :
 * rang et note, tels qu'ils ont ete annonces. Le detail — votants, criteres,
 * penalite — n'a pas ete fige et ne se recalcule pas honnetement apres coup,
 * la liste des votants ayant pu changer ; il n'est donne que pour la manche
 * courante. Reserve a l'animateur, une fois le classement affiche : l'appelant
 * le verifie.
 */
function exportView(session) {
  const round = session.round ?? 1;
  const arrondi = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
  const figees = repo.manchesFigees(session.id).filter((m) => m.round < round);

  const passees = figees.map((m) => {
    const rendus = new Map(repo.submissions(session.id, m.round).map((sub) => [sub.participantId, sub]));
    // Les hors classement (rang nul) vont en bas, comme sur le podium.
    const rows = [...m.rows].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
    return {
      round: m.round,
      courante: false,
      rows: rows.map((r) => ({
        rank: r.rank,
        unranked: r.rank === null,
        score: arrondi(r.score),
        author: classeDe(session, r.participantId),
        late: !!rendus.get(r.participantId)?.late,
        filename: rendus.get(r.participantId)?.filename ?? null,
      })),
    };
  });
  const courante = podiumView({ ...session, revealedRank: Number.MAX_SAFE_INTEGER });
  const manches = [...passees, { round, courante: true, rows: courante ? courante.rows : [] }];

  let general = null;
  if ((session.config.rounds ?? 1) > 1) {
    const classables = [...session.participants.values()].filter((p) => !p.isHost && !p.disqualified && !p.spectator);
    general = classementGeneral({
      manches: [...figees, { round, rows: rangsManche(session) }],
      participants: classables,
    }).map((l) => ({
      rank: l.rank,
      moyenne: l.moyenne,
      scores: l.scores.map(arrondi),
      joues: l.joues,
      author: classeDe(session, l.participantId),
    }));
  }
  return { manches, general };
}

/**
 * Le meme contenu, en CSV.
 *
 * En une seule manche, le fichier est celui d'avant, colonne pour colonne :
 * des tableurs le lisent deja. En plusieurs, une colonne `manche` passe en
 * tete, et le general suit sous la valeur « general » — un seul tableau, qu'un
 * filtre sur la premiere colonne decoupe.
 */
function exportCsv(session) {
  const { manches, general } = exportView(session);
  // Guillemets doubles pour echapper un guillemet : c'est la convention que
  // les tableurs comprennent tous, contrairement a l'antislash.
  const cell = (v) => {
    const text = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  // En mono-critere, la colonne du critere repeterait la note : on ne detaille
  // que lorsqu'un bareme a plusieurs axes a montrer.
  const criteria = session.config.criteria.length ? session.config.criteria : [];
  const plusieurs = (session.config.rounds ?? 1) > 1;
  const tete = (m) => (plusieurs ? [m] : []);
  // `sort` a cote de `penalite`, et jamais melange : une penalite est une regle
  // annoncee, un sort est un hasard assume. Sans cette colonne, une session ou
  // la roue a bouge un score s'exporte avec une note qu'on ne peut pas recomposer.
  const header = [...tete('manche'), 'rang', 'pseudo', 'note', ...criteria.map((c) => c.label), 'votants', 'attendus', 'hors_delai', 'penalite', 'sort', 'fichier'];
  const lines = [header.join(';')];

  for (const m of manches) {
    for (const row of m.rows) {
      lines.push([
        ...tete(m.round),
        row.unranked ? 'HC' : row.rank,
        row.author?.pseudo ?? '',
        row.score ?? row.raw ?? '',
        ...criteria.map((c) => row.criteria?.find((x) => x.id === c.id)?.average ?? ''),
        row.voters ?? '',
        row.expected ?? '',
        row.late ? 'oui' : 'non',
        row.penalty || '',
        row.fate || '',
        row.filename ?? '',
      ].map(cell).join(';'));
    }
  }
  for (const l of general ?? []) {
    // La note du general est la moyenne des manches ; les autres colonnes
    // decrivent un rendu, et un general n'en a pas.
    lines.push([
      'general', l.rank, l.author?.pseudo ?? '', l.moyenne,
      ...new Array(header.length - 4).fill(''),
    ].map(cell).join(';'));
  }
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ */
/* Vues par audience                                                   */
/* ------------------------------------------------------------------ */

/**
 * LA ROULETTE, vue de tout le monde.
 *
 * Le dernier tirage part aux trois surfaces, en entier. Ce n'est pas un vote :
 * il n'y a rien a cacher, et tout l'interet est que la salle voie qui a tire
 * quoi. Le roster est deja public, donc nommer quelqu'un ne revele rien de
 * plus.
 *
 * LE NOMBRE DE TIRAGES EST PUBLIC, et c'est deliberе. Si l'animateur pouvait
 * relancer en secret jusqu'a obtenir ce qui lui plait, la roue n'aurait plus
 * aucune autorite. On ne l'empeche pas de relancer — parfois il faut — mais le
 * compte s'affiche.
 *
 * LA GRAINE N'EST PAS ICI. Elle sert a rejouer un tirage conteste, ce qui est
 * une conversation entre l'animateur et la salle, pas une ligne d'affichage.
 * `hostView` la porte, lui.
 */
function rouletteView(session) {
  const dernier = repo.lastSpin(session.id);
  return {
    spins: repo.countSpins(session.id),
    last: dernier ? {
      id: dernier.id,
      wheelName: dernier.wheelName,
      target: dernier.target,
      howMany: dernier.howMany,
      shared: dernier.shared,
      phase: dernier.phase,
      at: dernier.at,
      /*
       * Le champ, pour que l'ecran MONTRE le tirage au lieu de le raconter.
       *
       * `pool` est l'ordre stable de `eligibles()`, donc le champ des sujets
       * est le meme d'un tirage a l'autre dans une session : la salle apprend
       * la roue. `slots` porte les poids, sans quoi un champ de cases egales
       * mentirait sur les chances.
       */
      pool: dernier.pool,
      slots: dernier.slots,
      spent: dernier.spent,
      fates: repo.fates(dernier.id).map((f) => ({
        participantId: f.participantId,
        pseudo: f.pseudo,
        label: f.label,
        detail: f.detail,
        points: f.points,
        chronoMs: f.chronoMs,
        /*
         * Un etat par effet : ils n'obeissent pas a la meme regle, et les
         * resumer en un seul obligeait les pages a redeviner laquelle avait
         * joue. Faux veut dire « consigne a respecter », pas « rien ».
         */
        pointsApplied: !!f.pointsAppliedAt,
        chronoApplied: !!f.chronoAppliedAt,
        poolIndex: f.poolIndex,
        slotIndex: f.slotIndex,
        position: f.position,
      })),
    } : null,
  };
}

/** Son propre sort, sur son canal : le telephone l'affiche en grand. */
function youFateView(session, participant) {
  const dernier = repo.lastSpin(session.id);
  if (!dernier) return null;
  const sien = repo.fates(dernier.id).find((f) => f.participantId === participant.id);
  if (!sien) return null;
  return {
    spinId: dernier.id,
    wheelName: dernier.wheelName,
    label: sien.label,
    detail: sien.detail,
    points: sien.points,
    chronoMs: sien.chronoMs,
    pointsApplied: !!sien.pointsAppliedAt,
    chronoApplied: !!sien.chronoAppliedAt,
    at: dernier.at,
  };
}


/** Socle partage par les trois surfaces. */
function commonView(session) {
  return {
    code: session.code,
    name: session.name,
    phase: session.phase,
    mediaType: session.mediaType,
    brief: session.brief,
    config: configView(session.config),
    clock: clockView(session),
    counts: countsView(session),
    roster: rosterView(session),
    assets: assetsView(session),
    assetsZipUrl: `/api/session/${session.code}/assets.zip`,
    diffusion: diffusionView(session),
    podium: podiumView(session),
    chain: chainView(session),
    roulette: rouletteView(session),
    manche: mancheView(session),
    general: generalView(session),
    /** Les manches deja jouees et leurs rendus ; nul hors du classement. */
    passees: manchesPasseesView(session),
    /** Reference d'horloge : le client s'en sert pour mesurer sa derive. */
    serverNow: Date.now(),
  };
}

/** Ce que voit un participant sur son telephone. */
/**
 * La chaine, vue de tout le monde.
 *
 * Pendant la creation, on ne dit que le nombre de lignes et a qui est le tour.
 * Le texte, lui, n'apparait qu'une fois la creation finie : tout l'interet du
 * cadavre exquis tient a ce que personne ne lise avant la fin.
 */
function chainView(session) {
  const lignes = repo.chainLines(session.id);
  const enCours = regles.CHAIN_PHASES.has(session.phase);
  const auteur = (id) => session.participants.get(id);
  const tour = session.chainTurnEndsAt && enCours ? session.chainTurn : null;
  return {
    lines: lignes.length,
    // Le tour est recalcule par le serveur avant chaque diffusion : la vue ne
    // fait que le rapporter, elle ne le devine pas.
    turn: tour ? { id: tour, pseudo: auteur(tour)?.pseudo ?? null } : null,
    turnEndsAt: enCours ? session.chainTurnEndsAt ?? null : null,
    // La duree d'un tour vient d'ici : le sablier de la page se dessine avec,
    // au lieu de reproduire une constante du serveur et de deriver le jour ou
    // elle change.
    turnMs: regles.CHAIN_TURN_MS,
    open: enCours,
    revealed: enCours ? null : lignes.map((l) => ({ pseudo: l.pseudo, body: l.body, at: l.at })),
  };
}

/**
 * Ce qu'un spectateur voit de la chaine, et lui seul.
 *
 * La derniere ligne : celle qu'il doit prolonger. Elle ne peut pas passer par
 * l'etat commun, ou les createurs la liraient — et ou elle ferait, a la
 * diffusion, un spoiler de ce qui doit se decouvrir d'un coup.
 */
function youChainView(session, participant) {
  if (!participant.spectator) return null;
  if (!regles.CHAIN_PHASES.has(session.phase)) return null;
  const lignes = repo.chainLines(session.id);
  const derniere = lignes.length ? lignes[lignes.length - 1] : null;
  return {
    mine: session.chainTurn === participant.id,
    /**
     * Combien de tours avant le sien : 0 s'il tient la main, -1 si on ne sait
     * pas (personne ne joue). La page annoncait « ton tour vient ensuite » a
     * tout le monde, ce qui est faux des trois spectateurs.
     */
    ahead: (session.chainQueue ?? []).indexOf(participant.id),
    last: derniere ? derniere.body : null,
    lastBy: derniere ? derniere.pseudo : null,
    position: lignes.length + 1,
    // La borne de saisie vient du serveur, qui tronque a la meme longueur.
    max: regles.CHAIN_LINE_MAX,
  };
}

function participantView(session) {
  return commonView(session);
}

/**
 * Ce que voit la regie.
 *
 * Elle recoit davantage d'informations d'exploitation — qui est parti, qui n'a
 * pas encore televerse — mais aucune correspondance entre un rendu et son
 * auteur avant la revelation. Savoir qui a rendu quelque chose est necessaire
 * pour relancer les retardataires ; savoir lequel des rendus anonymes lui
 * appartient ne l'est pas.
 */
function hostView(session) {
  // Qui a rendu quelque chose : necessaire pour relancer les retardataires.
  // Ce n'est pas une fuite d'anonymat — l'ensemble des auteurs est de toute
  // facon deduit du nombre de rendus. Ce qui reste protege, c'est lequel des
  // rendus anonymes appartient a qui.
  const submitted = new Set(repo.submittedParticipantIds(session.id));
  return {
    ...commonView(session),
    isHost: true,
    /** Rendus recus mais pas encore prets a diffuser. */
    pendingSubmissions: repo.countPendingSubmissions(session.id),
    /**
     * Les roues, et la graine du dernier tirage.
     *
     * Les roues ne dependent d'aucune session : elles se preparent entre deux
     * soirees. La graine est ici et pas dans la vue commune — elle sert a
     * rejouer un tirage conteste, ce qui est une conversation entre
     * l'animateur et la salle, pas une ligne d'affichage.
     */
    wheels: repo.wheels(),
    lastSeed: repo.lastSpin(session.id)?.seed ?? null,
    /** Rebuild The Track : les extraits et qui reconstruit quoi. */
    extraits: extraitsView(session),
    attributions: attributionsView(session),
    /**
     * Les regles du tirage, envoyees plutot que recopiees.
     *
     * La regie doit pouvoir PREVENIR avant un tirage de ce que le mode choisi
     * ne pourra pas faire : l'apprendre apres ne sert plus a rien, le sort est
     * deja tombe devant la salle. Elle a donc besoin des memes ensembles de
     * phases que le serveur. Les lui faire redeclarer serait un miroir, et un
     * miroir finit par mentir — on les lui donne.
     */
    rouletteRules: {
      pointsPhases: [...roulette.PHASES_POINTS],
      chronoPhases: [...roulette.PHASES_CHRONO],
      blindPhases: [...roulette.PHASES_AVEUGLES],
      pointsMax: roulette.POINTS_MAX,
      chronoMaxMs: roulette.CHRONO_MAX_MS,
    },
    /**
     * Ce que la regie peut faire maintenant, dit par le serveur.
     *
     * Des reponses, pas des listes de phases : la regle des elements imposes
     * depend aussi de la manche (entre deux manches, le pack se change), et
     * la page n'a pas a la reconstituer pour griser un bouton.
     */
    rules: {
      assetAdd: regles.peutAjouterElement(session),
      assetRemove: regles.peutRetirerElement(session),
    },
    roster: [...session.participants.values()]
      .filter((p) => !p.isHost)
      .map((p) => ({
        id: p.id,
        pseudo: p.pseudo,
        avatar: p.avatar,
        connected: session.isOnline(p.id),
        disqualified: p.disqualified,
        /** Vient juger sans creer : la regie ne l'attend pas au depot. */
        spectator: p.spectator,
        joinedAt: p.joinedAt,
        lastSeenAt: p.lastSeenAt,
        hasSubmitted: submitted.has(p.id),
      })),
  };
}

/**
 * Ce qu'affiche le grand ecran.
 *
 * Aucun controle, aucune donnee nominative de plus que le participant : cet
 * ecran finit souvent en partage d'ecran ou sur un flux public.
 */
function screenView(session) {
  return { ...commonView(session), isScreen: true };
}

/**
 * Canal personnel.
 *
 * Ce que le serveur dit a un participant sur lui-meme, et a lui seul : son
 * identite, son etat de televersement, ses votes deja emis. C'est ce qui
 * permet a un rafraichissement de page de retrouver exactement sa place.
 */
function youView(session, participant) {
  return {
    id: participant.id,
    pseudo: participant.pseudo,
    avatar: participant.avatar,
    isHost: participant.isHost,
    disqualified: participant.disqualified,
    spectator: participant.spectator,
    joinedAt: participant.joinedAt,
    submission: ownSubmissionView(repo.submissionOf(session.id, participant.id)),
    /**
     * Ses propres votes, indexes par identifiant public de rendu.
     *
     * Sur le canal personnel uniquement : le vote est anonyme, et personne —
     * animateur compris — ne doit pouvoir reconstituer qui a mis quoi.
     */
    votes: votesView(session, participant),
    /** Les rendus deja passes qu'il lui reste a noter. */
    aRattraper: aRattraperView(session, participant),
    chain: youChainView(session, participant),
    /** Son propre sort, pour que le telephone l'affiche en grand. */
    fate: youFateView(session, participant),
    /** Rebuild The Track : l'extrait a reconstruire, sur son seul canal. */
    extrait: monExtraitView(session, participant),
  };
}

/**
 * Les rendus deja passes qu'il n'a pas notes — ou pas sur tous les criteres.
 *
 * Le serveur accepte une note sur tout rendu deja diffuse ; encore faut-il que
 * la page sache lesquels proposer. Sur le canal personnel, parce que c'est un
 * fait sur LUI : ce qu'il a note ne regarde personne d'autre. Les cartes sont
 * celles de la diffusion, anonymes. Le rendu en cours n'y figure pas — il se
 * note sur la scene — et le sien non plus.
 */
function aRattraperView(session, participant) {
  if (session.phase !== 'diffusion' || participant.isHost || participant.disqualified) return [];
  const order = session.order ?? [];
  const donnees = repo.votesOf(session.id, participant.id);
  const criteres = session.config.criteria.length ? session.config.criteria.map((c) => c.id) : ['_'];
  const manques = [];
  for (let index = 0; index < Math.min(session.cursor ?? 0, order.length); index++) {
    const sub = repo.submission(order[index]);
    if (!sub || sub.participantId === participant.id) continue;
    const notes = donnees[sub.id] ?? {};
    if (criteres.every((c) => notes[c] !== undefined)) continue;
    manques.push({ index, card: anonymousCard(sub) });
  }
  return manques;
}

function votesView(session, participant) {
  const bySubmission = repo.votesOf(session.id, participant.id);
  if (!Object.keys(bySubmission).length) return {};
  const out = {};
  for (const submission of repo.submissions(session.id)) {
    const given = bySubmission[submission.id];
    if (given) out[submission.renditionId] = given;
  }
  return out;
}

module.exports = {
  authorsVisible, authorOf,
  configView, clockView, rosterView, countsView, assetsView, ownSubmissionView,
  anonymousCard, diffusionView, podiumView,
  commonView, participantView, hostView, screenView, youView,
  chainView, youChainView, aRattraperView,
  rouletteView, youFateView,
  mancheView, extraitCarte, extraitsView, attributionsView, monExtraitView, extraitDuRendu,
  exportView, exportCsv, manchesPasseesView,
  rendusClasses, totalClasses, classer, rangsManche, mancheDevoilee, classementGeneralDe, generalView,
};
