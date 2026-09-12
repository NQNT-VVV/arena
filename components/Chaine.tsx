'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { Icon } from '@/components/Icon';
import { call } from '@/lib/socket';
import { toast } from '@/lib/toast';
import { hex } from '@/lib/hex';
import type { ChainState, YouChain } from '@/lib/types';

import styles from './Chaine.module.css';

/**
 * LA CHAINE — ce que font les spectateurs pendant que les autres creent.
 *
 * Un cadavre exquis, a un tour chacun : on lit la ligne precedente, on en
 * ajoute une, et on passe la main. Personne ne lit l'ensemble avant la fin.
 *
 * Rien ici ne compte pour le classement, et la page le dit : un spectateur est
 * venu juger, pas concourir. Ce jeu remplit une attente, il ne la transforme
 * pas en competition parallele.
 */

/** Secondes restantes avant la fin du tour, recalculees a chaque seconde. */
function useReste(endsAt: number | null): number | null {
  const [reste, setReste] = useState<number | null>(null);
  useEffect(() => {
    if (!endsAt) { setReste(null); return; }
    const tick = () => setReste(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  return reste;
}

export function Chaine({
  socket,
  chain,
  you,
  attendus,
  rendus,
}: {
  socket: Socket | null;
  chain: ChainState;
  you: YouChain;
  attendus: number;
  rendus: number;
}) {
  const [texte, setTexte] = useState('');
  const [busy, setBusy] = useState(false);
  const reste = useReste(chain.turnEndsAt);

  // Le champ se vide quand la main passe : une ligne ecrite pour son tour n'a
  // plus lieu d'etre au tour de quelqu'un d'autre.
  useEffect(() => { if (!you.mine) setTexte(''); }, [you.mine]);

  async function envoyer() {
    const body = texte.trim();
    if (!body || busy || !socket) return;
    setBusy(true);
    const res = await call(socket, 'chain:write', { body });
    setBusy(false);
    if (!res.ok) { toast(res.error, 'err'); return; }
    setTexte('');
  }

  async function passer() {
    if (busy || !socket) return;
    setBusy(true);
    const res = await call(socket, 'chain:pass');
    setBusy(false);
    if (!res.ok) toast(res.error, 'err');
  }

  const restant = you.max - texte.length;

  return (
    <section className={`card pad ${styles.chaine}`}>
      <header className={styles.tete}>
        <span className="meta">LA CHAINE · LIGNE {hex(you.position)}</span>
        <span className="grow" />
        <span className="meta">{hex(rendus)} / {hex(attendus)} ONT RENDU</span>
      </header>

      <h2 className={styles.titre}>UNE LIGNE CHACUN</h2>
      <p className="muted">
        Vous ne voyez que la ligne precedente. Ajoutez la suivante, passez la main, et
        l’histoire entiere se lira quand les createurs auront fini. Rien de tout ceci ne
        compte au classement.
      </p>

      <div className={styles.avant}>
        {you.last ? (
          <>
            <span className="meta">{you.lastBy} A ECRIT</span>
            <blockquote className={styles.ligne}>{you.last}</blockquote>
          </>
        ) : (
          <>
            <span className="meta">PERSONNE N’A ENCORE COMMENCE</span>
            <p className={styles.amorce}>A vous la premiere ligne. Elle donne le ton.</p>
          </>
        )}
      </div>

      {you.mine ? (
        <div className={styles.aVous}>
          <div className={styles.sablier}>
            <span className="meta">A VOUS</span>
            <span className="grow" />
            {reste !== null && (
              <span className={`tnum ${reste <= 15 ? styles.presse : ''}`}>{reste} s</span>
            )}
          </div>
          <div className={styles.piste} aria-hidden="true">
            <i style={{ transform: `scaleX(${reste === null ? 1 : Math.min(1, reste / (chain.turnMs / 1000))})` }} />
          </div>
          <label className="sr-only" htmlFor="chaine-ligne">Votre ligne</label>
          <textarea
            id="chaine-ligne"
            className="input"
            rows={2}
            value={texte}
            maxLength={you.max}
            placeholder="… et la suite ?"
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void envoyer(); }
            }}
          />
          <div className={styles.actions}>
            <span className={`meta ${restant < 30 ? styles.presse : ''}`}>{restant} CARACTERES</span>
            <span className="grow" />
            <button className="btn sm ghost" type="button" onClick={passer} disabled={busy}>PASSER</button>
            <button className="btn sm primary" type="button" onClick={envoyer} disabled={busy || !texte.trim()} aria-busy={busy}>
              <Icon name="suivant" />AJOUTER
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.attente} role="status" aria-live="polite">
          <span className="meta">AU TOUR DE {chain.turn?.pseudo ?? 'QUELQU’UN'}</span>
          {reste !== null && <span className="tnum">{reste} s</span>}
          <p className="muted">Votre tour vient ensuite. Laissez la page ouverte.</p>
        </div>
      )}
    </section>
  );
}

/**
 * La lecture finale, une fois la creation close.
 *
 * On la donne a tout le monde — createurs compris. C'est le moment ou le jeu
 * d'attente devient un moment de la soiree : quelqu'un la lit a voix haute
 * pendant que les rendus se chargent.
 */
export function ChaineLue({ chain }: { chain: ChainState }) {
  if (!chain.revealed || chain.revealed.length === 0) return null;
  return (
    <section className={`card pad ${styles.chaine}`}>
      <header className={styles.tete}>
        <span className="meta">LA CHAINE · {chain.revealed.length} LIGNES</span>
      </header>
      <h2 className={styles.titre}>CE QUE LES SPECTATEURS ONT ECRIT</h2>
      <ol className={styles.recit}>
        {chain.revealed.map((l, i) => (
          <li key={`${l.at}-${i}`}>
            <p className={styles.ligne}>{l.body}</p>
            <span className="meta">{l.pseudo}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
