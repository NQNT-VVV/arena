'use client';

import { Fragment, useEffect, useRef } from 'react';

import { PHASE_STEPS, type Phase } from '@/lib/types';

/**
 * La machine a etats, rendue lisible.
 *
 * Presente sur les trois surfaces : un participant qui arrive en cours de route
 * doit comprendre en un coup d'oeil s'il est encore temps de creer ou s'il
 * s'agit deja de voter. C'est l'information que tout le monde redemande.
 *
 * Le rail defile horizontalement quand il ne tient pas dans la largeur, et sa
 * barre de defilement est masquee : sans le recentrage automatique, l'etape
 * active finit coupee hors champ des la diffusion — et rien n'indique qu'on
 * peut faire glisser. Le rail vient donc se caler tout seul sur l'etape en
 * cours a chaque changement de phase.
 */
export function PhaseRail({ phase }: { phase: Phase }) {
  const rail = useRef<HTMLOListElement>(null);

  // Une session archivee a tout traverse : on la montre entierement parcourue
  // plutot que revenue au debut, ce qu'un index introuvable donnerait.
  const current = phase === 'archived' ? PHASE_STEPS.length : PHASE_STEPS.findIndex((s) => s.phase === phase);

  useEffect(() => {
    const container = rail.current;
    const active = container?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!container || !active) return;
    // Defilement du seul conteneur, jamais de la page : `scrollIntoView`
    // remonterait aussi la fenetre, ce qui est insupportable au changement de
    // phase quand on lisait la consigne plus bas.
    const box = container.getBoundingClientRect();
    const target = active.getBoundingClientRect();
    const left = container.scrollLeft + (target.left - box.left) - (box.width - target.width) / 2;
    container.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [phase]);

  return (
    <ol ref={rail} className="phase-rail" aria-label="Avancement de la session">
      {PHASE_STEPS.map((step, i) => {
        const cls = i < current ? 'done' : i === current ? 'now' : '';
        return (
          <Fragment key={step.phase}>
            {i > 0 && <li className="link" aria-hidden="true" />}
            <li>
              <span className={`step ${cls}`} aria-current={i === current ? 'step' : undefined}>
                <span className="num" aria-hidden="true">{i < current ? '✓' : i + 1}</span>
                {step.label}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
