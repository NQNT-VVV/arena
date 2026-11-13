'use client';

import { Podium } from '@/components/Podium';
import type { PastRound } from '@/lib/types';

/**
 * Les manches deja jouees : leur classement, et surtout leurs rendus.
 *
 * Des la manche suivante lancee, les rendus de la precedente n'etaient plus
 * joignables nulle part — ni reecoute, ni telechargement — alors qu'ils
 * restent sur le serveur jusqu'a la purge de la session. On les redonne avec
 * le classement, la ou l'on vient les chercher : repliees, pour ne pas noyer
 * le podium de la manche qui vient de se jouer.
 */
export function ManchesPassees({ passees, meId }: { passees: PastRound[] | null | undefined; meId?: string | null }) {
  if (!passees || passees.length === 0) return null;
  return (
    <section className="col">
      <h2 className="section-title">Manches précédentes</h2>
      {passees.map((m) => (
        <details key={m.round}>
          <summary className="meta" style={{ cursor: 'pointer' }}>
            Manche {m.round} · {m.podium.total} rendu{m.podium.total > 1 ? 's' : ''} à réécouter ou télécharger
          </summary>
          <Podium replay podium={m.podium} meId={meId} />
        </details>
      ))}
    </section>
  );
}
