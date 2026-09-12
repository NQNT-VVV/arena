import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';

import { Aurora } from '@/components/Aurora';
import { Toaster } from '@/components/Toaster';
import './globals.css';

const body = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🎨%3C/text%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: { default: 'Arena — Battles creatives', template: '%s — Arena' },
  description:
    "Arena — l'animateur impose des contraintes, les participants creent contre la montre, tout le monde note en aveugle.",
  applicationName: 'Arena',
  icons: { icon: FAVICON },
};

export const viewport: Viewport = {
  themeColor: '#07060e',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${body.variable} ${display.variable}`}>
      <body>
        <Aurora />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
