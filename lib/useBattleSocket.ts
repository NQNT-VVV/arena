'use client';

import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { clock } from './clock';
import { connect } from './socket';
import type { BattleState, PodiumRating, You } from './types';

export interface BattleSocket {
  socket: Socket | null;
  state: BattleState | null;
  you: You | null;
  connected: boolean;
  /** Faux tant que l'horloge n'a pas ete recalee : le chrono attend. */
  synced: boolean;
  /** Variations d'Elo annoncees par Podium apres le classement, s'il y en a. */
  ratings: PodiumRating[] | null;
}

/**
 * Connexion a une session, cote client.
 *
 * `attach` est rejoue a **chaque** connexion, pas seulement a la premiere. Une
 * socket qui revient apres un tunnel ou un ecran verrouille est une socket
 * neuve pour le serveur : sans reattachement elle serait connectee et pourtant
 * dans aucun salon, donc muette. C'est exactement le cas « un participant perd
 * sa connexion et doit retrouver son etat exact ».
 */
export function useBattleSocket(attach: (socket: Socket) => void | Promise<void>): BattleSocket {
  const [state, setState] = useState<BattleState | null>(null);
  const [you, setYou] = useState<You | null>(null);
  const [connected, setConnected] = useState(false);
  const [synced, setSynced] = useState(false);
  const [ratings, setRatings] = useState<PodiumRating[] | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // Les variations d'Elo appartiennent a une session : une nouvelle edition
  // les efface, sinon le podium suivant afficherait celles de la veille.
  const codeRef = useRef<string | null>(null);

  // `attach` est une closure recreee a chaque rendu ; la garder dans une
  // reference evite de fermer et rouvrir la socket a chaque frappe clavier.
  const attachRef = useRef(attach);
  attachRef.current = attach;

  useEffect(() => {
    const socket = connect();
    socketRef.current = socket;

    const onConnect = async () => {
      setConnected(true);
      await clock.sync(socket);
      setSynced(true);
      await attachRef.current(socket);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (payload: BattleState) => {
      if (codeRef.current !== payload.code) { codeRef.current = payload.code; setRatings(null); }
      setState(payload);
    });
    socket.on('you', (payload: You) => setYou(payload));
    socket.on('podium:ratings', (payload: { ratings?: PodiumRating[] }) => {
      setRatings(Array.isArray(payload?.ratings) ? payload.ratings : null);
    });

    return () => {
      socket.removeAllListeners();
      socket.close();
      socketRef.current = null;
    };
  }, []);

  return { socket: socketRef.current, state, you, connected, synced, ratings };
}
