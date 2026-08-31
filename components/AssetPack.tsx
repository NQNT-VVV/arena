'use client';

import { useEffect, useRef, useState } from 'react';

import { humanBytes } from '@/lib/format';
import type { Asset, AssetKind } from '@/lib/types';
import styles from './AssetPack.module.css';

const ICONS: Record<AssetKind, string> = {
  audio: '🎧', image: '🖼️', video: '🎬', text: '📄', other: '📦',
};

/**
 * Les elements imposes, presentes comme le classement : une ligne par element.
 *
 * La premiere version empilait un lecteur complet par fichier — a douze
 * samples par kit, c'etait un mur de lecteurs et un ascenseur sans fin. Ici,
 * une ligne compacte par son avec son bouton de lecture, en grille sur deux
 * colonnes des que la largeur le permet, et un seul lecteur partage : lancer
 * un sample coupe le precedent, comme dans n'importe quel explorateur de kit.
 *
 * Les images passent en vignettes, les videos et les textes se deplient a la
 * demande. Le telechargement — unitaire ou en pack — ne bouge pas.
 */
export function AssetPack({
  assets,
  zipUrl,
  onRemove,
  emptyLabel = 'Aucun element impose pour cette session.',
}: {
  assets: Asset[];
  zipUrl?: string;
  /** Fourni cote regie seulement : le participant ne retire rien. */
  onRemove?: (asset: Asset) => void;
  emptyLabel?: string;
}) {
  /* ------------------------- lecteur partage ------------------------- */

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Quitter la page arrete le son : un sample qui continue de tourner apres
  // le changement de phase serait au mieux comique, au pire genant.
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const player = () => {
    let el = audioRef.current;
    if (!el) {
      el = new Audio();
      el.preload = 'auto';
      el.addEventListener('timeupdate', () => {
        setProgress(el!.duration ? el!.currentTime / el!.duration : 0);
      });
      el.addEventListener('ended', () => { setPlayingId(null); setProgress(0); });
      el.addEventListener('error', () => setPlayingId(null));
      audioRef.current = el;
    }
    return el;
  };

  const toggle = (asset: Asset) => {
    const el = player();
    if (playingId === asset.id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    if (loadedId !== asset.id) {
      el.src = asset.url;
      setLoadedId(asset.id);
      setProgress(0);
    }
    void el.play().catch(() => setPlayingId(null));
    setPlayingId(asset.id);
  };

  /* --------------------------- groupes ------------------------------- */

  if (!assets.length) return <p className="empty">{emptyLabel}</p>;

  const images = assets.filter((a) => a.kind === 'image' && a.inline);
  const sounds = assets.filter((a) => a.kind === 'audio' && a.inline);
  const rest = assets.filter((a) => !images.includes(a) && !sounds.includes(a));
  const total = assets.reduce((sum, a) => sum + a.bytes, 0);

  const removeButton = (asset: Asset) => onRemove && (
    <button className="btn xs danger" onClick={() => onRemove(asset)} title="Retirer">✕</button>
  );

  return (
    <>
      {zipUrl && (
        <div className="row wrap">
          <a className="btn sm" href={zipUrl}>⬇ Tout telecharger ({humanBytes(total)})</a>
          <span className="faint" style={{ fontSize: 12 }}>
            {assets.length} element{assets.length > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {images.length > 0 && (
        <ul className={styles.thumbs}>
          {images.map((asset) => (
            <li key={asset.id} className={styles.thumb}>
              <a href={asset.url} target="_blank" rel="noreferrer" title={`${asset.filename} — ouvrir en grand`}>
                <img src={asset.url} alt={asset.filename} loading="lazy" />
              </a>
              <span className={styles.thumbBar}>
                <span className={styles.thumbName}>{asset.filename}</span>
                <a className={styles.thumbAction} href={`${asset.url}?dl=1`} title="Telecharger">⬇</a>
                {onRemove && (
                  <button className={styles.thumbAction} onClick={() => onRemove(asset)} title="Retirer">✕</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {sounds.length > 0 && (
        <ul className={styles.grid}>
          {sounds.map((asset) => {
            const isPlaying = playingId === asset.id;
            const showProgress = loadedId === asset.id && progress > 0;
            return (
              <li
                key={asset.id}
                className={`${styles.row} ${isPlaying ? styles.active : ''}`}
                style={showProgress ? ({ '--p': progress } as React.CSSProperties) : undefined}
              >
                <button
                  className={styles.play}
                  aria-label={isPlaying ? `Mettre ${asset.filename} en pause` : `Ecouter ${asset.filename}`}
                  aria-pressed={isPlaying}
                  onClick={() => toggle(asset)}
                >
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <span className={styles.info}>
                  <span className={styles.name}>{asset.filename}</span>
                  <span className={styles.meta}>{humanBytes(asset.bytes)}</span>
                </span>
                <a className={styles.action} href={`${asset.url}?dl=1`} title="Telecharger">⬇</a>
                {removeButton(asset)}
              </li>
            );
          })}
        </ul>
      )}

      {rest.length > 0 && (
        <ul className={styles.stack}>
          {rest.map((asset) => {
            const expandable = asset.inline && (asset.kind === 'video' || asset.kind === 'text');
            const expanded = expandedId === asset.id;
            return (
              <li key={asset.id} className={styles.stackItem}>
                <div className={styles.row}>
                  {expandable ? (
                    <button
                      className={styles.play}
                      aria-expanded={expanded}
                      aria-label={expanded ? `Replier ${asset.filename}` : `Afficher ${asset.filename}`}
                      onClick={() => setExpandedId(expanded ? null : asset.id)}
                    >
                      {expanded ? '▾' : ICONS[asset.kind]}
                    </button>
                  ) : (
                    <span className={`${styles.play} ${styles.inert}`} aria-hidden="true">{ICONS[asset.kind]}</span>
                  )}
                  <span className={styles.info}>
                    <span className={styles.name}>{asset.filename}</span>
                    <span className={styles.meta}>
                      {humanBytes(asset.bytes)}
                      {!asset.inline && ' • telechargement seul'}
                    </span>
                  </span>
                  <a className={styles.action} href={`${asset.url}?dl=1`} title="Telecharger">⬇</a>
                  {removeButton(asset)}
                </div>
                {expanded && asset.kind === 'video' && (
                  <video className={styles.video} src={asset.url} controls preload="metadata" playsInline />
                )}
                {expanded && asset.kind === 'text' && <TextPreview asset={asset} />}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Un texte impose s'affiche, mais pas au point de bloquer la page s'il est long. */
function TextPreview({ asset }: { asset: Asset }) {
  const [body, setBody] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(asset.url)
      .then((r) => r.text())
      .then((text) => { if (!cancelled) setBody(text.slice(0, 20000)); })
      .catch(() => { if (!cancelled) setBody(null); });
    return () => { cancelled = true; };
  }, [asset.url]);

  if (body === null) return <p className={styles.loading}>Chargement…</p>;
  return <pre className={styles.text}>{body}</pre>;
}
