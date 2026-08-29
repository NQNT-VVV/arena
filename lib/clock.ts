import type { Socket } from 'socket.io-client';
import { call } from './socket';

/**
 * Horloge alignee sur le serveur.
 *
 * Toutes les pages calculent leurs comptes a rebours a partir des memes
 * horodatages absolus : sans correction de derive, un telephone en avance de
 * deux secondes verrait la manche demarrer trop tot.
 */
export const clock = {
  offset: 0,

  now(): number {
    return Date.now() + this.offset;
  },

  async sync(socket: Socket, samples = 4): Promise<number> {
    const deltas: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      const res = await call<{ serverNow: number }>(socket, 'time:sync');
      if (!res.ok) continue;
      const rtt = Date.now() - t0;
      deltas.push(res.serverNow + rtt / 2 - Date.now());
      await new Promise((r) => setTimeout(r, 60));
    }
    if (deltas.length) {
      deltas.sort((a, b) => a - b);
      this.offset = deltas[Math.floor(deltas.length / 2)];
    }
    return this.offset;
  },
};
