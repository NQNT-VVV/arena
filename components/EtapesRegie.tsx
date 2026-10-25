/**
 * Les etapes avant le depart : ce qui est fait, ce qu'il reste a faire.
 *
 * Avant le premier chrono, la regie est la ou l'on hesite le plus : elle montre
 * tout a la fois, reglages, roues, extraits, liens. Cette carte dit dans quel
 * ordre s'y prendre, et coche ce qui est deja fait — on n'a pas a lire le guide
 * pour savoir ou en est sa soiree.
 */

import { hex } from '@/lib/hex';
import type { BattleState } from '@/lib/types';
import styles from './EtapesRegie.module.css';

type Etat = 'fait' | 'maintenant' | 'ensuite';

interface Etape {
  titre: string;
  detail: string;
  etat: Etat;
}

export function EtapesRegie({ state }: { state: BattleState }) {
  if (state.phase !== 'config' && state.phase !== 'lobby') return null;

  const rebuild = state.config.mode === 'rebuild';
  const extraits = state.extraits ?? [];
  const analyses = extraits.filter((e) => e.analyse === 'faite' || e.analyse === 'echec').length;
  const createurs = state.roster.filter((p) => !p.spectator).length;
  const lobby = state.phase === 'lobby';

  const etapes: Etape[] = [];
  etapes.push({
    titre: 'Regler la session',
    detail: `${state.config.mode === 'rebuild' ? 'Rebuild The Track' : 'Beat Battle'} · ${state.config.rounds} manche${state.config.rounds > 1 ? 's' : ''}. Modifiable tant que rien n’a commence.`,
    etat: 'fait',
  });
  if (rebuild) {
    etapes.push({
      titre: 'Deposer les extraits',
      detail: extraits.length === 0
        ? 'Un fichier audio par extrait, plus bas sur cette page. Idealement, au moins un par createur.'
        : `${extraits.length} depose${extraits.length > 1 ? 's' : ''} · ${analyses}/${extraits.length} analyse${analyses > 1 ? 's' : ''}. Verifie le tempo et la tonalite, corrige si besoin.`,
      etat: extraits.length > 0 ? 'fait' : 'maintenant',
    });
  }
  const pretAOuvrir = !rebuild || extraits.length > 0;
  etapes.push({
    titre: 'Ouvrir le lobby',
    detail: 'Le bouton est dans le cadre du chrono. Les participants peuvent alors entrer.',
    etat: lobby ? 'fait' : pretAOuvrir ? 'maintenant' : 'ensuite',
  });
  etapes.push({
    titre: 'Faire venir les participants',
    detail: lobby
      ? `${createurs} createur${createurs > 1 ? 's' : ''} inscrit${createurs > 1 ? 's' : ''}. Envoie le lien « pour creer » ou montre le QR ; le lien « pour juger » est pour les spectateurs.`
      : 'Lien, QR code et ecran de projection sont dans la carte « Inviter ».',
    etat: lobby ? (createurs > 0 ? 'fait' : 'maintenant') : 'ensuite',
  });
  etapes.push({
    titre: state.config.rounds > 1 ? 'Lancer la manche 1' : 'Lancer la creation',
    detail: rebuild
      ? 'Chacun recoit son extrait a cet instant, et le chrono part.'
      : 'Le chrono part pour tout le monde a cet instant.',
    etat: lobby && createurs > 0 ? 'maintenant' : 'ensuite',
  });

  if (rebuild && lobby && extraits.length > 0 && createurs > extraits.length) {
    etapes.splice(etapes.length - 1, 0, {
      titre: 'Ajouter des extraits ?',
      detail: `${createurs} createurs pour ${extraits.length} extrait${extraits.length > 1 ? 's' : ''} : certains auront le meme. Ce n’est pas bloquant.`,
      etat: 'maintenant',
    });
  }

  return (
    <section className={`card pad ${styles.carte}`} aria-label="Etapes avant le depart">
      <div className={styles.tete}>
        <h2 className="section-title">AVANT LE DEPART</h2>
        <a className="btn sm ghost" href="/guide" target="_blank" rel="noreferrer">Guide de l&apos;animateur</a>
      </div>
      <ol className={styles.liste}>
        {etapes.map((e, i) => (
          <li key={e.titre} className={`${styles.etape} ${styles[e.etat]}`}>
            <span className={styles.numero}>{hex(i + 1)}</span>
            <span className={styles.texte}>
              <span className={styles.titre}>{e.titre}</span>
              <span className={styles.detail}>{e.detail}</span>
            </span>
            <span className={styles.etat}>{e.etat === 'fait' ? 'FAIT' : e.etat === 'maintenant' ? 'A FAIRE' : ''}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
