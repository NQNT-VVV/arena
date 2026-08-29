'use client';

import { useEffect, useState } from 'react';

import { humanBytes } from '@/lib/format';
import type { Asset, AssetKind } from '@/lib/types';
import styles from './AssetPack.module.css';

const ICONS: Record<AssetKind, string> = {
  audio: '🎧', image: '🖼️', video: '🎬', text: '📄', other: '📦',
};

/**
 * Contenu d'un element, dans la page.
 *
 * Les elements imposes se consultent sur place : ouvrir un logiciel pour
 * savoir a quoi ressemble le sample numero trois casse le rythme, et sur
 * telephone ce n'est meme pas possible. Le telechargement reste la, pour
 * travailler avec.
 *
 * `preload="metadata"` et non `auto` : cinq lecteurs sur une page qui
 * chargeraient tout leur contenu au montage, c'est le pack entier telecharge
 * par chaque participant avant qu'il n'ait clique nulle part.
 */
function Preview({ asset }: { asset: Asset }) {
  if (!asset.inline) {
    return (
      <p className={styles.noPreview}>
        Format non previsualisable. Telecharge-le pour l&apos;ouvrir.
      </p>
    );
  }

  switch (asset.kind) {
    case 'audio':
      return <audio className={styles.audio} src={asset.url} controls preload="metadata" />;
    case 'image':
      return (
        <a className={styles.imageLink} href={asset.url} target="_blank" rel="noreferrer" title="Ouvrir en grand">
          {/* Pas de next/image : la source vient de notre propre API, deja
              dimensionnee par l'animateur, et l'optimiseur ajouterait un cache
              indexe par URL sur des fichiers qui disparaissent avec la session. */}
          <img className={styles.image} src={asset.url} alt={asset.filename} loading="lazy" />
        </a>
      );
    case 'video':
      return <video className={styles.video} src={asset.url} controls preload="metadata" playsInline />;
    case 'text':
      return <TextPreview asset={asset} />;
    default:
      return null;
  }
}

/** Un texte impose s'affiche, mais pas au point de bloquer la page s'il est long. */
function TextPreview({ asset }: { asset: Asset }) {
  const [body, setBody] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(asset.url)
      .then((r) => r.text())
      .then((text) => { if (!cancelled) setBody(text.slice(0, 20000)); })
      .catch(() => { if (!cancelled) setBody(null); });
    return () => { cancelled = true; };
  }, [asset.url]);

  if (body === null) return <p className={styles.noPreview}>Chargement…</p>;
  const long = body.length > 400;

  return (
    <div className={styles.textWrap}>
      <pre className={`${styles.text} ${expanded || !long ? '' : styles.clamped}`}>{body}</pre>
      {long && (
        <button className="btn xs ghost" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Replier' : 'Tout afficher'}
        </button>
      )}
    </div>
  );
}

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
  if (!assets.length) return <p className="empty">{emptyLabel}</p>;

  const total = assets.reduce((sum, a) => sum + a.bytes, 0);

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

      <ul className={styles.list}>
        {assets.map((asset) => (
          <li key={asset.id} className={styles.item}>
            <div className={styles.head}>
              <span className={styles.icon} aria-hidden="true">{ICONS[asset.kind]}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className={styles.name}>{asset.filename}</span>
                <span className={styles.meta}>{humanBytes(asset.bytes)}</span>
              </span>
              <a className="btn xs ghost" href={`${asset.url}?dl=1`} title="Telecharger">⬇</a>
              {onRemove && (
                <button className="btn xs danger" onClick={() => onRemove(asset)} title="Retirer">✕</button>
              )}
            </div>
            <Preview asset={asset} />
          </li>
        ))}
      </ul>
    </>
  );
}
