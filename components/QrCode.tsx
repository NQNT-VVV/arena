'use client';

import { useEffect, useState } from 'react';

/**
 * Le QR code est rendu en SVG par le serveur (`/api/qr`) : pas de bibliotheque
 * cote client, et un vecteur net a n'importe quelle taille de projection.
 *
 * Les deux couleurs sont imposees : du noir sur de l'os. C'est un outil
 * optique avant d'etre un element de decor — on ne l'inverse pas, on ne le
 * dithere pas, et le contraste reste celui du systeme (13.6:1).
 */
const DARK = '#060505';
const LIGHT = '#D9D2C3';

export function QrCode({ text, className }: { text: string; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/qr?text=${encodeURIComponent(text)}&dark=${encodeURIComponent(DARK)}&light=${encodeURIComponent(LIGHT)}`)
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
