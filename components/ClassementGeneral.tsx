/**
 * Le classement general : la moyenne des manches.
 *
 * Meme langage que le podium d'une manche — une ligne par joueur, l'or au seul
 * premier — avec le detail des manches sous le pseudo. Une manche sans rendu
 * s'ecrit « — » et compte zero : la ligne le montre, pour que personne ne
 * decouvre la regle au moment du verdict.
 */

import type { GeneralState } from '@/lib/types';
import styles from './ClassementGeneral.module.css';

const fmt = (v: number) => (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '') || '0';

export function ClassementGeneral({
  general,
  rounds,
  large = false,
  mineId = null,
}: {
  general: GeneralState;
  /** Nombre total de manches prevues, pour dire « apres 2 manches sur 3 ». */
  rounds: number;
  large?: boolean;
  /** Le joueur qui regarde, sur son telephone. */
  mineId?: string | null;
}) {
  const fini = general.manches >= rounds;
  return (
    <div className={`${styles.wrap} ${large ? styles.large : ''}`}>
      <p className={styles.legende}>
        {fini
          ? `Classement final — moyenne des ${rounds} manches.`
          : `Apres ${general.manches} manche${general.manches > 1 ? 's' : ''} sur ${rounds} — moyenne, une manche sans rendu compte zero.`}
      </p>
      <ol className={styles.list}>
        {general.rows.map((row) => (
          <li
            key={row.author?.id ?? row.rank}
            className={`${styles.row} ${row.rank === 1 ? styles.top : ''} ${row.author?.id && row.author.id === mineId ? styles.mine : ''}`}
          >
            <span className={styles.place}>{String(row.rank).padStart(2, '0')}</span>
            <span className={styles.who}>
              <span className={styles.pseudo}>
                <span className="avatar sm" aria-hidden="true">{row.author?.avatar}</span>
                {row.author?.pseudo ?? '—'}
              </span>
              <span className={styles.manches}>
                {row.scores.map((s, i) => (
                  <span key={i} className={s === null ? styles.absent : ''}>
                    M{i + 1} {s === null ? '—' : fmt(s)}
                  </span>
                ))}
              </span>
            </span>
            <span className={styles.score}>{fmt(row.moyenne)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
