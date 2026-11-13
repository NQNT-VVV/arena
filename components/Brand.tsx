import Link from 'next/link';

import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * Marque de l'application, suivie de l'interrupteur jour / nuit : la marque est
 * presente sur toutes les pages, l'interrupteur aussi. Le badge « beta » reste —
 * l'application bouge encore.
 */
export function Brand({ compact = false, href = '/' as string | null }) {
  const content = (
    <>
      {!compact && <span className="brand-name">Arena</span>}
      <span className="brand-beta">Bêta</span>
    </>
  );

  return (
    <>
      {href
        ? <Link className="brand" href={href} aria-label="Arena — accueil">{content}</Link>
        : <span className="brand">{content}</span>}
      <ThemeToggle />
    </>
  );
}
