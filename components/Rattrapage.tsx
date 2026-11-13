'use client';

import { Rating } from './Rating';
import { Icon } from '@/components/Icon';
import { hex } from '@/lib/hex';
import type { MissedRendition, SessionConfig } from '@/lib/types';

const SINGLE = [{ id: '_', label: '', weight: 1 }];

/**
 * Les rendus deja passes qu'on n'a pas notes.
 *
 * Le serveur accepte une note sur tout rendu deja diffuse, jusqu'a l'affichage
 * du classement — mais la page ne montrait que le rendu en cours : une note
 * ratee (telephone en veille, tunnel) etait perdue, et comptait pour la note
 * par defaut. La liste vient du canal personnel : elle dit ce qui manque a
 * CETTE personne, et se vide a mesure qu'elle note.
 *
 * Les cartes sont les memes que celles de la diffusion : anonymes. On peut
 * reecouter avant de noter, sans rien imposer a la salle.
 */
export function Rattrapage({
  manques,
  config,
  votes,
  onVote,
}: {
  manques: MissedRendition[];
  config: SessionConfig;
  /** Ses propres notes : { renditionId: { critereId: valeur } }. */
  votes: Record<string, Record<string, number>>;
  onVote: (renditionId: string, criterionId: string, value: number) => void;
}) {
  if (manques.length === 0) return null;
  const criteria = config.criteria.length ? config.criteria : SINGLE;

  return (
    <section className="col">
      <h2 className="section-title">À rattraper ({manques.length})</h2>
      <p className="meta">
        Tu n’as pas noté {manques.length > 1 ? 'ces rendus' : 'ce rendu'} à {manques.length > 1 ? 'leur' : 'son'} passage.
        Tu peux encore le faire jusqu’à l’affichage du classement ; sinon, c’est la note par défaut qui comptera.
      </p>
      {manques.map(({ index, card }) => (
        <div key={card.renditionId} className="col">
          <span className="meta">Rendu {hex(index + 1)}{card.late ? ' · hors délai' : ''}</span>
          {card.inline && card.kind === 'audio' && card.url && (
            <audio src={card.url} controls preload="none" style={{ width: '100%' }} />
          )}
          {card.inline && card.kind === 'video' && card.url && (
            <video src={card.url} controls preload="none" playsInline style={{ width: '100%' }} />
          )}
          {card.inline && card.kind === 'image' && card.url && (
            <a className="btn sm" href={card.url} target="_blank" rel="noreferrer"><Icon name="image" />Revoir l’image</a>
          )}
          {card.kind === 'text' && <p className="brief">{card.textBody}</p>}
          {!card.inline && card.url && (
            <a className="btn sm" href={`${card.url}?dl=1`}><Icon name="telecharge" />Télécharger pour ouvrir</a>
          )}
          {criteria.map((criterion) => (
            <Rating
              key={criterion.id}
              label={criterion.label || undefined}
              scale={config.scale}
              value={votes[card.renditionId]?.[criterion.id] ?? null}
              onChange={(value) => onVote(card.renditionId, criterion.id, value)}
            />
          ))}
        </div>
      ))}
    </section>
  );
}
