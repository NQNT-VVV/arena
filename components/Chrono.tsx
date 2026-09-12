import type { PhaseClock } from '@/lib/usePhaseClock';

const LABELS: Record<string, string> = {
  creation: 'Temps de creation',
  grace: 'Fenetre de depot',
};

/**
 * Le compte a rebours, en gros.
 *
 * La barre est animee par `transform` et non par `width` : une largeur animee
 * force le navigateur a recalculer la mise en page a chaque image, ce qui se
 * voit immediatement sur la regie, ou la liste des participants est juste a
 * cote.
 */
export function Chrono({ clock, hint }: { clock: PhaseClock; hint?: string }) {
  const label = clock.paused ? 'En pause' : (LABELS[clock.kind ?? ''] ?? 'En attente');
  const barTone = clock.tone === 'danger' ? 'danger' : clock.tone === 'warn' ? 'warn' : '';

  return (
    <div className="chrono-wrap">
      <span className="chrono-label">{hint ?? label}</span>
      <span
        className={`chrono ${clock.tone}`}
        // Le lecteur d'ecran n'a pas besoin d'entendre chaque seconde : seule
        // la valeur au moment ou l'on interroge la page a un sens.
        aria-live="off"
        role="timer"
      >
        {clock.remainingMs <= 0 && clock.kind ? '00:00' : clock.label}
      </span>
      {clock.kind && (
        <div className={`chrono-bar ${barTone}`}>
          <i style={{ transform: `scaleX(${clock.ratio})` }} />
        </div>
      )}
    </div>
  );
}
