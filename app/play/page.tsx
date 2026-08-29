import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PlayClient } from './PlayClient';

export const metadata: Metadata = {
  title: 'Participer',
  robots: { index: false, follow: false },
};

export default function PlayPage() {
  // `useSearchParams` impose une frontiere de suspense : sans elle, Next refuse
  // de prerendre la page au build.
  return (
    <Suspense fallback={<div className="center" style={{ minHeight: '100dvh' }}><span className="pill"><span className="dot" /> Chargement…</span></div>}>
      <PlayClient />
    </Suspense>
  );
}
