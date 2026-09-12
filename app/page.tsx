import Link from 'next/link';

import { Brand } from '@/components/Brand';
import { JoinForm } from '@/components/JoinForm';
import styles from './page.module.css';

const FEATURES = [
  {
    title: 'N’IMPORTE QUEL MEDIA',
    text: 'BEAT, MONTAGE VIDEO, COVER, AFFICHE, TEXTE, OU FICHIER LIBRE. LE TYPE DE RENDU EST UN REGLAGE DE SESSION, PAS UNE VERSION DIFFERENTE DE L’OUTIL.',
  },
  {
    title: 'CHRONO QUI FAIT AUTORITE',
    text: 'LE TEMPS EST COMPTE PAR LE SERVEUR. TOUS LES ECRANS AFFICHENT LA MEME SECONDE, ET AVANCER L’HORLOGE DE SON TELEPHONE NE DONNE RIEN.',
  },
  {
    title: 'VOTE REELLEMENT ANONYME',
    text: 'NI PSEUDO, NI NOM DE FICHIER, NI METADONNEE. LES AUTEURS N’APPARAISSENT QU’AU CLASSEMENT — Y COMPRIS POUR L’ANIMATEUR.',
  },
  {
    title: 'ECRAN DE PROJECTION',
    text: 'UNE PAGE PLEIN ECRAN A PARTAGER EN VISIO OU A CAPTURER DANS OBS, SANS AUCUN CONTROLE DESSUS.',
  },
];

const EXAMPLES = [
  { icon: '0x01', title: 'BEAT BATTLE', text: '5 SAMPLES IMPOSES, UNE HEURE, UN MORCEAU.' },
  { icon: '0x02', title: 'GRAPHISME', text: '5 CAPTURES, TOUT DOIT VENIR DE LA.' },
  { icon: '0x03', title: 'MONTAGE', text: 'UN PACK DE RUSHES, 90 MINUTES.' },
  { icon: '0x04', title: 'ECRITURE', text: 'UN THEME ET 5 MOTS OBLIGATOIRES.' },
];

export default function HomePage() {
  return (
    <div className={styles.wrap}>
      <div className={styles.topbar}>
        <Brand href={null} />
        <span className={styles.spacer} />
        <Link className="btn sm" href="/screen">ECRAN DE PROJECTION</Link>
      </div>

      <header className={styles.hero}>
        <span className={`pill ${styles.badge}`}>
          <span className="dot" /> AUCUN COMPTE REQUIS · UN PSEUDO SUFFIT
        </span>
        <h1>ARENA</h1>
        <p>
          DES CONTRAINTES, UN CHRONO, ET TOUT LE MONDE CREE. A LA FIN, LES RENDUS DEFILENT EN
          AVEUGLE, CHACUN NOTE, ET LE CLASSEMENT REVELE LES AUTEURS.
        </p>
      </header>

      <main className={styles.choices}>
        <section className={`card ${styles.choice}`}>
          <div className={styles.icon}>PROCEDURE 0x01</div>
          <h2>J&apos;ANIME LA BATTLE</h2>
          <p className={styles.lead}>
            CHOISIS LE TYPE DE RENDU, ECRIS TA CONSIGNE, DEPOSE TES ELEMENTS, REGLE LE CHRONO. TU
            GARDES LA MAIN SUR CHAQUE PHASE — Y COMPRIS POUR AJOUTER DU TEMPS QUAND IL LE FAUT.
          </p>
          <Link className="btn primary lg block" href="/host">CREER UNE SESSION</Link>
        </section>

        <section className={`card ${styles.choice} ${styles.join}`}>
          <div className={styles.icon}>PROCEDURE 0x02</div>
          <h2>JE PARTICIPE</h2>
          <p className={styles.lead}>
            SAISIS LE CODE ANNONCE, CHOISIS TON PSEUDO, RECUPERE LES ELEMENTS ET LANCE-TOI.
          </p>
          <JoinForm className="col" inputClassName={styles.codeInput} />
        </section>
      </main>

      <section className={styles.examples}>
        <h2 className="section-title">QUELQUES FORMATS</h2>
        <div className={styles.exampleGrid}>
          {EXAMPLES.map((e) => (
            <div key={e.title} className={styles.example}>
              <span className={styles.exampleIcon} aria-hidden="true">{e.icon}</span>
              <b>{e.title}</b>
              <span>{e.text}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.feats}>
        {FEATURES.map((f) => (
          <div key={f.title} className={styles.feat}>
            <b>{f.title}</b>
            <span>{f.text}</span>
          </div>
        ))}
      </section>

      <footer className={styles.footer}>
        <span>DEJA ANIME UNE SESSION ? <Link href="/host">REPRENDRE LA REGIE</Link> — LE LIEN RETROUVE TA SESSION EN COURS.</span>
        <span>NODE AG-EU-03 · SESSION CONSIGNEE</span>
      </footer>
    </div>
  );
}
