import { store } from './storage';
import type { SavedIdentity } from './types';

/**
 * Identites conservees dans le navigateur.
 *
 * Une clef par code de session, et non une clef globale : quelqu'un peut suivre
 * deux battles dans deux onglets, et un animateur teste souvent sa session dans
 * un second onglet en participant. Une clef unique melangerait les deux.
 *
 * Le jeton vit dans `localStorage` plutot que dans un cookie parce qu'il est
 * transmis explicitement — a la socket, puis a la requete de televersement.
 * Rien n'est envoye automatiquement avec chaque requete, donc il n'y a aucune
 * surface de falsification de requete inter-site a couvrir.
 */

const playKey = (code: string) => `arena.play.${code.toUpperCase()}`;
const hostKey = (code: string) => `arena.host.${code.toUpperCase()}`;

export const identity = {
  get(code: string): SavedIdentity | null {
    return store.get<SavedIdentity | null>(playKey(code), null);
  },
  save(code: string, value: SavedIdentity): void {
    store.set(playKey(code), value);
  },
  clear(code: string): void {
    store.del(playKey(code));
  },
};

export const hostKeys = {
  get(code: string): string | null {
    return store.get<string | null>(hostKey(code), null);
  },
  save(code: string, token: string): void {
    store.set(hostKey(code), token);
  },
  clear(code: string): void {
    store.del(hostKey(code));
  },
  /** Derniere session pilotee, pour reproposer la regie a l'arrivee. */
  last(): string | null {
    return store.get<string | null>('arena.host.last', null);
  },
  setLast(code: string): void {
    store.set('arena.host.last', code.toUpperCase());
  },
};
