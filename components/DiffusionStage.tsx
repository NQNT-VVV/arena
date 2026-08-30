'use client';

import { Rating } from './Rating';
import { SyncedMedia } from './SyncedMedia';
import { humanBytes } from '@/lib/format';
import type { DiffusionState, SessionConfig } from '@/lib/types';
import { useDiffusionClock } from '@/lib/useDiffusionClock';
import styles from './DiffusionStage.module.css';

const SINGLE = [{ id: '_', label: '', weight: 1 }];

/**
 * Le rendu en cours, et la note qu'on lui donne.
 *
 * Rien n'identifie l'auteur : la carte recue du serveur n'en contient pas, et
 * il n'y a donc rien a masquer ici. Le seul cas particulier est le sien —
 * signale par `isMine`, que le participant deduit de son propre canal, jamais
 * de l'etat partage.
 *
 * L'ecoute demarre seule, calee sur l'instant d'ouverture du serveur, et le
 * passage au suivant est lui aussi decide par le serveur : la page affiche ou
 * on en est, elle ne decide de rien.
 */
export function DiffusionStage({
  diffusion,
  config,
  votes,
  isMine,
  onVote,
  canVote = true,
  large = false,
  audio,
  onToggleAudio,
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
  /** Le son sort-il de cet appareil ? */
  audio: boolean;
  onToggleAudio?: (on: boolean) => void;
}) {
  const card = diffusion.current;
  const tick = useDiffusionClock(diffusion);

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
  const timed = card.kind === 'audio' || card.kind === 'video';
  const everyone = diffusion.eligible > 0 && diffusion.voted >= diffusion.eligible;

  const stageLabel = (() => {
    switch (tick.stage) {
      case 'play': return timed ? 'Ecoute' : 'Decouverte';
      case 'vote': return diffusion.advanceAt === null ? 'Votez — l’animateur passera au suivant' : 'Votez';
      case 'over': return diffusion.index >= diffusion.total - 1 ? 'Diffusion terminee' : 'Rendu suivant…';
      default: return '';
    }
  })();

  return (
    <div className={`${styles.stage} ${large ? styles.large : ''}`}>
      <div className={styles.counter}>
        <span className={styles.position}>{diffusion.index + 1}</span>
        <span className="faint">/ {diffusion.total}</span>
        {card.late && <span className="pill" style={{ color: '#ffc9dc' }}>Hors delai</span>}
        <span className="grow" />
        {onToggleAudio && (
          <button
            className="btn xs ghost"
            aria-pressed={audio}
            title={audio ? 'Couper le son sur cet appareil' : 'Jouer le son sur cet appareil'}
            onClick={() => onToggleAudio(!audio)}
          >
            {audio ? '🔊 Son' : '🔇 Muet'}
          </button>
        )}
      </div>

      {/* Ou en est-on : ecoute, vote, ou passage au suivant. */}
      {tick.stage && diffusion.startedAt && diffusion.endsAt && (
        <div className={`${styles.timeline} ${styles[tick.stage]}`}>
          <div className={styles.timelineHead}>
            <span className={styles.stageLabel}>{stageLabel}</span>
            {tick.stage !== 'over' && (tick.seconds > 0 || tick.stage === 'play') && (
              <span className={`${styles.stageTime} tnum`}>{tick.seconds}s</span>
            )}
          </div>
          <div className={styles.bar}><i style={{ transform: `scaleX(${tick.stage === 'over' ? 0 : tick.ratio})` }} /></div>
        </div>
      )}

      <div className={styles.media}>
        {!card.inline && card.url && (
          <a className="btn" href={`${card.url}?dl=1`}>⬇ Telecharger pour ouvrir</a>
        )}

        {card.inline && timed && card.url && diffusion.startedAt && diffusion.endsAt && (
          <SyncedMedia
            src={card.url}
            kind={card.kind === 'video' ? 'video' : 'audio'}
            startedAt={diffusion.startedAt}
            endsAt={diffusion.endsAt}
            fadeSeconds={config.fadeOutS}
            enabled={audio}
            large={large}
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
        {timed && <span>Ecoute limitee a {diffusion.playMaxS} s</span>}
        {card.bytes > 0 && <span>{humanBytes(card.bytes)}</span>}
        <span className="grow" />
        <span className={`${styles.tally} ${everyone ? styles.tallyDone : ''}`}>
          {diffusion.voted} / {diffusion.eligible} ont note{everyone ? ' ✓' : ''}
        </span>
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
