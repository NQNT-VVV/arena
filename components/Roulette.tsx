'use client';

import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import { hex } from '@/lib/hex';
import { effectsOf, modeOf, statusOf } from '@/lib/roulette';
import type { Fate, RosterEntry, RouletteState, YouFate } from '@/lib/types';

import styles from './Roulette.module.css';

/**
 * LA ROULETTE — ce que la salle en voit, et ce que chacun en lit.
 *
 * Quelqu'un est tire, un sort est tire. Le tirage appartient au serveur ; ces
 * deux surfaces ne font que le devoiler, dans l'ordre ou il est arrive.
 *
 * LE ROULEAU N'EST PAS UNE ROUE DE FETE FORAINE. Une roue qui decelere demande
 * un mouvement fluide, que le systeme interdit — et une deceleration promet
 * toujours la meme chose : que le hasard hesite. Un rouleau qui defile par
 * crans et s'arrete net ne promet rien. C'est plus sec, et beaucoup plus proche
 * de ce qui se joue.
 */

/** Un cran, puis un autre. En dessous de 60 ms l'oeil ne distingue plus les noms. */
const STEP_MS = 70;
/** Assez de crans pour qu'on ne puisse pas suivre le defilement des yeux. */
const MIN_STEPS = 18;
/** Le temps de lire un sort avant que le suivant arrive. */
const FATE_MS = 1300;
/** Le temps de recopier une consigne avant que le voile tombe. */
const HOLD_MS = 5000;

/* ------------------------------------------------------------------ */
/* L'ecran                                                            */
/* ------------------------------------------------------------------ */

/**
 * Le devoilement, sur le grand ecran.
 *
 * Deux temps. Le voile pendant la revelation : le rouleau tourne, s'arrete, et
 * les sorts tombent un par un — sept malus affiches d'un coup ne se lisent pas,
 * ils s'oublient. Puis le voile se retire et le tirage reste sur la page, parce
 * que c'est la consigne en cours et qu'on doit pouvoir la relire.
 *
 * L'enchainement est entierement local : une seule charge arrive du serveur, et
 * c'est la page qui la deroule.
 */
export function RouletteScreen({ roulette, roster }: { roulette: RouletteState; roster: RosterEntry[] }) {
  const spin = roulette.last;

  const [strip, setStrip] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const [veil, setVeil] = useState(false);

  /*
   * Le tirage deja la a l'ouverture de la page ne se rejoue pas.
   *
   * Un ecran qui se reconnecte — cable debranche, onglet recharge — recoit
   * l'etat complet et redevoilerait un sort d'il y a dix minutes, voile
   * compris, par-dessus la diffusion en cours. La valeur initiale d'une
   * reference est celle du premier rendu : c'est exactement cette distinction.
   */
  const knownRef = useRef<string | null>(roulette.last?.id ?? null);
  /*
   * Le tirage et la salle passent par des references.
   *
   * Les mettre en dependances relancerait le devoilement a chaque
   * republication de l'etat — quelqu'un qui se connecte, un rendu qui arrive —
   * en pleine revelation. Seul le changement de tirage declenche quelque chose.
   */
  const spinRef = useRef(spin);
  spinRef.current = spin;
  const rosterRef = useRef(roster);
  rosterRef.current = roster;

  useEffect(() => {
    const current = spinRef.current;
    if (!current) return;

    /*
     * Le rouleau, et son arrivee.
     *
     * L'arrivee est calculee d'abord : le rouleau avance ensuite d'un cran a la
     * fois jusqu'a elle, et le dernier cran EST l'arret. Rien ne ralentit, rien
     * ne glisse — la seule facon de s'arreter net est de ne jamais avoir
     * commence a freiner.
     */
    const names = rosterRef.current.length
      ? rosterRef.current.map((p) => p.pseudo)
      : current.fates.map((f) => f.pseudo);
    const wanted = current.fates[0]?.pseudo ?? names[0];
    let stop = MIN_STEPS;
    for (let i = MIN_STEPS; i < MIN_STEPS + names.length; i++) {
      if (names[i % names.length] === wanted) { stop = i; break; }
    }
    // Une ligne vide en tete pour que le cran courant tombe au milieu, deux de
    // rab en queue pour que la fenetre ait toujours de quoi afficher.
    setStrip(['', ...Array.from({ length: stop + 2 }, (_, i) => names[i % names.length])]);
    setStep(0);
    setRevealed(0);

    if (current.id === knownRef.current) {
      // Deja connu : on l'affiche entier, sans spectacle.
      setStep(stop);
      setRevealed(current.fates.length);
      setVeil(false);
      return;
    }
    setVeil(true);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let reel: ReturnType<typeof setInterval> | undefined;

    const reveal = () => {
      setRevealed(1);
      for (let i = 2; i <= current.fates.length; i++) {
        timers.push(setTimeout(() => setRevealed(i), (i - 1) * FATE_MS));
      }
      timers.push(setTimeout(
        () => setVeil(false),
        Math.max(0, current.fates.length - 1) * FATE_MS + HOLD_MS,
      ));
    };

    // Mouvement reduit : le rouleau saute a son arrivee. Le devoilement un par
    // un reste — ce n'est pas du decor, c'est la lecture.
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reduced || names.length < 2) {
      setStep(stop);
      reveal();
    } else {
      let i = 0;
      reel = setInterval(() => {
        i += 1;
        setStep(i);
        if (i >= stop) { clearInterval(reel); reveal(); }
      }, STEP_MS);
    }

    return () => {
      if (reel) clearInterval(reel);
      timers.forEach((t) => clearTimeout(t));
    };
  }, [spin?.id]);

  if (!spin) return null;
  const spinning = veil && step > 0 && revealed === 0;

  const body = (
    <>
      <header className={styles.head}>
        <span><Icon name="roue" />LA ROULETTE · <b>{spin.wheelName}</b></span>
        <span className="grow" />
        <span>{modeOf(spin)}</span>
        {/* Le compte est public : une roue qu'on relance en secret n'a aucune
            autorite. Il est sur l'ecran de la salle, pas seulement en regie. */}
        <span>TIRAGES <b className="tnum">{hex(roulette.spins)}</b></span>
      </header>

      {veil && (
        <div className={`${styles.window} ${spinning ? styles.spinning : ''}`} aria-hidden="true">
          <div className={styles.strip} style={{ ['--i' as string]: step }}>
            {strip.map((name, i) => (
              <span key={`${i}-${name}`} className={i === step + 1 ? styles.active : ''}>{name}</span>
            ))}
          </div>
          <div className={styles.sight} />
        </div>
      )}

      <ol className={styles.fates}>
        {spin.fates.map((f, i) => (
          <li key={`${f.pseudo}-${f.position}`} className={styles.fate}>
            {i < revealed
              ? <FateRead fate={f} />
              : <span className={styles.pending} aria-label="Sort non encore devoile">— — —</span>}
          </li>
        ))}
      </ol>
    </>
  );

  if (!veil) return <section className={`card pad ${styles.block}`}>{body}</section>;

  return (
    <div className={styles.veil}>
      <div className={`${styles.panel} corners`} role="status" aria-live="polite">
        {body}
        <span className="corner-b" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Un sort devoile : qui, quoi, et ce que ca fait vraiment. */
function FateRead({ fate }: { fate: Fate }) {
  const effects = effectsOf(fate);
  const status = statusOf(effects);
  return (
    <div className={`${styles.read} pop-in`}>
      <span className={styles.who}>{fate.pseudo}</span>
      <span className={styles.what}>{fate.label}</span>
      {fate.detail && <span className={styles.detail}>{fate.detail}</span>}
      <span className={styles.chips}>
        {effects.map((e) => (
          <span key={e.text} className={`${styles.effect} ${e.applied ? '' : styles.dead}`}>{e.text}</span>
        ))}
        <span className={`${styles.status} ${status.advice ? styles.advice : ''}`}>{status.text}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Le telephone                                                       */
/* ------------------------------------------------------------------ */

/**
 * Son sort, sur son telephone.
 *
 * C'est le texte qu'on doit lire et retenir : il est en grand, et il ne part
 * pas. Un sort qui s'effacerait au bout de trois secondes obligerait a le
 * retenir au vol, en pleine creation, avec le chrono qui tourne.
 *
 * Le canal personnel suffit : chaque effet arrive avec son etat, et cette page
 * n'a ni regle a appliquer ni mode de tirage a consulter.
 */
export function OwnFate({ fate }: { fate: YouFate | null }) {
  /*
   * Le sort deja la a l'ouverture de la page ne fait pas vibrer.
   *
   * Il est peut-etre arrive il y a dix minutes : la page ne fait que le
   * retrouver apres un rafraichissement, et une vibration dirait « il vient
   * d'arriver ».
   */
  const knownRef = useRef<string | null>(fate?.spinId ?? null);

  useEffect(() => {
    if (!fate || knownRef.current === fate.spinId) return;
    knownRef.current = fate.spinId;
    // Un telephone pose a plat pendant qu'on cree ne montre rien.
    navigator.vibrate?.([120, 70, 120]);
  }, [fate?.spinId]);

  if (!fate) return null;
  const effects = effectsOf(fate);
  const status = statusOf(effects);

  /*
   * Une clef par tirage : un nouveau sort remplace le noeud, et la coupe
   * d'apparition se rejoue. Sans elle, un sort remplace par un autre changerait
   * le texte sans un battement, et passerait inapercu.
   */
  return (
    <section key={fate.spinId} className={`card pad pop-in ${styles.own}`} role="status" aria-live="polite">
      <header className={styles.head}>
        <span><Icon name="roue" />TON SORT · <b>{fate.wheelName}</b></span>
      </header>
      <h2 className={styles.big}>{fate.label}</h2>
      {fate.detail && <p className={styles.detail}>{fate.detail}</p>}
      <span className={styles.chips}>
        {effects.map((e) => (
          <span key={e.text} className={`${styles.effect} ${e.applied ? '' : styles.dead}`}>{e.text}</span>
        ))}
        <span className={`${styles.status} ${status.advice ? styles.advice : ''}`}>{status.text}</span>
      </span>
      <p className={styles.upshot}>
        {status.advice
          ? 'Rien ne s’applique tout seul : c’est a toi de tenir cette contrainte.'
          : 'L’effet est deja pris en compte. Tu n’as rien a faire de plus.'}
      </p>
    </section>
  );
}
