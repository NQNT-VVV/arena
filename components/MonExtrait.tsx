'use client';

/**
 * « Ton extrait » : ce que le participant doit reconstruire.
 *
 * Le tempo et la tonalite en tres grand — ce sont les deux chiffres qu'on
 * recopie dans son logiciel avant d'ouvrir le moindre plugin. L'ecoute juste
 * en dessous, et le fichier a telecharger pour le glisser dans son projet.
 *
 * Une valeur estimee par la machine est marquee « auto » : elle peut etre
 * fausse d'une octave (87 lu 174) ou d'une relative (do majeur lu la
 * mineur), et mieux vaut le savoir avant de caler tout son projet dessus.
 */

import type { Extrait } from '@/lib/types';
import styles from './MonExtrait.module.css';

export function MonExtrait({ extrait, round, rounds }: { extrait: Extrait; round: number; rounds: number }) {
  const enCours = extrait.analyse === 'attente' || extrait.analyse === 'en_cours';
  return (
    <section className={`card pad ${styles.carte}`} aria-label="Ton extrait">
      <div className={styles.tete}>
        <span className="section-title">TON EXTRAIT</span>
        {rounds > 1 && <span className="pill">MANCHE {round}/{rounds}</span>}
      </div>
      <p className={styles.nom}>{extrait.nom}</p>

      <div className={styles.valeurs}>
        <div className={styles.valeur}>
          <span className={styles.chiffre}>{extrait.bpm !== null ? Math.round(extrait.bpm) : '—'}</span>
          <span className={styles.unite}>
            BPM{extrait.bpm !== null && extrait.bpmSource === 'auto' ? ' · AUTO' : ''}
          </span>
        </div>
        <div className={styles.valeur}>
          <span className={styles.chiffre}>{extrait.tonalite ?? '—'}</span>
          <span className={styles.unite}>
            {extrait.tonaliteNom ? extrait.tonaliteNom.toUpperCase() : 'TONALITE'}
            {extrait.tonalite && extrait.tonaliteSource === 'auto' ? ' · AUTO' : ''}
          </span>
        </div>
      </div>
      {enCours && <p className="meta">Analyse du tempo et de la tonalite en cours…</p>}

      {extrait.url && (
        <>
          {/* preload="none" : sur un telephone en 4G, on ne charge pas le fichier avant qu'on le demande. */}
          <audio className={styles.lecteur} controls preload="none" src={extrait.url} />
          <a className="btn block" href={`${extrait.url}&dl=1`} download={extrait.nom}>
            Telecharger l&apos;extrait
          </a>
        </>
      )}
    </section>
  );
}
