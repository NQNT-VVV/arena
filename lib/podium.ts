import type { PodiumIdentity } from './types';

/**
 * Qui est connecte a Podium, vu par ce navigateur.
 *
 * Le serveur lit le cookie signe du hub et rend l'identite ; le client ne
 * manipule jamais le cookie lui-meme. Toute erreur reseau vaut « personne » :
 * le formulaire d'entree reste celui de toujours.
 */
export async function fetchPodiumIdentity(): Promise<PodiumIdentity | null> {
  try {
    const res = await fetch('/api/podium/me', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as PodiumIdentity;
  } catch {
    return null;
  }
}
