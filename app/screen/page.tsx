import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ScreenClient } from './ScreenClient';

export const metadata: Metadata = {
  title: 'Ecran',
  robots: { index: false, follow: false },
};

export default function ScreenPage() {
  return (
    <Suspense fallback={<div className="center" style={{ minHeight: '100dvh' }}><span className="pill"><span className="dot" /> Chargement…</span></div>}>
      <ScreenClient />
    </Suspense>
  );
}
