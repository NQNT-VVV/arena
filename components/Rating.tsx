'use client';

import styles from './Rating.module.css';

/**
 * Saisie d'une note.
 *
 * Des boutons tant que le bareme reste petit, un curseur au-dela. Sur
 * telephone — ou se fera l'essentiel des votes — une rangee de six cibles
 * larges se touche sans viser ; vingt cibles ne se touchent plus du tout.
 */
export function Rating({
  scale,
  value,
  disabled,
  disabledReason,
  onChange,
  label,
}: {
  scale: number;
  value: number | null;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (value: number) => void;
  label?: string;
}) {
  const compact = scale <= 10;

  return (
    <div className={styles.wrap}>
      {label && <span className={styles.label}>{label}</span>}

      {compact ? (
        <div className={styles.row} role="group" aria-label={label ?? 'Note'}>
          {Array.from({ length: scale + 1 }, (_, n) => n).slice(1).map((n) => (
            <button
              key={n}
              type="button"
              className={styles.pip}
              aria-pressed={value === n}
              disabled={disabled}
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.slider}>
          <input
            type="range"
            min={0}
            max={scale}
            step={1}
            value={value ?? Math.round(scale / 2)}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={label ?? 'Note'}
          />
          <span className={styles.value}>{value ?? '—'} / {scale}</span>
        </div>
      )}

      {disabled && disabledReason && <span className={styles.reason}>{disabledReason}</span>}
    </div>
  );
}
