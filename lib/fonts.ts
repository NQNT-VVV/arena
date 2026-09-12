/**
 * Polices AGARTHA, servies par notre propre serveur via next/font.
 *   - Archivo (variable, axe de largeur) : titres, en « expanded » 900.
 *   - Departure Mono : toute l'interface et les donnees.
 *   - Noto Color Emoji : les avatars, rendus en niveaux d'os par CSS.
 * A importer dans app/layout.tsx et poser sur <html> :
 *   className={`${archivo.variable} ${departure.variable} ${emoji.variable}`}
 */
import { Archivo, Noto_Color_Emoji } from 'next/font/google';
import localFont from 'next/font/local';

export const archivo = Archivo({ subsets: ['latin'], weight: 'variable', axes: ['wdth'], variable: '--font-archivo', display: 'swap' });
export const departure = localFont({ src: '../public/fonts/DepartureMono-Regular.woff2', weight: '400', style: 'normal', variable: '--font-departure', display: 'swap' });
export const emoji = Noto_Color_Emoji({ subsets: ['emoji'], weight: '400', variable: '--font-emoji', display: 'swap', preload: false });
