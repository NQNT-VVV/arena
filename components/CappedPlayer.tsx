'use client';

import { useEffect, useRef } from 'react';

/**
 * Lecteur borne dans le temps.
 *
 * Un rendu de six minutes ecoute en entier par quinze personnes, c'est une
 * heure et demie de diffusion pour un seul passage. La duree d'ecoute est donc
 * plafonnee, avec un fondu sur les dernieres secondes pour que la coupure ne
 * soit pas brutale.
 *
 * Deux limites assumees, en attendant le transcodage cote serveur :
 *
 *   - le fondu passe par le volume de l'element, et iOS ignore purement et
 *     simplement l'ecriture de `volume` sur un media. Sur iPhone la coupure
 *     reste nette. L'arret, lui, fonctionne partout.
 *   - la borne est appliquee par la page. Quelqu'un qui ouvre le fichier
 *     directement l'entend en entier — ce n'est pas un secret, juste une
 *     regle de diffusion.
 *
 * Le fichier tronque et fondu par ffmpeg reglera les deux d'un coup.
 */
export function CappedPlayer({
  src,
  kind,
  maxSeconds,
  fadeSeconds,
  className,
}: {
  src: string;
  kind: 'audio' | 'video';
  maxSeconds: number;
  fadeSeconds: number;
  className?: string;
}) {
  const ref = useRef<HTMLMediaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onTime = () => {
      const left = maxSeconds - el.currentTime;
      if (left <= 0) {
        el.pause();
        el.currentTime = 0;
        el.volume = 1;
        return;
      }
      el.volume = fadeSeconds > 0 && left < fadeSeconds
        ? Math.max(0, Math.min(1, left / fadeSeconds))
        : 1;
    };

    // Repartir du debut remet le volume : sans cela une seconde ecoute
    // commencerait au niveau ou la premiere s'est eteinte.
    const onPlay = () => { if (el.currentTime >= maxSeconds) el.currentTime = 0; el.volume = 1; };

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
    };
  }, [src, maxSeconds, fadeSeconds]);

  if (kind === 'video') {
    return (
      <video
        ref={ref as React.RefObject<HTMLVideoElement>}
        className={className}
        src={src}
        controls
        playsInline
        preload="metadata"
      />
    );
  }
  return (
    <audio
      ref={ref as React.RefObject<HTMLAudioElement>}
      className={className}
      src={src}
      controls
      preload="metadata"
    />
  );
}
