'use client';

import { useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import { hex } from '@/lib/hex';
import type { PodiumRating, PodiumRow, PodiumState } from '@/lib/types';
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
 *
 * `replay` ouvre la reecoute : a la fin d'une soiree a dix rendus, personne ne
 * se souvient du troisieme, et le telecharger pour l'ecouter est une facon de
 * ne jamais le reecouter. La page le rejoue sur place. Un seul a la fois — deux
 * extraits qui partent ensemble ne font pas deux ecoutes, ils font du bruit.
 */
export function Podium({
  podium, meId, large = false, ratings = null, replay = false,
}: {
  podium: PodiumState;
  meId?: string | null;
  large?: boolean;
  ratings?: PodiumRating[] | null;
  replay?: boolean;
}) {
  /** Le rendu ouvert. Un seul : ouvrir le suivant referme le precedent. */
  const [openId, setOpenId] = useState<string | null>(null);
  if (!podium.total) return <p className="empty"><span>Aucun rendu n’a été déposé</span></p>;
  const ratingOf = new Map((ratings ?? []).map((r) => [r.participantId, r]));

  return (
    <ol className={`${styles.list} ${large ? styles.large : ''}`}>
      {podium.rows.map((row) => {
        if (row.hidden) {
          return (
            <li key={`h-${row.position}`} className={`${styles.row} ${styles.hidden}`}>
              <span className={styles.place}>{hex(row.position)}</span>
              <span className={styles.dots} aria-label="Place non encore annoncée">— — —</span>
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
                {row.author?.pseudo}{mine ? ' · vous' : ''}
                {rating && (
                  <span
                    className={`${styles.rating} ${rating.delta > 0 ? styles.up : rating.delta < 0 ? styles.down : ''}`}
                    title={`Elo Podium : ${rating.before} → ${rating.after}`}
                  >
                    {rating.delta > 0 ? '+' : ''}{rating.delta}{rating.tier ? ` · ${rating.tier.toUpperCase()}` : ''}
                  </span>
                )}
              </span>
              <span className={styles.detail}>
                {row.voters !== undefined && `${hex(row.voters)} / ${hex(row.expected ?? 0)} votes`}
                {row.late && (row.voters !== undefined ? ' · hors délai' : 'hors délai')}
                {row.penalty ? ` · −${row.penalty}` : ''}
                {/*
                  * Le sort ne se melange pas a la penalite.
                  *
                  * Une penalite est une regle annoncee — le depot etait en
                  * retard. Un sort est un hasard assume. Les additionner dans
                  * la meme mention cacherait lequel des deux a joue, et c'est
                  * precisement ce que chacun vient verifier sur sa ligne.
                  */}
                {row.fate ? (
                  <span className={styles.fate}>
                    Sort {row.fate > 0 ? '+' : '−'}{Math.abs(row.fate)}
                  </span>
                ) : null}
              </span>
              {row.criteria && row.criteria.length > 1 && (
                <span className={styles.criteria}>
                  {row.criteria.map((c) => `${c.label.toUpperCase()} ${c.average}`).join(' · ')}
                </span>
              )}
            </span>
            <span className={styles.score}>
              {row.unranked ? <span className={styles.raw}>{row.raw ?? 'HC'}</span> : row.score}
            </span>
            {replay && canReplay(row) && (
              <button
                className="btn xs" aria-expanded={openId === row.rendition!.renditionId}
                onClick={() => setOpenId(openId === row.rendition!.renditionId ? null : row.rendition!.renditionId)}
              >
                <Icon name={openId === row.rendition!.renditionId ? 'pause' : 'jouer'} />
                {replayLabel(row)}
              </button>
            )}
            {/*
              * Le rendu ENTIER, pas l'extrait de diffusion : la route complete est
              * ouverte a tous une fois le classement affiche, mais ce bouton
              * pointait vers l'extrait coupe a la duree d'ecoute. Createurs et
              * spectateurs repartent avec le meme fichier. Rien sur le grand
              * ecran : on le regarde, on n'y clique pas.
              */}
            {!large && row.rendition?.renditionId && (
              <a
                className="btn xs ghost"
                href={`/api/media/${encodeURIComponent(row.rendition.renditionId)}?dl=1`}
                title={row.filename ? `Télécharger ${row.filename}` : 'Télécharger le rendu complet'}
              >
                <Icon name="telecharge" />Télécharger
              </a>
            )}
            {replay && openId === row.rendition?.renditionId && (
              <Replay row={row} onClose={() => setOpenId(null)} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Ce qui peut se rejouer dans la page : un extrait lisible, ou un texte. */
function canReplay(row: PodiumRow): boolean {
  const r = row.rendition;
  if (!r) return false;
  if (r.kind === 'text') return !!r.textBody;
  return !!r.url && r.inline;
}

function replayLabel(row: PodiumRow): string {
  switch (row.rendition?.kind) {
    case 'audio': return 'Réécouter';
    case 'video': return 'Revoir';
    case 'image': return 'Revoir';
    case 'text': return 'Relire';
    default: return 'Rouvrir';
  }
}

/**
 * Le rendu, rejoue sous sa ligne.
 *
 * C'est l'extrait de diffusion qui est servi, pas l'original : le meme que tout
 * le monde a entendu, deja coupe et nettoye de ses metadonnees.
 */
function Replay({ row, onClose }: { row: PodiumRow; onClose: () => void }) {
  const media = useRef<HTMLMediaElement | null>(null);
  const r = row.rendition!;

  return (
    <div className={styles.replay}>
      <div className={styles.replayHead}>
        <span className="meta">{row.filename ?? 'Rendu'}</span>
        <button className="btn xs ghost" onClick={onClose} aria-label="Refermer la réécoute">
          <Icon name="croix" />Fermer
        </button>
      </div>
      {r.kind === 'audio' && r.url && (
        <audio ref={media as React.RefObject<HTMLAudioElement>} className={styles.player} src={r.url} controls autoPlay preload="metadata" />
      )}
      {r.kind === 'video' && r.url && (
        <video ref={media as React.RefObject<HTMLVideoElement>} className={styles.player} src={r.url} controls autoPlay playsInline />
      )}
      {r.kind === 'image' && r.url && <img className={styles.image} src={r.url} alt={row.filename ?? 'Rendu'} />}
      {r.kind === 'text' && r.textBody && <p className={styles.text}>{r.textBody}</p>}
    </div>
  );
}
