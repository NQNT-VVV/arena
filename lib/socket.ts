import { io, type Socket } from 'socket.io-client';
import type { Ack } from './types';

/** Ouvre une connexion Socket.IO vers le serveur qui sert la page. */
export function connect(): Socket {
  return io({ transports: ['websocket', 'polling'] });
}

/**
 * Emet un evenement et attend son accuse de reception.
 * Le serveur attend toujours (charge utile, callback) : on envoie donc un objet
 * vide plutot que `undefined` quand il n'y a rien a transmettre.
 */
export function call<T = Record<string, never>>(
  socket: Socket,
  event: string,
  payload?: unknown,
  timeout = 12000,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (res?: Ack<T>) => {
      if (settled) return;
      settled = true;
      resolve(res ?? { ok: false, error: 'Pas de reponse du serveur.' });
    };
    socket.emit(event, payload ?? {}, done);
    setTimeout(() => done({ ok: false, error: 'Le serveur ne repond pas.' }), timeout);
  });
}
