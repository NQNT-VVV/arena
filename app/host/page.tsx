import type { Metadata } from 'next';

import { HostClient } from './HostClient';

export const metadata: Metadata = {
  title: 'Regie',
  // La regie n'a rien a faire dans un moteur de recherche : les liens de
  // session se partagent de la main a la main.
  robots: { index: false, follow: false },
};

export default function HostPage() {
  return <HostClient />;
}
