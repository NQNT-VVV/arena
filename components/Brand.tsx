import Link from 'next/link';

/**
 * Marque de l'application. Le pictogramme se tait — le systeme ne decore pas.
 * Le badge « beta » reste : l'application bouge encore.
 */
export function Brand({ compact = false, href = '/' as string | null }) {
  const content = (
    <>
      <span className="brand-mark" aria-hidden="true">🎨</span>
      {!compact && <span className="brand-name">Arena</span>}
      <span className="brand-beta">V0.1 · Beta</span>
    </>
  );

  if (!href) return <span className="brand">{content}</span>;
  return <Link className="brand" href={href} aria-label="Arena — accueil">{content}</Link>;
}
