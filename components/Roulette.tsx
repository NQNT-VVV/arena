'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import { clock } from '@/lib/clock';
import { PHASE_LABELS } from '@/lib/format';
import { hex } from '@/lib/hex';
import { destinataires, revelation, type Frame } from '@/lib/reveal';
import { effectsOf, modeOf, statusOf } from '@/lib/roulette';
import type { Fate, Phase, RouletteState, Spin, YouFate } from '@/lib/types';
import type { PhaseClock } from '@/lib/usePhaseClock';

import styles from './Roulette.module.css';

/**
 * LA ROULETTE — ce que la salle en voit, et ce que chacun en lit.
 *
 * Quelqu'un est tire, un sort est tire. Le tirage appartient au serveur ; ces
 * deux surfaces ne font que le devoiler.
 *
 * DEUX REGISTRES, TOUJOURS LES DEUX A L'ECRAN. Le champ montre tout ce qui
 * pouvait sortir — une plaque par personne, un cran par case, large en
 * proportion de son poids — et il est muet. Le mot porte en tres grand ce qui
 * est pointe a l'instant, et c'est la seule chose qui change.
 *
 * Toute la choregraphie vit dans `lib/reveal.ts`, sans React et sans horloge :
 * ce composant ne fait que rendre l'image dont c'est l'heure. Il n'en deduit
 * rien, et c'est ce qui permet de la tester sans navigateur.
 */

/* ------------------------------------------------------------------ */
/* L'ecran                                                            */
/* ------------------------------------------------------------------ */

/**
 * Le devoilement, sur le grand ecran.
 *
 * Deux temps. La scene pendant la revelation, puis le tirage reste sur la page,
 * parce que c'est la consigne en cours et qu'on doit pouvoir la relire.
 *
 * L'enchainement est entierement local : une seule charge arrive du serveur, et
 * c'est la page qui la deroule — mais elle la deroule depuis `spin.at`, une
 * heure serveur. Deux ecrans branches a deux instants differents affichent donc
 * le meme palier au meme moment.
 */
export function RouletteScreen({ roulette, phase, chrono }: {
  roulette: RouletteState;
  phase: Phase;
  chrono: PhaseClock;
}) {
  const spin = roulette.last;

  const [k, setK] = useState(0);
  const [veil, setVeil] = useState(false);
  const [reduit, setReduit] = useState(false);

  /*
   * La preference se relit, elle ne se capture pas.
   *
   * Une source OBS peut etre rechargee avec d'autres reglages, et la page reste
   * ouverte des heures : lire la requete media une seule fois au montage
   * repondrait longtemps avec une reponse perimee.
   */
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReduit(mq.matches);
    const onChange = () => setReduit(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /*
   * Le tirage passe par une reference.
   *
   * Le mettre en dependance relancerait le devoilement a chaque republication
   * de l'etat — quelqu'un qui se connecte, un rendu qui arrive — en pleine
   * revelation. Seul le changement d'identifiant declenche quelque chose.
   */
  const spinRef = useRef(spin);
  spinRef.current = spin;

  useEffect(() => {
    const s = spinRef.current;
    if (!s) return;
    const r = revelation(s, reduit);

    /*
     * UNE SEULE REGLE, ET ELLE CORRIGE TROIS CHOSES A LA FOIS.
     *
     * L'ecoule se mesure contre `spin.at`, une heure serveur, sur une horloge
     * deja alignee. Au-dela du total, l'etat est pose et il n'y a pas de voile :
     * un tirage d'il y a dix minutes ne se rejoue pas par-dessus une diffusion.
     * En deca, on entre dans la choregraphie a l'ecoule.
     *
     * Consequences : le premier tirage de la session se joue — une garde de
     * rejeu par reference avalait exactement celui-la, puisque le composant
     * n'etait monte qu'a son arrivee ; deux ecrans sont en phase ; une source
     * creee au changement de scene ne rate pas la revelation en cours.
     *
     * AUCUNE MARGE DE TOLERANCE : elle remettrait deux ecrans hors phase.
     */
    const fini = () => {
      setK(r.frames.length - 1);
      setVeil(false);
      // Le grain revient des que la scene se retire, et non au prochain tirage.
      document.body.classList.remove('reveal-on');
    };

    if (clock.now() - s.at >= r.totalMs) { fini(); return; }

    setVeil(true);
    /*
     * Le grain est eteint pendant la revelation.
     *
     * Un bruit statique plein cadre neutralise les macroblocs non reecrits meme
     * sur une image gelee : c'est une taxe de debit permanente, exactement la
     * ou il faut des bits pour les aretes des grandes glyphes. `.grain` est un
     * frere de niveau racine, donc c'est une mutation globale, et elle est
     * declaree comme telle.
     */
    document.body.classList.add('reveal-on');

    let raf = 0;
    /*
     * requestAnimationFrame, et pas setInterval.
     *
     * Une source OBS passee en arriere-plan voit ses minuteurs brides a 1 Hz :
     * un rouleau cadence par setInterval continuerait d'avancer d'un cran par
     * seconde et ressortirait dephase. Avec des horodatages absolus, la reprise
     * se recale d'elle-meme. Et l'etat n'est ecrit que lorsque l'image change :
     * une trentaine de rendus pour tout un mode, pas soixante par seconde.
     */
    const tick = () => {
      const ecoule = clock.now() - s.at;
      if (ecoule >= r.totalMs) { fini(); return; }
      let i = r.at.length - 1;
      while (i > 0 && r.at[i] > ecoule) i--;
      setK((p) => (p === i ? p : i));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.body.classList.remove('reveal-on');
    };
  }, [spin?.id, reduit]);

  const plan = useMemo(() => (spin ? revelation(spin, reduit) : null), [spin?.id, reduit]);

  if (!spin || !plan) return null;
  if (!veil) return <BlocPersistant spin={spin} roulette={roulette} />;

  const frame = plan.frames[Math.min(k, plan.frames.length - 1)];
  const bandeau = phase === 'diffusion';

  return (
    <div className={`${styles.veil} ${bandeau ? styles.bandeau : ''}`}>
      {/*
        La scene ne s'annonce pas.
        Une region vivante qui change vingt-cinq fois en huit secondes noie un
        lecteur d'ecran au lieu de l'informer. Le resultat est annonce une fois,
        par la carte qui reste — et par le telephone de l'interesse.
      */}
      <section className={`${styles.stage} corners`} aria-live="off">
        <Legende spin={spin} roulette={roulette} phase={phase} chrono={chrono} bandeau={bandeau} />
        {bandeau ? (
          <>
            <Reglette spin={spin} frame={frame} />
            <div className={styles.rang}>
              <PlaqueSeule spin={spin} frame={frame} />
              <Mot spin={spin} frame={frame} />
            </div>
          </>
        ) : (
          <>
            <hr className={styles.filet} />
            <Plaques spin={spin} frame={frame} />
            <Reglette spin={spin} frame={frame} />
            <Mot spin={spin} frame={frame} />
            <p className={styles.pied}>{frame.pied}</p>
          </>
        )}
        <span className="corner-b" aria-hidden="true" />
      </section>
    </div>
  );
}

/**
 * La ligne de contexte : quelle roue, quel mode, ou en est la salle.
 *
 * Le voile confisque l'ecran quelques secondes : `TIRAGES` et le chrono sont
 * repris ici, sans quoi ils disparaitraient en pleine creation. Le bandeau, lui,
 * n'a qu'une ligne a donner — il vit sur un rendu qu'on est en train de juger.
 */
function Legende({ spin, roulette, phase, chrono, bandeau }: {
  spin: Spin; roulette: RouletteState; phase: Phase; chrono: PhaseClock; bandeau: boolean;
}) {
  const rappel = [
    chrono.kind === 'creation' ? `CREATION ${chrono.label}`
      : chrono.kind === 'grace' ? `DEPOT ${chrono.label}`
        : PHASE_LABELS[phase],
    // Le compte est public : une roue qu'on relance en secret n'a aucune autorite.
    `TIRAGES ${hex(roulette.spins)}`,
    spin.spent ? 'LA ROUE A REFAIT UN TOUR' : null,
  ].filter(Boolean).join(' · ');

  const tete = (
    <span><Icon name="roue" /> LA ROULETTE · <b>{spin.wheelName.toUpperCase()}</b> · {modeOf(spin)}</span>
  );

  if (bandeau) return <div className={styles.legende}>{tete}<span className={styles.rappel}> · {rappel}</span></div>;
  return (
    <div className={styles.legende}>
      {tete}
      <span className={styles.rappel}>{rappel}</span>
    </div>
  );
}

/**
 * Le champ des sujets.
 *
 * Une roue au-dela de huit noms ne montre plus la salle ; le tableau la montre
 * toujours en entier. Les colonnes et la hauteur de rangee sont posees ici
 * plutot que laissees a `auto-fit` : c'est ce qui garantit qu'aucune plaque ne
 * sort du cadre sur un videoprojecteur, y compris la derniere.
 */
function Plaques({ spin, frame }: { spin: Spin; frame: Frame }) {
  const n = frame.plaques.length;
  if (!n) return <div className={styles.tableau} />;

  const ligne = n > 24;
  const cols = ligne ? 1 : n <= 3 ? n : n <= 8 ? Math.ceil(n / 2) : n <= 18 ? 6 : 8;
  const rangs = Math.ceil(n / cols);
  const hauteur = rangs >= 3 ? '112px' : rangs === 2 ? '160px' : '320px';
  // Au-dela de huit, la plaque retrecit : mieux vaut un cran de moins qu'un nom coupe.
  const dense = n > 8;
  const noms = spin.pool.length ? spin.pool : spin.fates.map((f) => f.pseudo);

  return (
    <div
      className={`${styles.tableau} ${ligne ? styles.ligne : ''} ${dense ? styles.dense : ''}`}
      style={{ '--cols': cols, '--rangs': rangs, '--plaque-h': hauteur } as React.CSSProperties}
    >
      {frame.plaques.map((etat, i) => (
        <div key={`${i}-${noms[i]}`} className={`${styles.plaque} ${etat === 'vide' ? '' : styles[etat]}`}>
          <span className={styles.nom}>{(noms[i] ?? '').toUpperCase()}</span>
          {frame.sorts[i] && <span className={styles.sort}>{frame.sorts[i]}</span>}
        </div>
      ))}
    </div>
  );
}

/** Le meme champ, replie sur une plaque : le bandeau ne mange pas la diffusion. */
function PlaqueSeule({ spin, frame }: { spin: Spin; frame: Frame }) {
  const noms = spin.pool.length ? spin.pool : spin.fates.map((f) => f.pseudo);
  const surLeChamp = frame.champ === 'tableau' && frame.marque !== null;
  const etat = surLeChamp ? 'marque' : frame.plaques.some((p) => p === 'tiree') ? 'tiree' : 'vide';
  const nom = surLeChamp ? (noms[frame.marque as number] ?? '') : destinataires(spin);

  return (
    <div className={`${styles.plaque} ${etat === 'vide' ? '' : styles[etat]}`}>
      <span className={styles.nom}>{nom.toUpperCase()}</span>
    </div>
  );
}

/**
 * Le champ des cases.
 *
 * Un cran par case, large en proportion de son poids : sans cela, le champ
 * annoncerait des chances egales pendant que la regie affiche « POIDS 5 · 40 % ».
 */
function Reglette({ spin, frame }: { spin: Spin; frame: Frame }) {
  if (!frame.crans.length) return null;
  return (
    <div className={styles.reglette} aria-hidden="true">
      {frame.crans.map((etat, i) => (
        <i
          key={i}
          className={etat === 'libre' ? '' : styles[etat]}
          style={{ '--w': Math.max(1, spin.slots[i]?.weight ?? 1) } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/** Le mot : la seule chose qui change, et la seule qu'on lit. */
function Mot({ spin, frame }: { spin: Spin; frame: Frame }) {
  const fate = frame.vedette !== null ? spin.fates[frame.vedette] : null;
  const effects = fate ? effectsOf(fate) : [];
  const status = statusOf(effects);

  return (
    <div className={`${styles.mot} ${frame.vivant ? styles.vivant : ''}`}>
      <span className={styles.sur}>{frame.sur}</span>
      <p
        className={`${styles.texte} ${styles[frame.taille]}`}
        style={{ '--signes': Math.max(1, frame.texte.length) } as React.CSSProperties}
      >
        {frame.texte}
      </p>
      {frame.chips && fate && (
        <span className={styles.chips}>
          {effects.map((e) => (
            <span key={e.text} className={`${styles.effect} ${e.applied ? '' : styles.dead}`}>{e.text}</span>
          ))}
          <span className={`${styles.status} ${status.advice ? styles.advice : ''}`}>{status.short}</span>
        </span>
      )}
    </div>
  );
}

/**
 * Le tirage, une fois la scene retiree.
 *
 * C'est l'etat le plus vu de toute la fonctionnalite : dix minutes de phase
 * contre sept secondes de revelation. Quand un seul sort vaut pour tout le
 * monde, la liste rend UNE ligne et la bande des pseudos — la meme `Fate` par
 * personne donne sinon sept lignes rigoureusement identiques en --t-h2.
 */
function BlocPersistant({ spin, roulette }: { spin: Spin; roulette: RouletteState }) {
  const memeSort = spin.shared && spin.fates.length > 1;

  return (
    <section className={`card pad ${styles.block}`} role="status" aria-live="polite">
      <header className={styles.head}>
        <span><Icon name="roue" />LA ROULETTE · <b>{spin.wheelName}</b></span>
        <span className="grow" />
        <span>{modeOf(spin)}</span>
        <span>TIRAGES <b className="tnum">{hex(roulette.spins)}</b></span>
      </header>

      {memeSort ? (
        <div className={styles.fates}>
          <div className={styles.fate}>
            <FateRead fate={spin.fates[0]} anonyme />
            <span className={styles.tous}>
              {spin.fates.map((f) => <span key={`${f.pseudo}-${f.position}`}>{f.pseudo}</span>)}
            </span>
          </div>
        </div>
      ) : (
        <ol className={styles.fates}>
          {spin.fates.map((f) => (
            <li key={`${f.pseudo}-${f.position}`} className={styles.fate}><FateRead fate={f} /></li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Un sort devoile : qui, quoi, et ce que ca fait vraiment. */
function FateRead({ fate, anonyme = false }: { fate: Fate; anonyme?: boolean }) {
  const effects = effectsOf(fate);
  const status = statusOf(effects);
  return (
    <div className={styles.read}>
      <span className={styles.who}>{anonyme ? 'POUR TOUTE LA SALLE' : fate.pseudo}</span>
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
