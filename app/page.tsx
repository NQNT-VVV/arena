import Link from 'next/link';

import { Brand } from '@/components/Brand';
import { JoinForm } from '@/components/JoinForm';
import styles from './page.module.css';

const FEATURES = [
  {
    title: 'N’IMPORTE QUEL MEDIA',
    text: 'Beat, montage video, cover, affiche, texte, ou fichier libre. Le type de rendu est un reglage de session, pas une version differente de l’outil.',
  },
  {
    title: 'CHRONO QUI FAIT AUTORITE',
    text: 'Le temps est compte par le serveur. Tous les ecrans affichent la meme seconde, et avancer l’horloge de son telephone ne donne rien.',
  },
  {
    title: 'VOTE REELLEMENT ANONYME',
    text: 'Ni pseudo, ni nom de fichier, ni metadonnee. Les auteurs n’apparaissent qu’au classement — y compris pour l’animateur.',
  },
  {
    title: 'ECRAN DE PROJECTION',
    text: 'Une page plein ecran a partager en visio ou a capturer dans OBS, sans aucun controle dessus.',
  },
];

const EXAMPLES = [
  { icon: '0x01', title: 'BEAT BATTLE', text: '5 samples imposes, une heure, un morceau.' },
  { icon: '0x02', title: 'GRAPHISME', text: '5 captures, tout doit venir de la.' },
  { icon: '0x03', title: 'MONTAGE', text: 'Un pack de rushes, 90 minutes.' },
  { icon: '0x04', title: 'ECRITURE', text: 'Un theme et 5 mots obligatoires.' },
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
          <span className="dot" /> Aucun compte requis · un pseudo suffit
        </span>
        <h1>ARENA</h1>
        <p>
          Des contraintes, un chrono, et tout le monde cree. A la fin, les rendus defilent en
          aveugle, chacun note, et le classement revele les auteurs.
        </p>
      </header>

      <main className={styles.choices}>
        <section className={`card ${styles.choice}`}>
          <div className={styles.icon}>PROCEDURE 0x01</div>
          <h2>J&apos;ANIME LA BATTLE</h2>
          <p className={styles.lead}>
            Choisis le type de rendu, ecris ta consigne, depose tes elements, regle le chrono. Tu
            gardes la main sur chaque phase — y compris pour ajouter du temps quand il le faut.
          </p>
          <Link className="btn primary lg block" href="/host">CREER UNE SESSION</Link>
        </section>

        <section className={`card ${styles.choice} ${styles.join}`}>
          <div className={styles.icon}>PROCEDURE 0x02</div>
          <h2>JE PARTICIPE</h2>
          <p className={styles.lead}>
            Saisis le code annonce, choisis ton pseudo, recupere les elements et lance-toi.
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
        <span>DEJA ANIME UNE SESSION ? <Link href="/host">REPRENDRE LA REGIE</Link> — le lien retrouve ta session en cours.</span>
        <span>Node ag-eu-03 · session consignee</span>
      </footer>
    </div>
  );
}
