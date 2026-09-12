'use client';

import { hex } from '@/lib/hex';
import type { PodiumRating, PodiumState } from '@/lib/types';
import styles from './Podium.module.css';

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
 *
 * Les rangs sont en hexadecimal et le premier porte l'aplat d'or : c'est le
 * seul or de l'ecran.
 */
export function Podium({
  podium, meId, large = false, ratings = null,
}: {
  podium: PodiumState;
  meId?: string | null;
  large?: boolean;
  ratings?: PodiumRating[] | null;
}) {
  if (!podium.total) return <p className="empty"><span>AUCUN RENDU N&apos;A ETE DEPOSE</span></p>;
  const ratingOf = new Map((ratings ?? []).map((r) => [r.participantId, r]));

  return (
    <ol className={`${styles.list} ${large ? styles.large : ''}`}>
      {podium.rows.map((row) => {
        if (row.hidden) {
          return (
            <li key={`h-${row.position}`} className={`${styles.row} ${styles.hidden}`}>
              <span className={styles.place}>{hex(row.position)}</span>
              <span className={styles.dots} aria-label="Place non encore annoncee">— — —</span>
            </li>
          );
        }

        // Seul le premier porte l'or : le systeme ne distribue pas les medailles.
        const top = row.rank === 1;
        const mine = meId && row.author?.id === meId;
        const rating = row.author ? ratingOf.get(row.author.id) : undefined;

        return (
          <li
            key={row.author?.id ?? row.position}
            className={`${styles.row} ${top ? styles.top : ''} ${mine ? styles.mine : ''} ${row.unranked ? styles.aside : ''}`}
          >
            <span className={styles.place}>
              {row.unranked ? 'HC' : hex(row.rank ?? 0)}
            </span>
            <span className="avatar" aria-hidden="true"><span>{row.author?.avatar}</span></span>
            <span className={styles.who}>
              <span className={styles.pseudo}>
                {row.author?.pseudo}{mine ? ' · VOUS' : ''}
                {rating && (
                  <span
                    className={`${styles.rating} ${rating.delta > 0 ? styles.up : rating.delta < 0 ? styles.down : ''}`}
                    title={`ELO PODIUM : ${rating.before} → ${rating.after}`}
                  >
                    {rating.delta > 0 ? '+' : ''}{rating.delta}{rating.tier ? ` · ${rating.tier.toUpperCase()}` : ''}
                  </span>
                )}
              </span>
              <span className={styles.detail}>
                {hex(row.voters ?? 0)} / {hex(row.expected ?? 0)} VOTES
                {row.late && ' · HORS DELAI'}
                {row.penalty ? ` · −${row.penalty}` : ''}
              </span>
              {row.criteria && row.criteria.length > 1 && (
                <span className={styles.criteria}>
                  {row.criteria.map((c) => `${c.label.toUpperCase()} ${c.average}`).join(' · ')}
                </span>
              )}
            </span>
            <span className={styles.score}>
              {row.unranked ? <span className={styles.raw}>{row.raw}</span> : row.score}
            </span>
            {row.rendition?.url && (
              <a className="btn xs ghost" href={`${row.rendition.url}?dl=1`} title={row.filename ?? 'Telecharger'}>OBTENIR</a>
            )}
          </li>
        );
      })}
    </ol>
  );
}
