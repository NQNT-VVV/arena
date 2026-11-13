'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './Pads.module.css';

/**
 * Le mini-jeu des spectateurs, pendant la creation : cinq pads, une suite a retenir qui s'allonge d'une
 * note a chaque tour. Il ne sert qu'a patienter : tout se passe dans le
 * navigateur, rien ne part au serveur, et le record reste sur l'appareil.
 */
const NOTES = [261.63, 329.63, 392.0, 523.25, 659.25];
const COULEURS = ['#C8442B', '#F2C230', '#F4EFE3', '#D9A074', '#6CC2AB'];
const CLE_RECORD = 'arena-pads-record';
const CLE_SON = 'arena-pads-son';

type Etat = 'repos' | 'ecoute' | 'joue' | 'perdu';

export function Pads() {
  const [etat, setEtat] = useState<Etat>('repos');
  const [suite, setSuite] = useState<number[]>([]);
  const [rang, setRang] = useState(0);
  const [allume, setAllume] = useState<number | null>(null);
  const [record, setRecord] = useState(0);
  const [son, setSon] = useState(true);
  const audio = useRef<AudioContext | null>(null);
  const minuteries = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    try {
      setRecord(Number(localStorage.getItem(CLE_RECORD)) || 0);
      setSon(localStorage.getItem(CLE_SON) !== 'non');
    } catch { /* stockage indisponible : le jeu marche sans record */ }
    const liste = minuteries.current;
    return () => { liste.forEach(clearTimeout); audio.current?.close().catch(() => {}); };
  }, []);

  const plusTard = (fn: () => void, ms: number) => { minuteries.current.push(setTimeout(fn, ms)); };

  const note = useCallback((frequence: number, duree = 0.28, forme: OscillatorType = 'triangle') => {
    if (!son) return;
    try {
      audio.current ??= new AudioContext();
      const ctx = audio.current;
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = forme;
      osc.frequency.value = frequence;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duree);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duree + 0.02);
    } catch { /* pas de son sur cet appareil : le jeu reste jouable a l'oeil */ }
  }, [son]);

  /** Rejoue la suite, de plus en plus vite, puis rend la main. */
  const montrer = useCallback((s: number[]) => {
    setEtat('ecoute');
    setRang(0);
    const pas = Math.max(260, 560 - s.length * 22);
    s.forEach((pad, i) => {
      plusTard(() => { setAllume(pad); note(NOTES[pad], pas / 1000 * 0.8); }, 500 + i * pas);
      plusTard(() => setAllume(null), 500 + i * pas + pas * 0.62);
    });
    plusTard(() => setEtat('joue'), 500 + s.length * pas);
  }, [note]);

  const lancer = () => {
    minuteries.current.forEach(clearTimeout);
    minuteries.current = [];
    const premiere = [Math.floor(Math.random() * NOTES.length)];
    setSuite(premiere);
    montrer(premiere);
  };

  const appuyer = (pad: number) => {
    if (etat !== 'joue') return;
    setAllume(pad);
    plusTard(() => setAllume((courant) => (courant === pad ? null : courant)), 180);
    if (pad !== suite[rang]) {
      note(110, 0.5, 'sawtooth');
      setEtat('perdu');
      const score = suite.length - 1;
      if (score > record) {
        setRecord(score);
        try { localStorage.setItem(CLE_RECORD, String(score)); } catch { /* voir plus haut */ }
      }
      return;
    }
    note(NOTES[pad]);
    if (rang + 1 < suite.length) { setRang(rang + 1); return; }
    const suivante = [...suite, Math.floor(Math.random() * NOTES.length)];
    setSuite(suivante);
    setEtat('ecoute');
    plusTard(() => montrer(suivante), 350);
  };

  const basculerSon = () => {
    const prochain = !son;
    setSon(prochain);
    try { localStorage.setItem(CLE_SON, prochain ? 'oui' : 'non'); } catch { /* voir plus haut */ }
  };

  // Une suite de n notes en cours veut dire n - 1 tours deja reussis.
  const reussies = Math.max(0, suite.length - 1);
  const message =
    etat === 'repos' ? 'Retiens la suite, rejoue-la. Elle s’allonge à chaque tour.'
    : etat === 'ecoute' ? 'Écoute…'
    : etat === 'joue' ? `À toi : ${rang + 1} sur ${suite.length}`
    : `Raté. Tu as tenu ${reussies} ${reussies > 1 ? 'notes' : 'note'}.`;

  return (
    <section className={`${styles.jeu} ${etat === 'perdu' ? styles.perdu : ''}`} aria-label="Mini-jeu : les pads">
      <header className={styles.tete}>
        <span className={`hand ${styles.titre}`}>en attendant : les pads</span>
        <button type="button" className={styles.son} onClick={basculerSon} aria-pressed={son}>
          {son ? 'Son activé' : 'Son coupé'}
        </button>
      </header>

      <div className={styles.pads}>
        {COULEURS.map((couleur, i) => (
          <button
            key={i}
            type="button"
            className={`${styles.pad} ${allume === i ? styles.allume : ''}`}
            style={{ background: couleur }}
            onClick={() => appuyer(i)}
            disabled={etat !== 'joue'}
            aria-label={`Pad ${i + 1}`}
          />
        ))}
      </div>

      <p className={styles.message} role="status">{message}</p>

      <footer className={styles.pied}>
        <span className={styles.score}><b>{reussies}</b> score</span>
        <span className={styles.score}><b>{record}</b> record</span>
        {(etat === 'repos' || etat === 'perdu') && (
          <button type="button" className={`btn sm ${styles.jouer}`} onClick={lancer}>
            {etat === 'perdu' ? 'Rejouer' : 'Jouer'}
          </button>
        )}
      </footer>
    </section>
  );
}
