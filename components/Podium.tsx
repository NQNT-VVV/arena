'use client';

import { humanBytes } from '@/lib/format';
import type { PodiumRating, PodiumState } from '@/lib/types';
import styles from './Podium.module.css';

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Classement, devoile du dernier au premier.
 *
 * Les lignes non encore annoncees arrivent vides du serveur : il n'y a rien a
 * cacher ici, seulement une place a tenir pour que la liste ne saute pas quand
 * la ligne se remplit.
 *
 * `ratings` : variations d'Elo annoncees par Podium une fois le classement
 * transmis au hub. Absentes quand le jeu n'y est pas branche, ou tant que le
 * hub n'a pas repondu — la ligne s'affiche alors comme avant.
 */
export function Podium({
  podium, meId, large = false, ratings = null,
}: {
  podium: PodiumState;
  meId?: string | null;
  large?: boolean;
  ratings?: PodiumRating[] | null;
}) {
  if (!podium.total) return <p className="empty">Aucun rendu n&apos;a ete depose.</p>;
  const ratingOf = new Map((ratings ?? []).map((r) => [r.participantId, r]));

  return (
    <ol className={`${styles.list} ${large ? styles.large : ''}`}>
      {podium.rows.map((row) => {
        if (row.hidden) {
          return (
            <li key={`h-${row.position}`} className={`${styles.row} ${styles.hidden}`}>
              <span className={styles.place}>{row.position}</span>
              <span className={styles.dots} aria-label="Place non encore annoncee">• • •</span>
            </li>
          );
        }

        const top = row.rank !== null && row.rank !== undefined && row.rank <= 3;
        const mine = meId && row.author?.id === meId;
        const rating = row.author ? ratingOf.get(row.author.id) : undefined;

        return (
          <li
            key={row.author?.id ?? row.position}
            className={`${styles.row} ${top ? styles.top : ''} ${mine ? styles.mine : ''} ${row.unranked ? styles.aside : ''} pop-in`}
          >
            <span className={styles.place}>
              {row.unranked ? 'HC' : (MEDALS[(row.rank ?? 99) - 1] ?? row.rank)}
            </span>
            <span className="avatar lg" aria-hidden="true">{row.author?.avatar}</span>
            <span className={styles.who}>
              <span className={styles.pseudo}>
                {row.author?.pseudo}{mine ? ' (toi)' : ''}
                {rating && (
                  <span
                    className={`${styles.rating} ${rating.delta > 0 ? styles.up : rating.delta < 0 ? styles.down : ''}`}
                    title={`Elo Podium : ${rating.before} → ${rating.after}`}
                  >
                    {rating.delta > 0 ? '+' : ''}{rating.delta}{rating.tier ? ` · ${rating.tier}` : ''}
                  </span>
                )}
              </span>
              <span className={styles.detail}>
                {row.voters} vote{(row.voters ?? 0) > 1 ? 's' : ''} sur {row.expected}
                {row.late && ' • hors delai'}
                {row.penalty ? ` • −${row.penalty}` : ''}
              </span>
              {row.criteria && row.criteria.length > 1 && (
                <span className={styles.criteria}>
                  {row.criteria.map((c) => `${c.label} ${c.average}`).join(' · ')}
                </span>
              )}
            </span>
            <span className={styles.score}>
              {row.unranked ? <span className={styles.raw}>{row.raw}</span> : row.score}
            </span>
            {row.rendition?.url && (
              <a className="btn xs ghost" href={`${row.rendition.url}?dl=1`} title={row.filename ?? 'Telecharger'}>⬇</a>
            )}
          </li>
        );
      })}
    </ol>
  );
}
