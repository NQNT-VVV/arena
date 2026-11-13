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
    titre: 'Régler la session',
    detail: `${state.config.mode === 'rebuild' ? 'Rebuild The Track' : 'Beat Battle'} · ${state.config.rounds} manche${state.config.rounds > 1 ? 's' : ''}. Modifiable tant que rien n’a commencé.`,
    etat: 'fait',
  });
  if (rebuild) {
    etapes.push({
      titre: 'Déposer les extraits',
      detail: extraits.length === 0
        ? 'Un fichier audio par extrait, plus bas sur cette page. Idéalement, au moins un par créateur.'
        : `${extraits.length} déposé${extraits.length > 1 ? 's' : ''} · ${analyses}/${extraits.length} analysé${analyses > 1 ? 's' : ''}. Vérifie le tempo et la tonalité, corrige si besoin.`,
      etat: extraits.length > 0 ? 'fait' : 'maintenant',
    });
  }
  const pretAOuvrir = !rebuild || extraits.length > 0;
  etapes.push({
    titre: 'Ouvrir le lobby',
    detail: 'Le bouton est dans le cadre du chrono. Créateurs et spectateurs peuvent alors entrer.',
    etat: lobby ? 'fait' : pretAOuvrir ? 'maintenant' : 'ensuite',
  });
  etapes.push({
    titre: 'Faire venir tout le monde',
    detail: lobby
      ? `${createurs} créateur${createurs > 1 ? 's' : ''} dans la session. Envoie le lien « pour créer » ou montre le QR ; le lien « pour juger » est pour les spectateurs.`
      : 'Lien, QR code et écran de projection sont dans la carte « Inviter ».',
    etat: lobby ? (createurs > 0 ? 'fait' : 'maintenant') : 'ensuite',
  });
  etapes.push({
    titre: state.config.rounds > 1 ? 'Lancer la manche 1' : 'Lancer la création',
    detail: rebuild
      ? 'Chacun reçoit son extrait à cet instant, et le chrono part.'
      : 'Le chrono part pour tout le monde à cet instant.',
    etat: lobby && createurs > 0 ? 'maintenant' : 'ensuite',
  });

  if (rebuild && lobby && extraits.length > 0 && createurs > extraits.length) {
    etapes.splice(etapes.length - 1, 0, {
      titre: 'Ajouter des extraits ?',
      detail: `${createurs} créateurs pour ${extraits.length} extrait${extraits.length > 1 ? 's' : ''} : certains auront le même. Ce n’est pas bloquant.`,
      etat: 'maintenant',
    });
  }

  return (
    <section className={`card pad ${styles.carte}`} aria-label="Étapes avant le départ">
      <div className={styles.tete}>
        <h2 className="section-title">Avant le départ</h2>
        <a className="btn sm ghost" href="/guide" target="_blank" rel="noreferrer">Guide de l’animateur</a>
      </div>
      <ol className={styles.liste}>
        {etapes.map((e, i) => (
          <li key={e.titre} className={`${styles.etape} ${styles[e.etat]}`}>
            <span className={styles.numero}>{hex(i + 1)}</span>
            <span className={styles.texte}>
              <span className={styles.titre}>{e.titre}</span>
              <span className={styles.detail}>{e.detail}</span>
            </span>
            <span className={styles.etat}>{e.etat === 'fait' ? 'Fait' : e.etat === 'maintenant' ? 'À faire' : ''}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
