'use client';

import { useEffect, useState } from 'react';

/** Cle de stockage du choix jour / nuit ; lue aussi par le script de app/layout.tsx. */
export const THEME_KEY = 'arena-theme';

/**
 * Interrupteur jour / nuit. Le theme courant vit dans l'attribut `data-theme`
 * de <html>, pose avant le premier affichage ; ici on ne fait que le basculer
 * et memoriser le choix.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === 'dark');
  }, []);

  function toggle() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next ? 'dark' : 'light'); } catch { /* stockage indisponible : le choix vaut pour la page */ }
    setDark(next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? 'Passer en mode clair' : 'Passer en mode sombre'}
      title={dark ? 'Mode clair' : 'Mode sombre'}
    >
      <i aria-hidden="true" />
    </button>
  );
}
