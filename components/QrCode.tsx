'use client';

import { useEffect, useState } from 'react';

/**
 * Le QR code est rendu en SVG par le serveur (`/api/qr`) : pas de bibliotheque
 * cote client, et un vecteur net a n'importe quelle taille de projection.
 */
export function QrCode({ text, className }: { text: string; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/qr?text=${encodeURIComponent(text)}`)
      .then((r) => r.text())
      .then((body) => {
        if (!cancelled) setSvg(body);
      })
      .catch(() => {
        if (!cancelled) setSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!svg) return <div className={className} aria-hidden="true" />;
  return <div className={className} aria-label={`QR code vers ${text}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
