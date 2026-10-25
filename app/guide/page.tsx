/**
 * Le guide de l'animateur.
 *
 * Une page statique, sans socket ni compte : on la lit avant la soiree, on la
 * garde ouverte dans un onglet pendant. Elle montre ou cliquer plutot qu'elle
 * n'explique : une etape par geste, deux ou trois lignes, une capture ou le
 * bouton a cliquer est entoure. Les cas particuliers sont replies.
 *
 * Le choix du mode, en haut, masque ce qui ne concerne pas l'autre mode. Il
 * tient sans JavaScript : deux boutons radio et `:has()` dans la feuille de
 * style. Les etapes se numerotent par compteur CSS, pour que la numerotation
 * suive ce qui est affiche.
 *
 * Les captures viennent d'une vraie partie de banc, a l'echelle 2 ; quand
 * l'interface change, elles se refont avec `~/.chrome-deps/capture-guide.mjs`.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Brand } from '@/components/Brand';
import styles from './guide.module.css';

export const metadata: Metadata = {
  title: 'Guide de l’animateur — Arena',
  description: 'Animer une soiree Arena, bouton par bouton : Beat Battle, Rebuild The Track, plusieurs manches.',
};

/** Un libelle de bouton de la regie, tel qu'il apparait a l'ecran. */
function B({ children, plein = false }: { children: ReactNode; plein?: boolean }) {
  return <span className={`${styles.bouton} ${plein ? styles.plein : ''}`}>{children}</span>;
}

/** Le numero rouge qui renvoie a la capture. */
function N({ children }: { children: ReactNode }) {
  return <span className={styles.num}>{children}</span>;
}

function Capture({ nom, alt, l, h, legende, telephone = false, className = '' }: {
  nom: string; alt: string; l: number; h: number; legende?: string; telephone?: boolean; className?: string;
}) {
  const src = `/guide/${nom}.webp`;
  return (
    <figure className={`${styles.figure} ${telephone ? styles.telephone : ''} ${className}`}>
      {/* Un clic ouvre la capture en taille reelle. */}
      <a href={src} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} width={l} height={h} loading="lazy" />
      </a>
      {legende && <figcaption>{legende}</figcaption>}
    </figure>
  );
}

function Etape({ titre, captures, large = false, className = '', children }: {
  titre: string; captures?: ReactNode; large?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <article className={`${styles.etape} ${large ? styles.large : ''} ${className}`}>
      <div className={styles.texte}>
        <h3 className={styles.titreEtape}><span className={styles.numero} />{titre}</h3>
        {children}
      </div>
      {captures && <div className={styles.captures}>{captures}</div>}
    </article>
  );
}

function Plus({ question, children, className = '' }: { question: string; children: ReactNode; className?: string }) {
  return (
    <details className={`${styles.plus} ${className}`}>
      <summary>{question}</summary>
      <div className={styles.reponse}>{children}</div>
    </details>
  );
}

const FLUX: Array<{ bouton: string; quand: string; plusieurs?: boolean }> = [
  { bouton: 'Ouvrir le lobby', quand: 'les joueurs entrent' },
  { bouton: '▶ Lancer la manche 1', quand: 'le chrono part' },
  { bouton: 'Clore la creation', quand: 'le chrono est fini' },
  { bouton: 'Lancer la diffusion', quand: 'on ecoute, on note' },
  { bouton: 'Afficher les resultats', quand: 'apres le dernier rendu' },
  { bouton: 'Devoiler la place suivante', quand: 'du dernier au premier' },
  { bouton: 'Lancer la manche 2', quand: 's’il reste des manches', plusieurs: true },
];

export default function GuidePage() {
  return (
    <>
      <header className="topbar">
        <Brand compact />
        <span className="grow">
          <span className="session-name">Guide de l&apos;animateur</span>
        </span>
        <a className="btn sm" href="/host">Ouvrir la regie</a>
      </header>

      <main className={`shell ${styles.guide}`}>
        <header className={styles.intro}>
          <h1>ANIMER UNE SOIREE ARENA</h1>
          <p className={styles.chapeau}>
            Tu pilotes tout depuis la regie, sur ton ordinateur. Les joueurs n&apos;ont besoin que de leur telephone.
            Voici ou cliquer, dans l&apos;ordre.
          </p>
          <fieldset className={styles.choix}>
            <legend>TA SOIREE</legend>
            <label>
              <input type="radio" name="mode" className={styles.choixRebuild} defaultChecked />
              <span>REBUILD THE TRACK</span>
            </label>
            <label>
              <input type="radio" name="mode" className={styles.choixBattle} />
              <span>BEAT BATTLE</span>
            </label>
          </fieldset>
          <p className={`${styles.modeAide} ${styles.rebuild}`}>Chacun recoit un extrait different et le reconstruit.</p>
          <p className={`${styles.modeAide} ${styles.battle}`}>Tout le monde cree sur la meme consigne.</p>
        </header>

        <section className={styles.antiseche} aria-labelledby="antiseche">
          <h2 id="antiseche" className="section-title">LA SOIREE EN UN COUP D&apos;OEIL</h2>
          <p>
            Tout se passe dans le <b>cadre du chrono</b>, en haut a gauche de la regie. Le bouton plein, c&apos;est
            presque toujours l&apos;etape suivante.
          </p>
          <ol className={styles.flux}>
            {FLUX.map((f) => (
              <li key={f.bouton} className={f.plusieurs ? styles.plusieurs : undefined}>
                <B plein>{f.bouton}</B>
                <span className={styles.quand}>{f.quand}</span>
              </li>
            ))}
          </ol>
          <nav className={styles.sommaire} aria-label="Dans ce guide">
            <a href="#avant">Avant la soiree</a>
            <a href="#pendant">Pendant chaque manche</a>
            <a href="#fin">A la fin</a>
            <a href="#problemes">Ca coince ?</a>
          </nav>
        </section>

        <section className={styles.groupe} aria-labelledby="avant">
          <header className={styles.groupeTete}>
            <h2 id="avant" className="section-title">AVANT LA SOIREE</h2>
            <p>Dix minutes, la veille ou juste avant.</p>
          </header>

          <Etape
            titre="Cree la session"
            captures={(
              <>
                <Capture nom="creer" l={629} h={400} className={styles.rebuild} alt="Le formulaire de creation en Rebuild The Track : le mode et le nombre de manches entoures" />
                <Capture nom="creer-battle" l={629} h={400} className={styles.battle} alt="Le formulaire de creation en Beat Battle : le mode et le nombre de manches entoures" />
              </>
            )}
          >
            <p>
              Ouvre la <a href="/host">regie</a>. Donne un nom, choisis le mode <N>1</N>, le nombre de manches et
              leur duree <N>2</N>. Termine par <B plein>Creer la session</B>, tout en bas.
            </p>
            <p className={styles.battle}>Ecris aussi la consigne : elle s&apos;affiche sur tous les telephones.</p>
            <p className={styles.discret}>Le reste est range dans « Reglages avances » : pas besoin d&apos;y toucher.</p>
          </Etape>

          <Etape
            titre="Depose les extraits"
            className={styles.rebuild}
            large
            captures={<Capture nom="extraits" l={1089} h={560} alt="La carte des extraits : le bouton pour deposer et les champs tempo et tonalite entoures" />}
          >
            <p>
              Glisse tes morceaux dans la carte « Extraits a reconstruire » <N>1</N> : wav, mp3 ou flac, plusieurs
              d&apos;un coup. Arena trouve tout seul le tempo et la tonalite <N>2</N>.
            </p>
            <p>
              Compte un extrait par createur et par manche : 8 createurs et 3 manches, 24 extraits. Avec moins, certains
              auront le meme.
            </p>
            <Plus question="Le tempo ou la tonalite est faux ?">
              <p>
                Tempo double ou moitie du vrai (174 au lieu de 87) : clique <B>×2</B> ou <B>/2</B>. Tonalite fausse :
                tape la bonne, par exemple <code>Am</code>, <code>C#m</code>, <code>F#</code> ou <code>Bb</code>.
                Ce que tu corriges n&apos;est plus jamais recalcule.
              </p>
            </Plus>
          </Etape>

          <Etape
            titre="Ouvre le lobby"
            captures={<Capture nom="ouvrir-lobby" l={662} h={386} alt="Le cadre du chrono avec le bouton Ouvrir le lobby entoure" />}
          >
            <p>Clique <B plein>Ouvrir le lobby</B> dans le cadre du chrono. Les joueurs peuvent maintenant entrer.</p>
          </Etape>

          <Etape
            titre="Fais venir les joueurs"
            captures={<Capture nom="inviter" l={436} h={736} alt="La carte Inviter : le lien pour creer et le bouton de l'ecran de projection entoures" />}
          >
            <p>
              Envoie le lien « pour creer » <N>1</N> sur Discord, ou montre le QR code. Chacun choisit un pseudo sur son
              telephone.
            </p>
            <p>
              Pour le stream, <B>Ouvrir l&apos;ecran de projection</B> <N>2</N> donne l&apos;adresse a coller dans OBS :
              une source navigateur en 1920 × 1080.
            </p>
            <Plus question="Et ceux qui veulent juste noter ?">
              <p>
                Envoie-leur le lien « pour juger sans creer ». Ils notent comme tout le monde, mais ne deposent rien et
                ne peuvent pas gagner. A envoyer avant l&apos;ecoute : apres, on n&apos;entre plus.
              </p>
            </Plus>
          </Etape>
        </section>

        <section className={styles.groupe} aria-labelledby="pendant">
          <header className={styles.groupeTete}>
            <h2 id="pendant" className="section-title">PENDANT CHAQUE MANCHE</h2>
            <p>Les memes gestes, a chaque manche.</p>
          </header>

          <Etape
            titre="Lance la manche"
            captures={(
              <>
                <Capture nom="lancer" l={662} h={404} alt="Le cadre du chrono avec le bouton Lancer la manche 1 entoure" />
                <Capture
                  nom="telephone-extrait" l={358} h={386} telephone className={styles.rebuild}
                  alt="Le telephone d'un createur : son extrait, son tempo et sa tonalite"
                  legende="Sur le telephone d'un createur."
                />
              </>
            )}
          >
            <p>
              Clique <B plein>▶ Lancer la manche 1</B>. Le chrono part pour tout le monde. S&apos;il n&apos;y a
              qu&apos;une manche, le bouton s&apos;appelle <B plein>▶ Lancer la creation</B>.
            </p>
            <p className={styles.rebuild}>
              Chaque createur recoit aussitot son extrait sur son telephone : le tempo, la tonalite, et le fichier a
              telecharger.
            </p>
          </Etape>

          <Etape
            titre="Pendant que ca cree"
            captures={<Capture nom="creation" l={662} h={363} alt="Le chrono en cours : le bouton plus cinq minutes et le bouton Clore la creation entoures" />}
          >
            <p>Le chrono est a toi : ajoute du temps <N>1</N> ou mets en pause. Tout le monde le voit bouger.</p>
            <p>
              A la fin, clique <B plein>Clore la creation</B> <N>2</N>. Les retardataires ont encore deux minutes pour
              deposer.
            </p>
            <Plus question="Changer l'extrait de quelqu'un ?" className={styles.rebuild}>
              <p>
                Il le connait par coeur, ou le fichier est abime : dans « Qui reconstruit quoi », sous les extraits,
                choisis-en un autre. Son telephone se met a jour tout seul.
              </p>
              <Capture nom="qui-quoi" l={1047} h={217} alt="La liste Qui reconstruit quoi, avec le choix de l'extrait d'un joueur entoure" />
            </Plus>
          </Etape>

          <Etape
            titre="Lance l'ecoute"
            captures={<Capture nom="diffuser" l={662} h={368} alt="Le cadre du chrono avec le bouton Lancer la diffusion entoure" />}
          >
            <p>
              Clique <B plein>Lancer la diffusion</B>. Si tout le monde a deja depose, inutile d&apos;attendre la fin des
              deux minutes : la phrase au-dessus du bouton compte les rendus recus.
            </p>
          </Etape>

          <Etape
            titre="Laisse tourner l'ecoute"
            captures={(
              <>
                <Capture nom="ecoute" l={662} h={449} alt="Les commandes de l'ecoute : l'enchainement automatique et le bouton Afficher les resultats entoures" />
                <Capture
                  nom="telephone-vote" l={390} h={640} telephone
                  alt="Le telephone pendant l'ecoute : le rendu en cours, l'extrait d'origine et les notes de 1 a 5"
                  legende="Sur les telephones : le rendu en cours et les notes."
                />
              </>
            )}
          >
            <p>
              Les rendus passent un par un, sans le nom de leur auteur. Chacun note sur son telephone.
              <span className={styles.rebuild}> L&apos;ecran rappelle quel extrait chaque rendu reconstruit.</span>
            </p>
            <p>
              Arena passe seul au rendu suivant <N>1</N>. Pour commenter entre deux rendus, coupe l&apos;enchainement :
              tu avances alors avec <B>Suivant</B>.
            </p>
            <p>Apres le dernier rendu : <B plein>Afficher les resultats</B> <N>2</N>.</p>
          </Etape>

          <Etape
            titre="Devoile le classement"
            captures={<Capture nom="devoiler" l={662} h={557} alt="Les resultats : le bouton Devoiler la place suivante entoure" />}
          >
            <p>
              Clique <B plein>Devoiler la place suivante</B> une fois par joueur : du dernier au premier, c&apos;est la que
              se fait le suspense. Pour aller vite : <B>Tout devoiler</B>.
            </p>
            <p>Avec plusieurs manches, le classement general s&apos;affiche a cote, une fois tout devoile.</p>
          </Etape>

          <Etape
            titre="Passe a la manche suivante"
            captures={<Capture nom="manche-suivante" l={662} h={574} alt="Apres le classement : la duree de la manche suivante et le bouton Lancer la manche 2 entoures" />}
          >
            <p>
              Regle la duree de la prochaine manche <N>1</N>, puis <B plein>Lancer la manche 2</B> <N>2</N>. Les joueurs,
              le code et l&apos;ecran restent ; rendus, votes et chrono repartent de zero.
            </p>
            <p className={styles.rebuild}>Chacun recoit un nouvel extrait, jamais un qu&apos;il a deja reconstruit.</p>
            <p className={styles.discret}>Le bouton attend que tout le classement soit devoile.</p>
          </Etape>
        </section>

        <section className={styles.groupe} aria-labelledby="fin">
          <header className={styles.groupeTete}>
            <h2 id="fin" className="section-title">A LA FIN</h2>
          </header>

          <Etape
            titre="Le classement final"
            large
            captures={(
              <Capture
                nom="ecran-final" l={1280} h={720}
                alt="L'ecran de projection a la fin : la derniere manche a gauche, le classement general a droite"
                legende="L'ecran a la fin : la derniere manche a gauche, le classement general a droite."
              />
            )}
          >
            <p>
              Apres la derniere manche, l&apos;ecran affiche le <b>classement general</b> : la moyenne de toutes les
              manches. Une manche sans rendu compte zero, sinon il suffirait de ne jouer que celle ou l&apos;on se sent
              fort.
            </p>
            <p className={styles.exemple}>Ines : 3 a la manche 1, rien a la 2, 5 a la 3 → (3 + 0 + 5) / 3 = <b>2,67</b></p>
            <p>
              Dans la regie : les resultats en <B>CSV</B> ou <B>JSON</B>, et <B>Relancer</B>, sous « Nouvelle edition »,
              pour rejouer avec les memes reglages et de nouveaux joueurs.
            </p>
          </Etape>
        </section>

        <section className={styles.groupe} aria-labelledby="problemes">
          <header className={styles.groupeTete}>
            <h2 id="problemes" className="section-title">CA COINCE ?</h2>
          </header>
          <div className={styles.faq}>
            <Plus question="Quelqu'un arrive en retard">
              <p>
                Pendant la creation, il peut encore entrer avec le lien.
                <span className={styles.rebuild}> Il recoit un extrait, sans changer celui des autres.</span>
              </p>
            </Plus>
            <Plus question="Il n'y a pas assez d'extraits" className={styles.rebuild}>
              <p>Ce n&apos;est pas bloquant : certains auront le meme. Tu peux en ajouter a tout moment, meme pendant une manche, pour la suivante.</p>
            </Plus>
            <Plus question="Je veux retirer un extrait" className={styles.rebuild}>
              <p>C&apos;est possible tant qu&apos;il n&apos;a jamais ete attribue. Apres, il fait partie d&apos;une manche jouee et reste.</p>
            </Plus>
            <Plus question="Quelqu'un n'a rien rendu">
              <p>Il a zero pour cette manche et joue les suivantes normalement.</p>
            </Plus>
            <Plus question="Je veux sortir un joueur du classement">
              <p>Dans la liste des participants de la regie, <B>Ecarter</B>. <B>Reintegrer</B> annule.</p>
            </Plus>
            <Plus question="Un spectateur veut entrer pendant l'ecoute">
              <p>Ce n&apos;est plus possible : il n&apos;aurait note que la moitie des rendus. Il entre avant le debut de la diffusion.</p>
            </Plus>
            <Plus question="Le son passe deux fois">
              <p>La regie est muette par defaut. Si l&apos;ecran partage deja le son, coupe celui des telephones dans « Reglages avances ».</p>
            </Plus>
            <Plus question="J'ai ferme l'onglet de la regie">
              <p>Rouvre <a href="/host">la regie</a> dans le meme navigateur : tout reprend ou c&apos;en etait. Evite de changer d&apos;ordinateur en pleine soiree.</p>
            </Plus>
            <Plus question="Le serveur a redemarre">
              <p>La session reprend toute seule, chrono compris. Le son peut se couper quelques secondes.</p>
            </Plus>
          </div>
        </section>

        <footer className={styles.pied}>
          <a className="btn primary lg" href="/host">Ouvrir la regie</a>
        </footer>
      </main>
    </>
  );
}
