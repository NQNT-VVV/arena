'use strict';

/**
 * Calcul du classement.
 *
 * Fonction pure : elle prend les rendus, les votes et les reglages, et rend un
 * classement. Aucune base, aucune socket — c'est ce qui permet de verifier au
 * test les cas qui font discuter en fin de soiree (le votant distrait, le
 * rendu hors delai, l'egalite parfaite) sans monter une session entiere.
 */

/** Bareme mono-critere par defaut. */
const SINGLE = [{ id: '_', label: 'Note', weight: 1 }];

/**
 * @param submissions   rendus, avec { id, participantId, late }
 * @param tally         agregat SQL : { submission_id, criterion_id, n, total }
 * @param voterIds      participants en droit de voter (hors disqualifies)
 * @param config        { criteria, defaultVote, scale, latePolicy, latePenalty }
 */
function rank({ submissions, tally, voterIds, config }) {
  const criteria = config.criteria?.length ? config.criteria : SINGLE;
  const weightTotal = criteria.reduce((sum, c) => sum + c.weight, 0) || 1;
  const voters = new Set(voterIds);

  const byKey = new Map();
  for (const row of tally) byKey.set(`${row.submission_id}:${row.criterion_id}`, row);

  const rows = submissions.map((sub) => {
    /**
     * Qui devait noter ce rendu.
     *
     * Tout le monde sauf son auteur. C'est ce denominateur qui rend les notes
     * comparables : sans lui, un rendu vu par trois personnes genereuses
     * passerait devant un rendu vu par dix personnes exigeantes.
     */
    const expected = Math.max(0, voters.size - (voters.has(sub.participantId) ? 1 : 0));

    const perCriterion = criteria.map((criterion) => {
      const row = byKey.get(`${sub.id}:${criterion.id}`);
      const received = row?.n ?? 0;
      const sum = row?.total ?? 0;
      /**
       * Les votants absents comptent pour la note par defaut.
       *
       * Sinon ne pas voter devient une arme : il suffirait de s'abstenir sur
       * tout le monde sauf sur soi-meme pour fausser le classement.
       */
      const missing = Math.max(0, expected - received);
      const average = expected === 0
        ? config.defaultVote
        : (sum + missing * config.defaultVote) / expected;
      return { id: criterion.id, label: criterion.label, weight: criterion.weight, received, average };
    });

    const weighted = perCriterion.reduce((sum, c) => sum + c.average * c.weight, 0) / weightTotal;

    // Un rendu hors delai : selon le reglage, ecarte du classement, ampute, ou
    // traite comme les autres.
    const unranked = sub.late && config.latePolicy === 'unranked';
    const penalty = sub.late && config.latePolicy === 'penalty' ? (config.latePenalty ?? 0) : 0;
    const score = Math.max(0, weighted - penalty);

    return {
      submissionId: sub.id,
      participantId: sub.participantId,
      criteria: perCriterion,
      /** Nombre de votants distincts, tous criteres confondus. */
      voters: Math.max(0, ...perCriterion.map((c) => c.received)),
      expected,
      late: !!sub.late,
      unranked,
      penalty,
      raw: weighted,
      score: unranked ? null : score,
    };
  });

  const ranked = rows.filter((r) => !r.unranked);
  const aside = rows.filter((r) => r.unranked);

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // A egalite : celui qui a recu le plus de votes reels passe devant. Il a
    // ete juge par plus de monde, sa note est mieux etablie.
    if (b.voters !== a.voters) return b.voters - a.voters;
    // Puis un ordre stable, pour que deux affichages ne se contredisent pas.
    return a.submissionId < b.submissionId ? -1 : 1;
  });

  ranked.forEach((row, i) => { row.rank = i + 1; });
  aside.forEach((row) => { row.rank = null; });

  return [...ranked, ...aside];
}

module.exports = { rank, SINGLE };
