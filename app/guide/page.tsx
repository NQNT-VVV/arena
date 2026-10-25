/**
 * Le guide de l'animateur.
 *
 * Une page statique, sans socket ni compte : on la lit avant la soiree, on la
 * garde ouverte dans un onglet pendant. Elle suit l'ordre d'une soiree plutot
 * que l'ordre des boutons — personne ne cherche « la carte Inviter », on
 * cherche « comment je fais venir les gens ».
 *
 * Les captures viennent d'une vraie partie de banc ; quand l'interface change,
 * elles se refont avec `~/.chrome-deps/capture-stockage.mjs`.
 */

import type { Metadata } from 'next';

import { Brand } from '@/components/Brand';
import styles from './guide.module.css';

export const metadata: Metadata = {
  title: 'Guide de l’animateur — Arena',
  description: 'Faire tourner une soiree Arena du debut a la fin : Beat Battle, Rebuild The Track, plusieurs manches.',
};

function Image({ src, alt, legende, etroite = false }: { src: string; alt: string; legende: string; etroite?: boolean }) {
  return (
    <figure className={`${styles.figure} ${etroite ? styles.etroite : ''}`}>
      {/* La colonne est etroite : un clic ouvre la capture en taille reelle. */}
      <a href={src} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" />
      </a>
      <figcaption>{legende}</figcaption>
    </figure>
  );
}

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

      <main className={`shell narrow ${styles.guide}`}>
        <header className={styles.intro}>
          <h1>GUIDE DE L&apos;ANIMATEUR</h1>
          <p className={styles.chapeau}>
            Arena fait tourner une battle de creation : chacun cree pendant un temps donne, puis tout le monde
            ecoute, note, et le classement se devoile place par place. Ce guide te prend du debut a la fin d&apos;une
            soiree. Cinq minutes de lecture.
          </p>
        </header>

        <section className={styles.bref} aria-label="En bref">
          <h2 className="section-title">EN BREF</h2>
          <ol>
            <li>Ouvre la <b>regie</b> et cree la session : nom, mode, nombre de manches, duree.</li>
            <li>En Rebuild The Track, <b>depose tes extraits</b> et verifie leur tempo et leur tonalite.</li>
            <li><b>Ouvre le lobby</b> et envoie le lien. Les gens rejoignent depuis leur telephone.</li>
            <li><b>Lance la manche</b> : le chrono part, chacun cree.</li>
            <li><b>Lance la diffusion</b> : tout le monde ecoute et note.</li>
            <li><b>Devoile le classement</b>, puis lance la manche suivante — ou termine.</li>
          </ol>
          <p className={styles.note}>
            Tant que rien n&apos;a commence, tout se modifie. En haut de la regie, la carte « Avant le depart » te dit
            a chaque instant ce qu&apos;il reste a faire.
          </p>
        </section>

        <section>
          <h2 className="section-title"><span className="idx">0x01</span>LES DEUX MODES</h2>
          <div className={styles.deux}>
            <div className={styles.mode}>
              <h3>BEAT BATTLE</h3>
              <p>
                Tout le monde cree sur la <b>meme consigne</b>, avec le meme pack d&apos;elements si tu en deposes
                (samples, images…). C&apos;est le mode classique.
              </p>
            </div>
            <div className={styles.mode}>
              <h3>REBUILD THE TRACK</h3>
              <p>
                Tu deposes des extraits de morceaux. A chaque manche, <b>chacun en recoit un different</b>, avec son
                tempo (BPM) et sa tonalite, et doit le reconstruire. A l&apos;ecoute, l&apos;ecran rappelle quel
                extrait chaque remake reconstruit.
              </p>
            </div>
          </div>
          <p>
            Les deux modes se jouent en <b>une ou plusieurs manches</b> (jusqu&apos;a dix). Plusieurs manches, c&apos;est
            le meme code, la meme page pour les joueurs et le meme ecran dans OBS du debut a la fin : personne n&apos;a a
            rejoindre de nouveau.
          </p>
        </section>

        <section>
          <h2 className="section-title"><span className="idx">0x02</span>AVANT LA SOIREE</h2>
          <ol className={styles.etapes}>
            <li>
              <b>Ouvre la regie</b> (<code>/host</code>) et remplis le formulaire. Seuls six reglages sont visibles ;
              le reste est range dans « Reglages avances » et ses valeurs par defaut conviennent a la plupart des
              soirees.
            </li>
            <li>
              <b>Rebuild The Track : depose les extraits</b> dans la carte « Extraits a reconstruire ». Wav, mp3 ou flac,
              plusieurs d&apos;un coup. Arena calcule le tempo et la tonalite de chacun en quelques secondes.
            </li>
            <li>
              <b>Verifie le tempo et la tonalite.</b> Le calcul est bon la plupart du temps, mais il se trompe de deux
              facons connues :
              <ul>
                <li>
                  le tempo affiche est <b>le double ou la moitie</b> du vrai (174 au lieu de 87) : un clic sur
                  <b> ×2</b> ou <b>/2</b> corrige ;
                </li>
                <li>
                  la tonalite est sa <b>« relative »</b> (do majeur au lieu de la mineur — ce sont les memes notes) :
                  tape la bonne, par exemple <code>C#m</code>, <code>F#</code>, <code>Bb</code> ou <code>A minor</code>.
                </li>
              </ul>
              Ce que tu tapes est marque <b>MANUEL</b> et ne sera plus jamais modifie par le calcul.
            </li>
            <li>
              <b>Prevois assez d&apos;extraits</b> : idealement un par createur et par manche. Avec 8 createurs et 3
              manches, 24 extraits garantissent que personne ne partage ni ne refait un extrait. Avec moins, ca marche
              quand meme : certains auront le meme.
            </li>
            <li>
              <b>Prepare l&apos;ecran.</b> Le bouton « Ouvrir l&apos;ecran de projection » donne l&apos;adresse a coller dans
              OBS (source navigateur, 1920 × 1080). Cet ecran ne montre jamais qui a fait quoi avant le classement.
            </li>
          </ol>
          <Image
            src="/guide/regie-depart.webp"
            alt="La carte Avant le depart : les etapes, celle a faire en surbrillance"
            legende="En haut de la regie : ce qui est fait, ce qu'il reste a faire, et l'etape en cours en surbrillance."
          />
          <Image
            src="/guide/regie-extraits.webp"
            alt="Les extraits deposes : tempo, tonalite, boutons ×2 et /2, attributions"
            legende="Les extraits deposes. AUTO : calcule par Arena ; MANUEL : corrige par toi, plus jamais recalcule."
          />
        </section>

        <section>
          <h2 className="section-title"><span className="idx">0x03</span>FAIRE VENIR LES GENS</h2>
          <ol className={styles.etapes}>
            <li><b>Ouvre le lobby</b> (bouton dans le cadre du chrono). La session devient rejoignable.</li>
            <li>
              Envoie le lien <b>« pour creer »</b>, ou montre le QR code a l&apos;ecran. Chacun choisit un pseudo sur son
              telephone.
            </li>
            <li>
              Le lien <b>« pour juger sans creer »</b> est pour les <b>spectateurs</b> : ils notent comme les autres, mais
              ne deposent rien et ne peuvent pas gagner. A envoyer avant le debut de l&apos;ecoute — apres, on ne rejoint
              plus.
            </li>
          </ol>
          <p className={styles.note}>
            Quelqu&apos;un arrive en retard, pendant la creation ? Il peut encore entrer. En Rebuild, il recoit
            automatiquement un extrait, sans que celui des autres change.
          </p>
        </section>

        <section>
          <h2 className="section-title"><span className="idx">0x04</span>PENDANT UNE MANCHE</h2>
          <ol className={styles.etapes}>
            <li>
              <b>Lance la manche.</b> Le chrono part pour tout le monde. En Rebuild, chacun voit aussitot son extrait sur
              son telephone : le tempo, la tonalite, l&apos;ecoute et le fichier a telecharger.
            </li>
            <li>
              <b>Le chrono t&apos;appartient</b> : +1, +5, +15 minutes, −5, pause. Tout le monde le voit bouger en
              meme temps.
            </li>
            <li>
              <b>Changer l&apos;extrait de quelqu&apos;un</b> (il le connait par coeur, le fichier est abime) : dans
              « Qui reconstruit quoi », choisis-en un autre dans la liste. Son telephone se met a jour.
            </li>
            <li>
              Les createurs <b>deposent quand ils veulent</b> et peuvent remplacer leur depot. Le compteur « rendus » te
              dit qui a fini.
            </li>
            <li>
              <b>Clore la creation</b> ouvre la fenetre de grace (deux minutes par defaut) pour les depots de derniere
              minute. Ensuite : <b>Lancer la diffusion</b>.
            </li>
          </ol>
          <Image
            src="/guide/telephone-extrait.webp"
            alt="Le telephone d'un createur : son extrait, son tempo et sa tonalite"
            legende="Ce que voit un createur : son extrait en premier, le tempo et la tonalite en grand."
            etroite
          />
        </section>

        <section>
          <h2 className="section-title"><span className="idx">0x05</span>L&apos;ECOUTE ET LE VOTE</h2>
          <ol className={styles.etapes}>
            <li>
              Chaque rendu passe a l&apos;ecran, <b>sans le nom de son auteur</b>. En Rebuild, l&apos;ecran indique quel
              extrait il reconstruit — nom, tempo, tonalite — pour qu&apos;on juge le remake contre l&apos;original.
            </li>
            <li>Tout le monde note sur son telephone, sauf son propre rendu.</li>
            <li>
              Par defaut, Arena <b>enchaine seul</b> au rendu suivant apres l&apos;ecoute. Coupe l&apos;enchainement si tu
              veux commenter : tu avances alors avec « Suivant ».
            </li>
          </ol>
        </section>

        <section>
          <h2 className="section-title"><span className="idx">0x06</span>LE CLASSEMENT, ET LA MANCHE SUIVANTE</h2>
          <ol className={styles.etapes}>
            <li>
              <b>Afficher les resultats</b>, puis <b>Devoiler la place suivante</b> : du dernier au premier, le suspense
              est la. « Tout devoiler » va plus vite.
            </li>
            <li>
              Avec plusieurs manches, le <b>classement general</b> apparait une fois tout devoile, a cote du classement
              de la manche.
            </li>
            <li>
              <b>Regle la duree de la manche suivante</b>, puis « Lancer la manche 2 ». Rendus, votes et chrono
              repartent de zero ; les participants, le code et l&apos;ecran restent. En Rebuild, chacun recoit un nouvel
              extrait — jamais celui qu&apos;il a deja reconstruit, s&apos;il en reste assez.
            </li>
          </ol>
          <Image
            src="/guide/regie-manche-suivante.webp"
            alt="La regie apres le classement : la duree et le bouton de la manche suivante"
            legende="Apres le classement : la duree de la manche suivante, et le bouton pour la lancer."
          />
        </section>

        <section>
          <h2 className="section-title"><span className="idx">0x07</span>LA FIN</h2>
          <p>
            Apres la derniere manche, l&apos;ecran affiche le <b>classement general final</b>. Depuis la regie, tu peux
            exporter les resultats (CSV ou JSON), archiver la session, ou lancer une <b>nouvelle edition</b> : memes
            reglages, memes extraits si tu veux, nouveaux participants.
          </p>
          <Image
            src="/guide/ecran-final.webp"
            alt="L'ecran de projection a la fin : classement de la derniere manche et classement general"
            legende="L'ecran a la fin : la derniere manche a gauche, le classement general a droite."
          />
        </section>

        <section>
          <h2 className="section-title"><span className="idx">0x08</span>LE CLASSEMENT GENERAL, EXPLIQUE</h2>
          <p>
            C&apos;est la <b>moyenne des manches</b>. Une manche sans rendu compte <b>zero</b>.
          </p>
          <p className={styles.exemple}>
            Ines : 3 a la manche 1, rien a la manche 2, 5 a la manche 3 → (3 + 0 + 5) / 3 = <b>2,67</b>.
          </p>
          <p>
            Pourquoi zero ? Sinon il suffirait de ne jouer que la manche ou l&apos;on se sent fort pour finir devant
            quelqu&apos;un qui a tout joue. Sur l&apos;ecran, une manche sans rendu est barree d&apos;une trame : personne
            ne decouvre la regle au moment du verdict.
          </p>
          <p>
            Un rendu depose en retard suit le reglage « depots hors delai » (refuse, hors classement — il compte alors
            zero —, ou penalise). Un participant que tu ecartes disparait du classement.
          </p>
        </section>

        <section>
          <h2 className="section-title"><span className="idx">0x09</span>QUESTIONS FREQUENTES</h2>
          <dl className={styles.faq}>
            <dt>Le tempo affiche est faux.</dt>
            <dd>S&apos;il est le double ou la moitie du vrai, clique ×2 ou /2. Sinon, tape-le.</dd>

            <dt>La tonalite est fausse.</dt>
            <dd>
              Le plus souvent, c&apos;est sa relative : do majeur au lieu de la mineur, et inversement. Tape la bonne :
              <code>Am</code>, <code>C#m</code>, <code>F#</code>, <code>Bb</code>, <code>D minor</code>… Attention a la
              casse : <code>Gm</code> est sol mineur.
            </dd>

            <dt>Il n&apos;y a pas assez d&apos;extraits pour tout le monde.</dt>
            <dd>Ce n&apos;est pas bloquant : certains recevront le meme. La regie te previent. Tu peux en ajouter a tout moment, meme pendant une manche, pour la suivante.</dd>

            <dt>Je veux retirer un extrait.</dt>
            <dd>C&apos;est possible tant qu&apos;il n&apos;a jamais ete attribue. Apres, il reste : il fait partie de l&apos;histoire d&apos;une manche jouee.</dd>

            <dt>Quelqu&apos;un n&apos;a rien rendu.</dt>
            <dd>Il a zero pour cette manche et peut jouer les suivantes normalement.</dd>

            <dt>Un spectateur veut entrer pendant l&apos;ecoute.</dt>
            <dd>Ce n&apos;est plus possible : il n&apos;aurait juge que la moitie des rendus, et sa note par defaut fausserait les autres. Il entre avant le debut de la diffusion.</dd>

            <dt>Le son passe deux fois.</dt>
            <dd>La regie est muette par defaut. Si une enceinte ou le partage d&apos;ecran diffuse deja, coupe le son des telephones dans « Reglages avances ».</dd>

            <dt>J&apos;ai ferme l&apos;onglet de la regie.</dt>
            <dd>Rouvre <code>/host</code> dans le meme navigateur : la regie reprend la ou elle en etait. Elle est liee a ce navigateur — evite de changer d&apos;ordinateur en pleine soiree.</dd>

            <dt>Le serveur a redemarre.</dt>
            <dd>La session reprend toute seule, chrono compris. Le son peut se couper quelques secondes.</dd>
          </dl>
        </section>

        <footer className={styles.pied}>
          <a className="btn primary" href="/host">Ouvrir la regie</a>
        </footer>
      </main>
    </>
  );
}
