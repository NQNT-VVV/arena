/**
 * Polices du socle « Bureau », servies par notre propre serveur via next/font.
 *   - Fraunces : titres, chiffres vivants (chrono, score).
 *   - Karla : toute l'interface et le texte courant.
 *   - Caveat : les annotations a la main, posees sur les objets.
 *   - Noto Color Emoji : les avatars.
 * A importer dans app/layout.tsx et poser sur <html>.
 */
import { Caveat, Fraunces, Karla, Noto_Color_Emoji } from 'next/font/google';

export const fraunces = Fraunces({ subsets: ['latin'], weight: 'variable', axes: ['opsz'], variable: '--font-fraunces', display: 'swap' });
export const karla = Karla({ subsets: ['latin'], weight: 'variable', variable: '--font-karla', display: 'swap' });
export const caveat = Caveat({ subsets: ['latin'], weight: 'variable', variable: '--font-caveat', display: 'swap' });
export const emoji = Noto_Color_Emoji({ subsets: ['emoji'], weight: '400', variable: '--font-emoji', display: 'swap', preload: false });
