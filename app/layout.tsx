import type { Metadata, Viewport } from 'next';

import { Aurora } from '@/components/Aurora';
import { Toaster } from '@/components/Toaster';
import { archivo, departure, emoji } from '@/lib/fonts';
import './globals.css';

/** Un filet, deux reperes de coin, un carre de sang : la marque reduite a un signe. */
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'%3E%3Crect width='16' height='16' fill='%23060505'/%3E%3Cpath fill='%23D9D2C3' d='M2 2h5v1H3v4H2zM9 13h5V8h-1v4H9z'/%3E%3Crect x='6' y='6' width='4' height='4' fill='%23E8362C'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: { default: 'Arena — Battles creatives', template: '%s — Arena' },
  description:
    "Arena — l'animateur impose des contraintes, les participants creent contre la montre, tout le monde note en aveugle.",
  applicationName: 'Arena',
  icons: { icon: FAVICON },
};

export const viewport: Viewport = {
  themeColor: '#060505',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${archivo.variable} ${departure.variable} ${emoji.variable}`}>
      <body>
        <Aurora />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
