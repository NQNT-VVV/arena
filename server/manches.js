'use strict';

/**
 * Le classement general d'une partie en plusieurs manches.
 *
 * Module pur : il recoit le classement de chaque manche deja jouee et rend la
 * moyenne de chacun.
 *
 * LA REGLE, ET POURQUOI
 *
 * La moyenne porte sur TOUTES les manches jouees, et une manche sans rendu
 * compte zero. Moyenner sur les seules manches ou l'on a depose paraissait
 * plus doux ; c'etait surtout une faille : il suffisait de ne jouer que la
 * manche ou l'on se sentait fort pour finir premier devant quelqu'un qui avait
 * tout joue. Un rendu « hors classement » (rendu en retard, selon le reglage)
 * compte zero lui aussi : il a ete ecoute, il n'a pas ete classe.
 *
 * Les ex aequo partagent leur place — 1, 2, 2, 4 — comme dans une manche.
 */

/**
 *   classementGeneral({
 *     manches: [{ round: 1, rows: [{ participantId, score }] }, ...],
 *     participants: [{ id, pseudo, ... }],   // ceux qui peuvent etre classes
 *   }) -> [{ participantId, moyenne, scores: [score|null par manche], joues, rank }]
 *
 * Seuls figurent ceux qui ont depose au moins une fois : quelqu'un qui n'a
 * jamais rien rendu n'a rien a faire en bas d'un classement, a zero.
 */
function classementGeneral({ manches, participants }) {
  const n = manches.length;
  if (!n) return [];
  const connus = new Set(participants.map((p) => p.id));

  const parJoueur = new Map();
  manches.forEach((m, i) => {
    for (const row of m.rows) {
      if (!connus.has(row.participantId)) continue;
      if (!parJoueur.has(row.participantId)) parJoueur.set(row.participantId, new Array(n).fill(null));
      parJoueur.get(row.participantId)[i] = Number.isFinite(row.score) ? row.score : 0;
    }
  });

  const lignes = [...parJoueur.entries()].map(([participantId, scores]) => {
    const total = scores.reduce((s, v) => s + (v ?? 0), 0);
    return {
      participantId,
      moyenne: Math.round((total / n) * 100) / 100,
      scores,
      joues: scores.filter((v) => v !== null).length,
    };
  });

  lignes.sort((a, b) => b.moyenne - a.moyenne || b.joues - a.joues);
  lignes.forEach((l, i) => {
    l.rank = i > 0 && lignes[i - 1].moyenne === l.moyenne ? lignes[i - 1].rank : i + 1;
  });
  return lignes;
}

module.exports = { classementGeneral };
