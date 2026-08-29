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
const repo = require('./repo');
const { signMedia } = require('./util');

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
    allowedExt: config.allowedExt,
    maxFileBytes: config.maxFileBytes,
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
  return {
    participants: roster.length,
    connected: roster.filter((p) => session.isOnline(p.id)).length,
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
    filename: submission.filename,
    bytes: submission.originalBytes,
    kind: submission.kind,
    inline: submission.inline,
    textBody: submission.textBody,
    uploadedAt: submission.uploadedAt,
    late: submission.late,
    status: submission.status,
    replacedCount: submission.replacedCount,
    url: submission.originalKey
      ? `/api/media/${submission.renditionId}?k=${signMedia(config.secret, submission.renditionId)}`
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Vues par audience                                                   */
/* ------------------------------------------------------------------ */

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
    diffusion: null,
    podium: null,
    /** Reference d'horloge : le client s'en sert pour mesurer sa derive. */
    serverNow: Date.now(),
  };
}

/** Ce que voit un participant sur son telephone. */
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
    roster: [...session.participants.values()]
      .filter((p) => !p.isHost)
      .map((p) => ({
        id: p.id,
        pseudo: p.pseudo,
        avatar: p.avatar,
        connected: session.isOnline(p.id),
        disqualified: p.disqualified,
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
    joinedAt: participant.joinedAt,
    submission: ownSubmissionView(repo.submissionOf(session.id, participant.id)),
    votes: {},
  };
}

module.exports = {
  authorsVisible, authorOf,
  configView, clockView, rosterView, countsView, assetsView, ownSubmissionView,
  commonView, participantView, hostView, screenView, youView,
};
