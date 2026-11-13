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
  description: 'Animer une soirée Arena, bouton par bouton : Beat Battle, Rebuild The Track, plusieurs manches.',
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
  { bouton: 'Clore la création', quand: 'le chrono est fini' },
  { bouton: 'Lancer la diffusion', quand: 'on écoute, on note' },
  { bouton: 'Afficher les résultats', quand: 'après le dernier rendu' },
  { bouton: 'Dévoiler la place suivante', quand: 'du dernier au premier' },
  { bouton: 'Lancer la manche 2', quand: 's’il reste des manches', plusieurs: true },
];

export default function GuidePage() {
  return (
    <>
      <header className="topbar">
        <Brand compact />
        <span className="grow">
          <span className="session-name">Guide de l’animateur</span>
        </span>
        <a className="btn sm" href="/host">Ouvrir la régie</a>
      </header>

      <main className={`shell ${styles.guide}`}>
        <header className={styles.intro}>
          <h1>Animer une soirée Arena</h1>
          <p className={styles.chapeau}>
            Tu pilotes tout depuis la régie, sur ton ordinateur. Les joueurs n’ont besoin que de leur téléphone.
            Voici où cliquer, dans l’ordre.
          </p>
          <fieldset className={styles.choix}>
            <legend>Ta soirée</legend>
            <label>
              <input type="radio" name="mode" className={styles.choixRebuild} defaultChecked />
              <span>Rebuild The Track</span>
            </label>
            <label>
              <input type="radio" name="mode" className={styles.choixBattle} />
              <span>Beat Battle</span>
            </label>
          </fieldset>
          <p className={`${styles.modeAide} ${styles.rebuild}`}>Chacun reçoit un extrait différent et le reconstruit.</p>
          <p className={`${styles.modeAide} ${styles.battle}`}>Tout le monde crée sur la même consigne.</p>
        </header>

        <section className={styles.antiseche} aria-labelledby="antiseche">
          <h2 id="antiseche" className="section-title">La soirée en un coup d’œil</h2>
          <p>
            Tout se passe dans le <b>cadre du chrono</b>, en haut à gauche de la régie. Le bouton plein, c’est
            presque toujours l’étape suivante.
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
            <a href="#avant">Avant la soirée</a>
            <a href="#pendant">Pendant chaque manche</a>
            <a href="#fin">À la fin</a>
            <a href="#problemes">Ça coince ?</a>
          </nav>
        </section>

        <section className={styles.groupe} aria-labelledby="avant">
          <header className={styles.groupeTete}>
            <h2 id="avant" className="section-title">Avant la soirée</h2>
            <p>Dix minutes, la veille ou juste avant.</p>
          </header>

          <Etape
            titre="Crée la session"
            captures={(
              <>
                <Capture nom="creer" l={629} h={400} className={styles.rebuild} alt="Le formulaire de création en Rebuild The Track : le mode et le nombre de manches entourés" />
                <Capture nom="creer-battle" l={629} h={400} className={styles.battle} alt="Le formulaire de création en Beat Battle : le mode et le nombre de manches entourés" />
              </>
            )}
          >
            <p>
              Ouvre la <a href="/host">régie</a>. Donne un nom, choisis le mode <N>1</N>, le nombre de manches et
              leur durée <N>2</N>. Termine par <B plein>Créer la session</B>, tout en bas.
            </p>
            <p className={styles.battle}>Écris aussi la consigne : elle s’affiche sur tous les téléphones.</p>
            <p className={styles.discret}>Le reste est rangé dans « Réglages avancés » : pas besoin d’y toucher.</p>
          </Etape>

          <Etape
            titre="Dépose les extraits"
            className={styles.rebuild}
            large
            captures={<Capture nom="extraits" l={1089} h={560} alt="La carte des extraits : le bouton pour déposer et les champs tempo et tonalité entourés" />}
          >
            <p>
              Glisse tes morceaux dans la carte « Extraits à reconstruire » <N>1</N> : wav, mp3 ou flac, plusieurs
              d’un coup. Arena trouve tout seul le tempo et la tonalité <N>2</N>.
            </p>
            <p>
              Compte un extrait par créateur et par manche : 8 créateurs et 3 manches, 24 extraits. Avec moins, certains
              auront le même.
            </p>
            <Plus question="Le tempo ou la tonalité est faux ?">
              <p>
                Tempo double ou moitié du vrai (174 au lieu de 87) : clique <B>×2</B> ou <B>/2</B>. Tonalité fausse :
                tape la bonne, par exemple <code>Am</code>, <code>C#m</code>, <code>F#</code> ou <code>Bb</code>.
                Ce que tu corriges n’est plus jamais recalculé.
              </p>
            </Plus>
          </Etape>

          <Etape
            titre="Ouvre le lobby"
            captures={<Capture nom="ouvrir-lobby" l={662} h={386} alt="Le cadre du chrono avec le bouton Ouvrir le lobby entouré" />}
          >
            <p>Clique <B plein>Ouvrir le lobby</B> dans le cadre du chrono. Les joueurs peuvent maintenant entrer.</p>
          </Etape>

          <Etape
            titre="Fais venir les joueurs"
            captures={<Capture nom="inviter" l={436} h={736} alt="La carte Inviter : le lien pour créer et le bouton de l’écran de projection entourés" />}
          >
            <p>
              Envoie le lien « pour créer » <N>1</N> sur Discord, ou montre le QR code. Chacun choisit un pseudo sur son
              téléphone.
            </p>
            <p>
              Pour le stream, <B>Ouvrir l’écran de projection</B> <N>2</N> donne l’adresse à coller dans OBS :
              une source navigateur en 1920 × 1080.
            </p>
            <Plus question="Et ceux qui veulent juste noter ?">
              <p>
                Envoie-leur le lien « pour juger sans créer ». Ils notent comme tout le monde, mais ne déposent rien et
                ne peuvent pas gagner. À envoyer avant l’écoute : après, on n’entre plus.
              </p>
            </Plus>
          </Etape>
        </section>

        <section className={styles.groupe} aria-labelledby="pendant">
          <header className={styles.groupeTete}>
            <h2 id="pendant" className="section-title">Pendant chaque manche</h2>
            <p>Les mêmes gestes, à chaque manche.</p>
          </header>

          <Etape
            titre="Lance la manche"
            captures={(
              <>
                <Capture nom="lancer" l={662} h={404} alt="Le cadre du chrono avec le bouton Lancer la manche 1 entouré" />
                <Capture
                  nom="telephone-extrait" l={358} h={386} telephone className={styles.rebuild}
                  alt="Le téléphone d’un créateur : son extrait, son tempo et sa tonalité"
                  legende="Sur le téléphone d’un créateur."
                />
              </>
            )}
          >
            <p>
              Clique <B plein>▶ Lancer la manche 1</B>. Le chrono part pour tout le monde. S’il n’y a
              qu’une manche, le bouton s’appelle <B plein>▶ Lancer la création</B>.
            </p>
            <p className={styles.rebuild}>
              Chaque créateur reçoit aussitôt son extrait sur son téléphone : le tempo, la tonalité, et le fichier à
              télécharger.
            </p>
          </Etape>

          <Etape
            titre="Pendant que ça crée"
            captures={<Capture nom="creation" l={662} h={363} alt="Le chrono en cours : le bouton plus cinq minutes et le bouton Clore la création entourés" />}
          >
            <p>Le chrono est à toi : ajoute du temps <N>1</N> ou mets en pause. Tout le monde le voit bouger.</p>
            <p>
              À la fin, clique <B plein>Clore la création</B> <N>2</N>. Les retardataires ont encore deux minutes pour
              déposer.
            </p>
            <Plus question="Changer l’extrait de quelqu’un ?" className={styles.rebuild}>
              <p>
                Il le connaît par cœur, ou le fichier est abîmé : dans « Qui reconstruit quoi », sous les extraits,
                choisis-en un autre. Son téléphone se met à jour tout seul.
              </p>
              <Capture nom="qui-quoi" l={1047} h={217} alt="La liste Qui reconstruit quoi, avec le choix de l’extrait d’un joueur entouré" />
            </Plus>
          </Etape>

          <Etape
            titre="Lance l’écoute"
            captures={<Capture nom="diffuser" l={662} h={368} alt="Le cadre du chrono avec le bouton Lancer la diffusion entouré" />}
          >
            <p>
              Clique <B plein>Lancer la diffusion</B>. Si tout le monde a déjà déposé, inutile d’attendre la fin des
              deux minutes : la phrase au-dessus du bouton compte les rendus reçus.
            </p>
          </Etape>

          <Etape
            titre="Laisse tourner l’écoute"
            captures={(
              <>
                <Capture nom="ecoute" l={662} h={449} alt="Les commandes de l’écoute : l’enchaînement automatique et le bouton Afficher les résultats entourés" />
                <Capture
                  nom="telephone-vote" l={390} h={640} telephone
                  alt="Le téléphone pendant l’écoute : le rendu en cours, l’extrait d’origine et les notes de 1 à 5"
                  legende="Sur les téléphones : le rendu en cours et les notes."
                />
              </>
            )}
          >
            <p>
              Les rendus passent un par un, sans le nom de leur auteur. Chacun note sur son téléphone.
              <span className={styles.rebuild}> L’écran rappelle quel extrait chaque rendu reconstruit.</span>
            </p>
            <p>
              Arena passe seul au rendu suivant <N>1</N>. Pour commenter entre deux rendus, coupe l’enchaînement :
              tu avances alors avec <B>Suivant</B>.
            </p>
            <p>Après le dernier rendu : <B plein>Afficher les résultats</B> <N>2</N>.</p>
          </Etape>

          <Etape
            titre="Dévoile le classement"
            captures={<Capture nom="devoiler" l={662} h={557} alt="Les résultats : le bouton Dévoiler la place suivante entouré" />}
          >
            <p>
              Clique <B plein>Dévoiler la place suivante</B> une fois par joueur : du dernier au premier, c’est là que
              se fait le suspense. Pour aller vite : <B>Tout dévoiler</B>.
            </p>
            <p>Avec plusieurs manches, le classement général s’affiche à côté, une fois tout dévoilé.</p>
          </Etape>

          <Etape
            titre="Passe à la manche suivante"
            captures={<Capture nom="manche-suivante" l={662} h={574} alt="Après le classement : la durée de la manche suivante et le bouton Lancer la manche 2 entourés" />}
          >
            <p>
              Règle la durée de la prochaine manche <N>1</N>, puis <B plein>Lancer la manche 2</B> <N>2</N>. Les joueurs,
              le code et l’écran restent ; rendus, votes et chrono repartent de zéro.
            </p>
            <p className={styles.rebuild}>Chacun reçoit un nouvel extrait, jamais un qu’il a déjà reconstruit.</p>
            <p className={styles.discret}>Le bouton attend que tout le classement soit dévoilé.</p>
          </Etape>
        </section>

        <section className={styles.groupe} aria-labelledby="fin">
          <header className={styles.groupeTete}>
            <h2 id="fin" className="section-title">À la fin</h2>
          </header>

          <Etape
            titre="Le classement final"
            large
            captures={(
              <Capture
                nom="ecran-final" l={1280} h={720}
                alt="L’écran de projection à la fin : la dernière manche à gauche, le classement général à droite"
                legende="L’écran à la fin : la dernière manche à gauche, le classement général à droite."
              />
            )}
          >
            <p>
              Après la dernière manche, l’écran affiche le <b>classement général</b> : la moyenne de toutes les
              manches. Une manche sans rendu compte zéro, sinon il suffirait de ne jouer que celle où l’on se sent
              fort.
            </p>
            <p className={styles.exemple}>Ines : 3 à la manche 1, rien à la 2, 5 à la 3 → (3 + 0 + 5) / 3 = <b>2,67</b></p>
            <p>
              Dans la régie : les résultats en <B>CSV</B> ou <B>JSON</B>, et <B>Relancer</B>, sous « Nouvelle édition »,
              pour rejouer avec les mêmes réglages et de nouveaux joueurs.
            </p>
          </Etape>
        </section>

        <section className={styles.groupe} aria-labelledby="problemes">
          <header className={styles.groupeTete}>
            <h2 id="problemes" className="section-title">Ça coince ?</h2>
          </header>
          <div className={styles.faq}>
            <Plus question="Quelqu’un arrive en retard">
              <p>
                Pendant la création, il peut encore entrer avec le lien.
                <span className={styles.rebuild}> Il reçoit un extrait, sans changer celui des autres.</span>
              </p>
            </Plus>
            <Plus question="Il n’y a pas assez d’extraits" className={styles.rebuild}>
              <p>Ce n’est pas bloquant : certains auront le même. Tu peux en ajouter à tout moment, même pendant une manche, pour la suivante.</p>
            </Plus>
            <Plus question="Je veux retirer un extrait" className={styles.rebuild}>
              <p>C’est possible tant qu’il n’a jamais été attribué. Après, il fait partie d’une manche jouée et reste.</p>
            </Plus>
            <Plus question="Quelqu’un n’a rien rendu">
              <p>Il a zéro pour cette manche et joue les suivantes normalement.</p>
            </Plus>
            <Plus question="Je veux sortir un joueur du classement">
              <p>Dans la liste des créateurs et des spectateurs de la régie, <B>Écarter</B>. <B>Réintégrer</B> annule.</p>
            </Plus>
            <Plus question="Un spectateur veut entrer pendant l’écoute">
              <p>Ce n’est plus possible : il n’aurait noté que la moitié des rendus. Il entre avant le début de la diffusion.</p>
            </Plus>
            <Plus question="Le son passe deux fois">
              <p>La régie est muette par défaut. Si l’écran partage déjà le son, coupe celui des téléphones dans « Réglages avancés ».</p>
            </Plus>
            <Plus question="J’ai fermé l’onglet de la régie">
              <p>Rouvre <a href="/host">la régie</a> dans le même navigateur : tout reprend où c’en était. Évite de changer d’ordinateur en pleine soirée.</p>
            </Plus>
            <Plus question="Le serveur a redémarré">
              <p>La session reprend toute seule, chrono compris. Le son peut se couper quelques secondes.</p>
            </Plus>
          </div>
        </section>

        <footer className={styles.pied}>
          <a className="btn primary lg" href="/host">Ouvrir la régie</a>
        </footer>
      </main>
    </>
  );
}
