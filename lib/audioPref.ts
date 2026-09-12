import { store } from './storage';

/**
 * Le son sort-il de cette surface, sur cet appareil ?
 *
 * Le reglage est par surface ET par appareil, pas seulement par appareil.
 *
 * La regie et l'ecran de projection s'ouvrent presque toujours sur le meme
 * ordinateur — « Ouvrir l'ecran de projection » est un bouton de la regie, qui
 * ouvre un second onglet. Avec une seule cle partagee, activer le son d'un cote
 * l'activait aussi de l'autre au prochain affichage : les deux surfaces jouaient
 * le meme extrait, avec quelques dizaines de millisecondes d'ecart, et le son
 * se melangeait.
 *
 * Une valeur absente signifie « pas encore choisi » : chaque page applique alors
 * le defaut qui lui convient — l'ecran parle, la regie se tait.
 */
export type AudioSurface = 'screen' | 'host' | 'play';

const KEY = (surface: AudioSurface) => `arena.audio.${surface}`;

export const audioPref = {
  get(surface: AudioSurface): boolean | null {
    return store.get<boolean | null>(KEY(surface), null);
  },
  set(surface: AudioSurface, on: boolean): void {
    store.set(KEY(surface), on);
  },
};
