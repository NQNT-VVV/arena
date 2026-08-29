'use client';

import { CappedPlayer } from './CappedPlayer';
import { Rating } from './Rating';
import { humanBytes } from '@/lib/format';
import type { DiffusionState, SessionConfig } from '@/lib/types';
import styles from './DiffusionStage.module.css';

const SINGLE = [{ id: '_', label: '', weight: 1 }];

/**
 * Le rendu en cours, et la note qu'on lui donne.
 *
 * Rien n'identifie l'auteur : la carte recue du serveur n'en contient pas, et
 * il n'y a donc rien a masquer ici. Le seul cas particulier est le sien —
 * signale par `isMine`, que le participant deduit de son propre canal, jamais
 * de l'etat partage.
 */
export function DiffusionStage({
  diffusion,
  config,
  votes,
  isMine,
  onVote,
  canVote = true,
  large = false,
}: {
  diffusion: DiffusionState;
  config: SessionConfig;
  /** Ses propres notes sur ce rendu : { critereId: valeur }. */
  votes: Record<string, number>;
  isMine: boolean;
  onVote?: (criterionId: string, value: number) => void;
  canVote?: boolean;
  /** Mise en page du grand ecran : pas de controle, tout plus gros. */
  large?: boolean;
}) {
  const card = diffusion.current;

  if (!card) {
    return (
      <div className={styles.empty}>
        <span className={styles.icon} aria-hidden="true">🕳️</span>
        <h2>Aucun rendu a diffuser</h2>
        <p className="muted">Personne n&apos;a depose de creation pour cette session.</p>
      </div>
    );
  }

  const criteria = config.criteria.length ? config.criteria : SINGLE;

  return (
    <div className={`${styles.stage} ${large ? styles.large : ''}`}>
      <div className={styles.counter}>
        <span className={styles.position}>{diffusion.index + 1}</span>
        <span className="faint">/ {diffusion.total}</span>
        {card.late && <span className="pill" style={{ color: '#ffc9dc' }}>Hors delai</span>}
      </div>

      <div className={styles.media}>
        {!card.inline && card.url && (
          <a className="btn" href={`${card.url}?dl=1`}>⬇ Telecharger pour ouvrir</a>
        )}

        {card.inline && card.kind === 'audio' && card.url && (
          <CappedPlayer
            className={styles.audio}
            src={card.url}
            kind="audio"
            maxSeconds={diffusion.playMaxS}
            fadeSeconds={config.fadeOutS}
          />
        )}

        {card.inline && card.kind === 'video' && card.url && (
          <CappedPlayer
            className={styles.video}
            src={card.url}
            kind="video"
            maxSeconds={diffusion.playMaxS}
            fadeSeconds={config.fadeOutS}
          />
        )}

        {card.inline && card.kind === 'image' && card.url && (
          <a href={card.url} target="_blank" rel="noreferrer" className={styles.imageLink} title="Ouvrir en grand">
            <img className={styles.image} src={card.url} alt={`Rendu ${diffusion.index + 1}`} />
          </a>
        )}

        {card.kind === 'text' && (
          <pre className={styles.text}>{card.textBody}</pre>
        )}
      </div>

      <div className={styles.meta}>
        {(card.kind === 'audio' || card.kind === 'video') && (
          <span>Ecoute limitee a {diffusion.playMaxS} s</span>
        )}
        {card.bytes > 0 && <span>{humanBytes(card.bytes)}</span>}
        <span className="grow" />
        <span className={styles.tally}>{diffusion.voted} / {diffusion.eligible} ont note</span>
      </div>

      {onVote && (
        <div className={styles.votes}>
          {isMine ? (
            <p className={styles.mine}>
              🪞 C&apos;est ta creation. Tu ne peux pas la noter — les autres s&apos;en chargent.
            </p>
          ) : !canVote ? (
            <p className={styles.mine}>Tu es hors classement : la notation t&apos;est fermee.</p>
          ) : (
            criteria.map((criterion) => (
              <Rating
                key={criterion.id}
                label={criterion.label || undefined}
                scale={config.scale}
                value={votes[criterion.id] ?? null}
                onChange={(value) => onVote(criterion.id, value)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
