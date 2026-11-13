import Link from 'next/link';
import type { CSSProperties } from 'react';

import { Brand } from '@/components/Brand';
import { JoinForm } from '@/components/JoinForm';
import styles from './page.module.css';

const FEATURES = [
  {
    title: 'N’importe quel média',
    text: 'Beat, montage vidéo, cover, affiche, texte, ou fichier libre. Le type de rendu est un réglage de session, pas une version différente de l’outil.',
  },
  {
    title: 'Chrono qui fait autorité',
    text: 'Le temps est compté par le serveur. Tous les écrans affichent la même seconde, et avancer l’horloge de son téléphone ne donne rien.',
  },
  {
    title: 'Vote réellement anonyme',
    text: 'Ni pseudo, ni nom de fichier, ni métadonnée. Les auteurs n’apparaissent qu’au classement — y compris pour l’animateur.',
  },
  {
    title: 'Écran de projection',
    text: 'Une page plein écran à partager en visio ou à capturer dans OBS, sans aucun contrôle dessus.',
  },
];

const EXAMPLES = [
  { title: 'Beat battle', text: '5 samples imposés, une heure, un morceau.' },
  { title: 'Graphisme', text: '5 captures, tout doit venir de là.' },
  { title: 'Montage', text: 'Un pack de rushes, 90 minutes.' },
  { title: 'Écriture', text: 'Un thème et 5 mots obligatoires.' },
];

const TITLE = ['Des', 'contraintes,', 'un', 'chrono,', 'et', 'tout', 'le', 'monde', 'crée.'];
const PADS = ['#C8442B', '#F2C230', '#F4EFE3', '#D9A074', '#C8442B'];

/** Decale l'entree en scene d'un element : voir `.rise`, `.pop` et `.words` dans le socle. */
const step = (i: number) => ({ '--i': i }) as CSSProperties;

export default function HomePage() {
  const band = EXAMPLES.map((e) => e.title).join(' · ') + ' · cover · affiche · vote en aveugle · ';
  return (
    <div className={styles.wrap}>
      <div className={styles.topbar}>
        <Brand href={null} />
        <span className={styles.spacer} />
        <Link className="btn sm" href="/guide">Le guide</Link>
        <Link className="btn sm" href="/screen">Écran de projection</Link>
      </div>

      <header className={styles.hero}>
        <div className={styles.pitch}>
          <span className={`hand rise ${styles.kicker}`}>battles créatives</span>
          <h1 className={`words ${styles.title}`} aria-label={TITLE.join(' ')}>
            {TITLE.map((word, i) => (
              <span key={i} aria-hidden="true">
                <span className={i >= 5 ? styles.hot : undefined} style={step(i)}>{word}</span>
              </span>
            ))}
          </h1>
          <svg className={styles.stroke} viewBox="0 0 300 22" aria-hidden="true">
            <path d="M4 14 C 60 2, 110 20, 160 10 S 250 4, 296 13" />
          </svg>
          <p className={`rise ${styles.sub}`} style={step(9)}>
            À la fin, les rendus défilent en aveugle, chacun note, et le classement révèle les auteurs.
            Aucun compte requis : un pseudo suffit.
          </p>
          <div className={`rise ${styles.cta}`} style={step(11)}>
            <Link className="btn primary lg" href="/host">Créer une session</Link>
            <a className="btn lg" href="#participer">J’ai un code</a>
          </div>
        </div>

        <div className={styles.stage} aria-hidden="true">
          <div className={`pop ${styles.console}`} style={step(3)}>
            <span className={`eq ${styles.eq}`}><i /><i /><i /><i /><i /><i /><i /><i /><i /></span>
            <div className={styles.pads}>
              {PADS.map((color, i) => <i key={i} style={{ background: color, ...step(i) }} />)}
            </div>
            <span className={`hand ${styles.consoleNote}`}>5 samples imposés</span>
          </div>
          <div className={`pop ${styles.clock}`} style={step(6)}>
            <i className={styles.hand} />
            <b>60:00</b>
          </div>
          <span className={`hand pop ${styles.note}`} style={step(8)}>vote en aveugle</span>
        </div>
      </header>

      <div className={styles.band} aria-hidden="true">
        <div>{band}{band}</div>
      </div>

      <main className={styles.choices}>
        <section className={`on-scroll ${styles.choice} ${styles.host}`}>
          <span className={`hand ${styles.tag}`}>pour l’animateur</span>
          <h2>J’anime la battle</h2>
          <p className={styles.lead}>
            Choisis le type de rendu, écris ta consigne, dépose tes éléments, règle le chrono. Tu
            gardes la main sur chaque phase — y compris pour ajouter du temps quand il le faut.
          </p>
          <Link className={`btn lg block ${styles.gold}`} href="/host">Créer une session</Link>
        </section>

        <section id="participer" className={`on-scroll ${styles.choice} ${styles.join}`}>
          <span className={`hand ${styles.tag}`}>pour les créateurs et les spectateurs</span>
          <h2>Je participe</h2>
          <p className={styles.lead}>
            Saisis le code annoncé, choisis ton pseudo, récupère les éléments et lance-toi.
          </p>
          <JoinForm className="col" inputClassName={styles.codeInput} />
        </section>
      </main>

      <section className={styles.examples}>
        <h2 className="section-title">Quelques formats</h2>
        <div className={styles.exampleGrid}>
          {EXAMPLES.map((e, i) => (
            <div key={e.title} className={`on-scroll ${styles.example}`}>
              <span className={styles.exampleNum} aria-hidden="true">{i + 1}</span>
              <b>{e.title}</b>
              <span>{e.text}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.feats}>
        {FEATURES.map((f) => (
          <div key={f.title} className={`on-scroll ${styles.feat}`}>
            <b>{f.title}</b>
            <span>{f.text}</span>
          </div>
        ))}
      </section>

      <footer className={styles.footer}>
        <span>Déjà animé une session ? <Link href="/host">Reprendre la régie</Link> — le lien retrouve ta session en cours.</span>
      </footer>
    </div>
  );
}
