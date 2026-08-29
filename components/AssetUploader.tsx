'use client';

import { useRef, useState } from 'react';

import { humanBytes } from '@/lib/format';
import { toast } from '@/lib/toast';
import { uploadFiles } from '@/lib/uploads';
import type { Asset } from '@/lib/types';
import styles from './AssetUploader.module.css';

interface Response {
  added?: number;
  assets?: Asset[];
  error?: string;
}

/**
 * Depot des elements imposes.
 *
 * Glisser-deposer et selecteur classique : le premier est confortable au
 * bureau, le second est le seul qui existe sur telephone. L'animateur prepare
 * parfois sa session depuis son canape.
 */
export function AssetUploader({
  code,
  token,
  disabled,
  hint,
  onDone,
}: {
  code: string;
  token: string | null;
  disabled?: boolean;
  hint?: string;
  onDone?: (assets: Asset[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const busy = progress !== null;

  const send = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (!files.length || busy || disabled) return;

    setProgress(0);
    const { promise, cancel } = uploadFiles<Response>(`/api/session/${code}/assets`, files, {
      token,
      onProgress: setProgress,
    });
    cancelRef.current = cancel;

    const res = await promise;
    cancelRef.current = null;
    setProgress(null);
    if (input.current) input.current.value = '';

    const body = res.body as Response;
    if (!res.ok) {
      toast(body?.error || 'Le depot a echoue.', 'err');
      return;
    }
    toast(`${body.added} element${(body.added ?? 0) > 1 ? 's' : ''} depose${(body.added ?? 0) > 1 ? 's' : ''}`, 'ok');
    onDone?.(body.assets ?? []);
  };

  return (
    <div
      className={`${styles.zone} ${dragging ? styles.over : ''} ${disabled ? styles.off : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void send(e.dataTransfer.files); }}
    >
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        disabled={disabled || busy}
        onChange={(e) => void send(e.target.files)}
      />

      {busy ? (
        <>
          <span className={styles.icon} aria-hidden="true">⬆</span>
          <div className={styles.bar}><i style={{ transform: `scaleX(${progress ?? 0})` }} /></div>
          <span className="faint" style={{ fontSize: 12.5 }}>
            Envoi… {Math.round((progress ?? 0) * 100)} %
          </span>
          <button className="btn xs ghost" onClick={() => cancelRef.current?.()}>Annuler</button>
        </>
      ) : (
        <>
          <span className={styles.icon} aria-hidden="true">📎</span>
          <button
            className="btn sm"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            Choisir des fichiers
          </button>
          <span className="faint" style={{ fontSize: 12.5, textAlign: 'center' }}>
            {disabled ? 'Les elements ne se deposent plus a ce stade.' : (hint ?? 'ou glisse-les ici')}
          </span>
        </>
      )}
    </div>
  );
}

/** Rappel des plafonds, pour eviter le refus au bout de deux minutes d'envoi. */
export function UploadLimits({ count, max, bytes, maxBytes }: { count: number; max: number; bytes: number; maxBytes: number }) {
  return (
    <span className="faint" style={{ fontSize: 11.5 }}>
      {count}/{max} elements • {humanBytes(bytes)} / {humanBytes(maxBytes)}
    </span>
  );
}
