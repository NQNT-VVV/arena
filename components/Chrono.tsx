import type { PhaseClock } from '@/lib/usePhaseClock';

const LABELS: Record<string, string> = {
  creation: 'TEMPS DE CREATION',
  grace: 'FENETRE DE DEPOT',
};

/**
 * Le compte a rebours, en gros.
 *
 * La barre saute par pas, elle ne glisse pas : le temps qui reste est une
 * donnee, pas une animation. Elle est animee par `transform` et non par
 * `width` — une largeur animee force le navigateur a recalculer la mise en
 * page a chaque image, ce qui se voit immediatement sur la regie.
 */
export function Chrono({ clock, hint }: { clock: PhaseClock; hint?: string }) {
  const label = clock.paused ? 'EN PAUSE' : (LABELS[clock.kind ?? ''] ?? 'EN ATTENTE');
  const over = clock.remainingMs <= 0 && !!clock.kind;
  const barTone = over ? 'over' : clock.tone === 'danger' ? 'danger' : clock.tone === 'warn' ? 'warn' : '';

  return (
    <div className="chrono-wrap">
      <span className={`chrono-label ${clock.tone === 'danger' && !over ? 'danger' : ''}`}>{hint ?? label}</span>
      <span
        className={`chrono ${clock.tone}`}
        // Le lecteur d'ecran n'a pas besoin d'entendre chaque seconde : seule
        // la valeur au moment ou l'on interroge la page a un sens.
        aria-live="off"
        role="timer"
      >
        {over ? '00:00' : clock.label}
      </span>
      {clock.kind && (
        <div className={`chrono-bar ${barTone}`}>
          <i style={{ transform: `scaleX(${clock.ratio})` }} />
        </div>
      )}
    </div>
  );
}
