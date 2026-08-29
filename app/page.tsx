import Link from 'next/link';

import { Brand } from '@/components/Brand';
import { JoinForm } from '@/components/JoinForm';
import styles from './page.module.css';

const FEATURES = [
  {
    title: '🎛️ N’importe quel media',
    text: 'Beat, montage video, cover, affiche, texte, ou fichier libre. Le type de rendu est un reglage de session, pas une version differente de l’outil.',
  },
  {
    title: '⏱️ Chrono qui fait autorite',
    text: 'Le temps est compte par le serveur. Tous les ecrans affichent la meme seconde, et avancer l’horloge de son telephone ne donne rien.',
  },
  {
    title: '🕶️ Vote reellement anonyme',
    text: 'Ni pseudo, ni nom de fichier, ni metadonnee. Les auteurs n’apparaissent qu’au classement — y compris pour l’animateur.',
  },
  {
    title: '📺 Ecran de projection',
    text: 'Une page plein ecran a partager en visio ou a capturer dans OBS, sans aucun controle dessus.',
  },
];

const EXAMPLES = [
  { icon: '🎧', title: 'Beat battle', text: '5 samples imposes, une heure, un morceau.' },
  { icon: '🖼️', title: 'Graphisme', text: '5 screenshots, tout doit venir de la.' },
  { icon: '🎬', title: 'Montage', text: 'Un pack de rushes, 90 minutes.' },
  { icon: '✍️', title: 'Ecriture', text: 'Un theme et 5 mots obligatoires.' },
];

export default function HomePage() {
  return (
    <div className={styles.wrap}>
      <div className={styles.topbar}>
        <Brand href={null} />
        <span className={styles.spacer} />
        <Link className="btn sm" href="/screen">📺 Ecran</Link>
      </div>

      <header className={styles.hero}>
        <span className={`pill ${styles.badge}`}>
          <span className="dot" /> Aucun compte requis • un pseudo suffit
        </span>
        <h1>Arena</h1>
        <p>
          Des contraintes, un chrono, et tout le monde cree. A la fin, les rendus defilent en
          aveugle, chacun note, et le classement revele les auteurs.
        </p>
      </header>

      <main className={styles.choices}>
        <section className={`card ${styles.choice}`}>
          <div className={styles.icon}>🎛️</div>
          <h2>J&apos;anime la battle</h2>
          <p className={styles.lead}>
            Choisis le type de rendu, ecris ta consigne, depose tes assets, regle le chrono. Tu
            gardes la main sur chaque phase — y compris pour ajouter du temps quand il le faut.
          </p>
          <Link className="btn primary lg block" href="/host">Creer une session</Link>
        </section>

        <section className={`card ${styles.choice} ${styles.join}`}>
          <div className={styles.icon}>📱</div>
          <h2>Je participe</h2>
          <p className={styles.lead}>
            Saisis le code annonce, choisis ton pseudo, recupere les assets et lance-toi.
          </p>
          <JoinForm className="col" inputClassName={styles.codeInput} />
        </section>
      </main>

      <section className={styles.examples}>
        <h2 className="section-title">Quelques formats</h2>
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
        <p>
          Deja anime une session ? <Link href="/host">Reprendre la regie</Link> — le lien retrouve
          ta session en cours.
        </p>
      </footer>
    </div>
  );
}
