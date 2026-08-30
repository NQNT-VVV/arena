import { store } from './storage';

/**
 * Le son sort-il de cet appareil ?
 *
 * Reglage par appareil, pas par session : la meme personne peut avoir la regie
 * sur son ordinateur et suivre en participant sur son telephone, et ne veut
 * entendre qu'une fois. Une valeur absente signifie « pas encore choisi », et
 * la page applique alors le defaut qui lui convient.
 */
const KEY = 'arena.audio';

export const audioPref = {
  get(): boolean | null {
    return store.get<boolean | null>(KEY, null);
  },
  set(on: boolean): void {
    store.set(KEY, on);
  },
};
