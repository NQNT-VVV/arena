import Link from 'next/link';

/**
 * Marque de l'application. Le badge « beta » est assume : l'app bouge encore,
 * autant que les participants sachent a quoi s'en tenir avant de signaler un souci.
 */
export function Brand({ compact = false, href = '/' as string | null }) {
  const content = (
    <>
      <span className="brand-mark" aria-hidden="true">🎨</span>
      {!compact && <span className="brand-name">Arena</span>}
      <span className="brand-beta">beta</span>
    </>
  );

  if (!href) return <span className="brand">{content}</span>;
  return <Link className="brand" href={href} aria-label="Arena — accueil">{content}</Link>;
}
