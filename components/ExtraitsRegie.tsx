'use client';

/**
 * Les extraits de Rebuild The Track, cote regie.
 *
 * Trois gestes, dans l'ordre ou l'animateur les fait : deposer le lot avant la
 * soiree, verifier le tempo et la tonalite que l'analyse propose — et corriger
 * ce qui est faux, d'un ×2, d'un ÷2 ou d'une saisie —, puis, pendant une
 * manche, changer l'extrait de quelqu'un si le hasard a mal tire.
 *
 * Les valeurs saisies a la main portent « MANUEL » et l'analyse ne les
 * ecrasera plus. Les valeurs estimees portent « AUTO » : elles se trompent
 * surtout d'une octave pour le tempo, et d'une relative pour la tonalite.
 */

import { useEffect, useState } from 'react';

import { AssetUploader } from './AssetUploader';
import { Icon } from './Icon';
import { humanBytes } from '@/lib/format';
import { toast } from '@/lib/toast';
import type { AttributionRegie, ExtraitRegie, MancheState, Phase, RosterEntry } from '@/lib/types';
import styles from './ExtraitsRegie.module.css';

type Act = (event: string, payload?: Record<string, unknown>) => Promise<boolean>;

const ANALYSE: Record<string, string> = {
  attente: 'ANALYSE EN ATTENTE',
  en_cours: 'ANALYSE EN COURS',
  faite: '',
  echec: 'ANALYSE IMPOSSIBLE — A SAISIR',
};

export function ExtraitsRegie({
  code,
  token,
  extraits,
  attributions,
  roster,
  phase,
  manche,
  act,
}: {
  code: string;
  token: string | null;
  extraits: ExtraitRegie[];
  attributions: AttributionRegie[];
  roster: RosterEntry[];
  phase: Phase;
  manche: MancheState;
  act: Act;
}) {
  const createurs = roster.filter((p) => !p.spectator && !p.disqualified);
  const manque = createurs.length > extraits.length;
  const pendant = phase === 'creation' || phase === 'upload';

  const retirer = async (e: ExtraitRegie) => {
    const res = await fetch(`/api/session/${code}/extraits/${e.id}`, {
      method: 'DELETE',
      headers: { 'X-Arena-Token': token ?? '' },
    });
    const body = await res.json().catch(() => ({ error: 'Reponse illisible.' }));
    if (!res.ok) toast(body.error || 'Retrait impossible.', 'err');
    else toast('Extrait retire', 'ok');
  };

  return (
    <section className="card pad col">
      <h2 className="section-title">
        Extraits a reconstruire
        {extraits.length > 0 && (
          <span className="faint" style={{ letterSpacing: 0, textTransform: 'none' }}>
            {extraits.length} • {humanBytes(extraits.reduce((n, e) => n + (e.bytes ?? 0), 0))}
          </span>
        )}
      </h2>
      <p className="meta" style={{ textTransform: 'none', letterSpacing: 'var(--ls-prose)' }}>
        Au lancement de chaque manche, chaque createur recoit un extrait au hasard : un different pour chacun tant
        qu&apos;il y en a assez, jamais celui qu&apos;il a deja reconstruit, et les neufs avant ceux deja joues.
        Le tempo et la tonalite sont estimes a l&apos;arrivee du fichier.
      </p>
      {manque && (
        <p className={styles.alerte}>
          {createurs.length} createurs pour {extraits.length} extrait{extraits.length > 1 ? 's' : ''} : certains
          auront le meme. Deposez-en {createurs.length - extraits.length} de plus pour que chacun ait le sien.
        </p>
      )}

      <AssetUploader
        code={code}
        token={token}
        endpoint={`/api/session/${code}/extraits`}
        accept="audio/*"
        noun="extrait"
        disabled={phase === 'archived'}
        hint="Ou glisse-les ici — wav, mp3, flac, plusieurs a la fois"
      />

      {extraits.length === 0 ? (
        <p className="empty">Aucun extrait. Il en faut au moins un pour lancer une manche.</p>
      ) : (
        <ul className={styles.liste}>
          {extraits.map((e) => <Ligne key={e.id} e={e} act={act} onRetirer={retirer} />)}
        </ul>
      )}

      {pendant && attributions.length > 0 && (
        <div className="col">
          <span className="meta">QUI RECONSTRUIT QUOI — MANCHE {manche.round}</span>
          <div className={styles.attributions}>
            {attributions.map((a) => (
              <div key={a.participantId} className={styles.attribution}>
                <span className={styles.qui}>{a.pseudo ?? '—'}</span>
                <select
                  className="input"
                  aria-label={`Extrait de ${a.pseudo ?? 'ce participant'}`}
                  value={a.extraitId}
                  onChange={(ev) => void act('host:extrait-reattribuer', { participantId: a.participantId, extraitId: ev.target.value })}
                >
                  {extraits.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Une ligne d'extrait : ecoute, tempo, tonalite, et ce qu'il a deja servi. */
function Ligne({ e, act, onRetirer }: { e: ExtraitRegie; act: Act; onRetirer: (e: ExtraitRegie) => void }) {
  const [bpm, setBpm] = useState(e.bpm === null ? '' : String(e.bpm));
  const [ton, setTon] = useState(e.tonalite ?? '');
  // La valeur du serveur l'emporte des qu'elle change : une analyse qui finit
  // pendant que la ligne est affichee doit se voir.
  useEffect(() => setBpm(e.bpm === null ? '' : String(e.bpm)), [e.bpm]);
  useEffect(() => setTon(e.tonalite ?? ''), [e.tonalite]);

  const envoyerBpm = (v: string) => {
    if (v === (e.bpm === null ? '' : String(e.bpm))) return;
    void act('host:extrait-edit', { extraitId: e.id, bpm: v.trim() === '' ? null : Number(v) });
  };
  const envoyerTon = (v: string) => {
    if (v === (e.tonalite ?? '')) return;
    void act('host:extrait-edit', { extraitId: e.id, tonalite: v.trim() === '' ? null : v });
  };
  const octave = (facteur: number) => {
    if (e.bpm === null) return;
    void act('host:extrait-edit', { extraitId: e.id, bpm: Math.round(e.bpm * facteur * 10) / 10 });
  };
  const source = (s: string | null) => (s === 'manuel' ? 'MANUEL' : s === 'auto' ? 'AUTO' : '');

  return (
    <li className={styles.ligne}>
      <div className={styles.entete}>
        <span className={styles.nom}>{e.nom}</span>
        {ANALYSE[e.analyse] && <span className={`pill ${e.analyse === 'echec' ? 'err' : ''}`}><span>{ANALYSE[e.analyse]}</span></span>}
        {e.joues > 0 && <span className="pill">JOUE ×{e.joues}</span>}
      </div>
      {e.url && <audio className={styles.lecteur} controls preload="none" src={e.url} />}

      <div className={styles.champs}>
        <label className={styles.champ}>
          <span className="meta">BPM {source(e.bpmSource)}</span>
          <span className="row">
            <input
              className="input" inputMode="decimal" value={bpm} placeholder="—"
              onChange={(ev) => setBpm(ev.target.value)}
              onBlur={(ev) => envoyerBpm(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
            />
            {/* L'erreur la plus frequente de l'analyse est une octave : un clic la corrige. */}
            <button type="button" className="btn xs" disabled={e.bpm === null} onClick={() => octave(2)} title="Doubler le tempo">×2</button>
            {/* « /2 » et non « ÷2 » : la police a pixels n'a pas de signe de
                division, et le repli l'affichait comme un « +2 ». */}
            <button type="button" className="btn xs" disabled={e.bpm === null} onClick={() => octave(0.5)} title="Diviser le tempo par deux">/2</button>
          </span>
        </label>
        <label className={styles.champ}>
          <span className="meta">TONALITE {source(e.tonaliteSource)}{e.tonaliteNom ? ` — ${e.tonaliteNom.toUpperCase()}` : ''}</span>
          <input
            className={`input ${styles.tonalite}`} value={ton} placeholder="C#m, F#, Bb…"
            onChange={(ev) => setTon(ev.target.value)}
            onBlur={(ev) => envoyerTon(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
          />
        </label>
      </div>

      <div className={styles.pied}>
        <span className="meta">
          {e.cetteManche.length ? `CETTE MANCHE : ${e.cetteManche.join(', ')}` : 'PAS ATTRIBUE CETTE MANCHE'}
        </span>
        <span className="row">
          <button type="button" className="btn xs ghost" onClick={() => void act('host:extrait-analyser', { extraitId: e.id })}>
            <Icon name="chrono" />Re-analyser
          </button>
          {e.retirable && (
            <button type="button" className="btn xs ghost" onClick={() => onRetirer(e)}>
              <Icon name="croix" />Retirer
            </button>
          )}
        </span>
      </div>
    </li>
  );
}
