/**
 * Icones AGARTHA — trait de 1 px sur une grille de 16, angles droits, aucun arrondi.
 *
 * Un emoji depend de la police du systeme, change d'un appareil a l'autre et devient
 * une tache une fois desature : il ne peut pas servir de signe structurel. Ces
 * chemins sont dessines dans la meme langue que le reste — la grille de 8, le trait
 * plein, l'angle droit — et prennent la couleur du texte qui les entoure.
 */

export type IconName =
  | 'jouer'
  | 'pause'
  | 'suivant'
  | 'precedent'
  | 'son'
  | 'muet'
  | 'micro'
  | 'chrono'
  | 'trophee'
  | 'cible'
  | 'calendrier'
  | 'utilisateur'
  | 'groupe'
  | 'ecran'
  | 'telephone'
  | 'depot'
  | 'fichier'
  | 'image'
  | 'musique'
  | 'liste'
  | 'reglages'
  | 'verrou'
  | 'lien'
  | 'croix'
  | 'valide'
  | 'attention'
  | 'fleche-d'
  | 'fleche-b'
  | 'plus'
  | 'telecharge'
  | 'oeil'
  | 'partage'
;

const PATHS: Record<IconName, string> = {
  'jouer': 'M4 3l9 5-9 5z',
  'pause': 'M4 3h3v10H4zM9 3h3v10H9z',
  'suivant': 'M4 3l6 5-6 5zM11 3h2v10h-2z',
  'precedent': 'M12 3L6 8l6 5zM3 3h2v10H3z',
  'son': 'M3 6h3l4-3v10l-4-3H3zM12 5h1v6h-1zM14 3h1v10h-1z',
  'muet': 'M3 6h3l4-3v10l-4-3H3zM11 6l4 4M15 6l-4 4',
  'micro': 'M6 2h4v7H6zM4 8h1v1h6V8h1v2H9v3h2v1H5v-1h2v-3H4z',
  'chrono': 'M6 0h4v2H6zM7 2h2v1H7zM11 3h2v2h-1V4h-1zM5 4h6v1H5zM3 5h2v1H3zM11 5h2v1h-2zM2 6h1v5H2zM13 6h1v5h-1zM7 6h1v3h2v1H7zM3 11h2v1H3zM11 11h2v1h-2zM5 12h6v1H5z',
  'trophee': 'M4 1h8v5H4zM2 2h2v3H2V4h1V3H2zM12 2h2v3h-2V4h1V3h-1zM5 6h6v1H5zM7 7h2v3H7zM5 10h6v1H5zM4 11h8v2H4z',
  'cible': 'M7 1h2v3H7zM7 12h2v3H7zM1 7h3v2H1zM12 7h3v2h-3zM5 5h6v6H5zm1 1v4h4V6z',
  'calendrier': 'M4 1h1v2H4zM11 1h1v2h-1zM2 3h12v11H2zm1 3v7h10V6z',
  'utilisateur': 'M6 2h4v1H6zM5 3h1v3H5zM10 3h1v3h-1zM6 6h4v1H6zM5 9h6v1H5zM4 10h8v1H4zM3 11h10v3H3z',
  'groupe': 'M3 2h4v3H3zM9 2h4v3H9zM1 7h6v6H1zM9 7h6v6H9z',
  'ecran': 'M1 2h14v9H1zm1 1v7h12V3zM6 12h4v1H6zM4 14h8v1H4z',
  'telephone': 'M4 1h8v14H4zm1 1v10h6V2zM7 13h2v1H7z',
  'depot': 'M7 1h2v7H7zM4 5l4 4 4-4H10V4H6v1zM2 11h12v4H2z',
  'fichier': 'M3 1h7l3 3v11H3zm1 1v12h8V5H9V2z',
  'image': 'M2 3h12v10H2zm1 1v8h10V4zM5 6h2v2H5zM4 11l3-3 2 2 2-2 2 3z',
  'musique': 'M6 2h8v2H6zM6 5h8v1H6zM6 6h1v6H6zM13 4h1v6h-1zM3 10h4v4H3zM10 8h4v4h-4z',
  'liste': 'M2 3h2v2H2zM6 3h8v2H6zM2 7h2v2H2zM6 7h8v2H6zM2 11h2v2H2zM6 11h8v2H6z',
  'reglages': 'M7 1h2v2H7zM7 13h2v2H7zM1 7h2v2H1zM13 7h2v2h-2zM3 3h2v2H3zM11 3h2v2h-2zM3 11h2v2H3zM11 11h2v2h-2zM6 6h4v4H6z',
  'verrou': 'M6 1h4v1H6zM5 2h1v3H5zM10 2h1v3h-1zM3 5h10v9H3zm1 1v7h8V6zM7 8h2v3H7z',
  'lien': 'M2 5h5v2H4v2h3v2H2zM9 5h5v6H9V9h3V7H9z',
  'croix': 'M3 3h2v2H3zM5 5h2v2H5zM7 7h2v2H7zM9 5h2v2H9zM11 3h2v2h-2zM9 9h2v2H9zM11 11h2v2h-2zM5 9h2v2H5zM3 11h2v2H3z',
  'valide': 'M12 3h2v2h-2zM10 5h2v2h-2zM8 7h2v2H8zM6 9h2v2H6zM4 7h2v2H4zM2 9h2v2H2zM4 11h2v2H4z',
  'attention': 'M7 1h2v2H7zM6 3h4v2H6zM5 5h6v2H5zM4 7h8v2H4zM3 9h10v2H3zM2 11h12v2H2zM7 5h2v4H7zM7 10h2v2H7z',
  'fleche-d': 'M2 7h8v2H2zM9 4h2v2H9zM11 6h2v4h-2zM9 10h2v2H9z',
  'fleche-b': 'M7 2h2v8H7zM4 9h2v2H4zM6 11h4v2H6zM10 9h2v2h-2z',
  'plus': 'M7 3h2v10H7zM3 7h10v2H3z',
  'telecharge': 'M7 1h2v7H7zM4 7h2v2H4zM6 9h4v2H6zM10 7h2v2h-2zM2 12h12v2H2z',
  'oeil': 'M5 4h6v1H5zM3 5h2v1H3zM11 5h2v1h-2zM1 6h2v4H1zM13 6h2v4h-2zM3 10h2v1H3zM11 10h2v1h-2zM5 11h6v1H5zM6 6h4v4H6z',
  'partage': 'M10 1h4v4h-4zM10 11h4v4h-4zM2 6h4v4H2zM6 4h2v2H6zM8 5h2v2H8zM6 10h2v2H6zM8 9h2v2H8z',
};

export function Icon({ name, size = 'md', className = '', label }: { name: IconName; size?: 'md' | 'lg' | 'xl'; className?: string; label?: string }) {
  return (
    <svg
      className={`ico ${size !== 'md' ? size : ''} ${className}`}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      fill="currentColor"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
