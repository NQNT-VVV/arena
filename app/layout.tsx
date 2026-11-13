import type { Metadata, Viewport } from 'next';

import { Aurora } from '@/components/Aurora';
import { Toaster } from '@/components/Toaster';
import { caveat, emoji, fraunces, karla } from '@/lib/fonts';
import './globals.css';

/** Trois barres d'egaliseur sur un pave vert : la marque, reduite a un objet. */
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%231F4E46'/%3E%3Crect x='3' y='8' width='2.4' height='5' rx='.6' fill='%23F2C230'/%3E%3Crect x='6.8' y='3' width='2.4' height='10' rx='.6' fill='%23F2C230'/%3E%3Crect x='10.6' y='6' width='2.4' height='7' rx='.6' fill='%23F2C230'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: { default: 'Arena — Battles créatives', template: '%s — Arena' },
  description:
    'Arena — l’animateur impose des contraintes, les participants créent contre la montre, tout le monde note en aveugle.',
  applicationName: 'Arena',
  icons: { icon: FAVICON },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#E8E2D4' },
    { media: '(prefers-color-scheme: dark)', color: '#1A1714' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * Pose le theme sur <html> avant le premier affichage. Ordre : `?theme=` dans
 * l'adresse (utile pour une source OBS), puis le choix memorise, puis le
 * reglage du systeme.
 */
const THEME_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search).get('theme');var s=null;try{s=localStorage.getItem('arena-theme')}catch(e){}var t=(q==='dark'||q==='light')?q:(s==='dark'||s==='light')?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${fraunces.variable} ${karla.variable} ${caveat.variable} ${emoji.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Aurora />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
