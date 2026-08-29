import { Fragment } from 'react';

import { PHASE_STEPS, type Phase } from '@/lib/types';

/**
 * La machine a etats, rendue lisible.
 *
 * Presente sur les trois surfaces : un participant qui arrive en cours de route
 * doit comprendre en un coup d'oeil s'il est encore temps de creer ou s'il
 * s'agit deja de voter. C'est l'information que tout le monde redemande.
 */
export function PhaseRail({ phase }: { phase: Phase }) {
  // Une session archivee a tout traverse : on la montre entierement parcourue
  // plutot que revenue au debut, ce qu'un index introuvable donnerait.
  const current = phase === 'archived' ? PHASE_STEPS.length : PHASE_STEPS.findIndex((s) => s.phase === phase);

  return (
    <ol className="phase-rail" aria-label="Avancement de la session">
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
