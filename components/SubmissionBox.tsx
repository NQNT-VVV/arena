'use client';

import { useEffect, useRef, useState } from 'react';

import { ACCEPTED_HINT, humanBytes } from '@/lib/format';
import { toast } from '@/lib/toast';
import { uploadFiles } from '@/lib/uploads';
import type { MediaType, OwnSubmission, SessionConfig } from '@/lib/types';
import styles from './SubmissionBox.module.css';

interface Reply {
  submission?: OwnSubmission;
  late?: boolean;
  error?: string;
}

/**
 * Depot de sa creation.
 *
 * Ouvert des la phase de creation : on ne fait pas attendre la fin quelqu'un
 * qui a termine en vingt minutes. Le fichier reste remplacable tant que la
 * phase le permet — c'est le comportement que les gens attendent, et l'absence
 * de remplacement pousse a garder son rendu jusqu'a la derniere seconde, ce qui
 * concentre tous les televersements au pire moment.
 */
export function SubmissionBox({
  code,
  identity,
  mediaType,
  config,
  submission,
  closingAt,
}: {
  code: string;
  identity: { participantId: string; token: string } | null;
  mediaType: MediaType;
  config: SessionConfig;
  submission: OwnSubmission | null;
  /** Instant de fermeture des depots, pour prevenir plutot que refuser. */
  closingAt?: number | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const isText = mediaType === 'text';
  const busy = progress !== null || saving;

  useEffect(() => {
    if (submission?.textBody) setDraft(submission.textBody);
  }, [submission?.textBody]);

  const headers = identity
    ? { 'X-Arena-Token': identity.token, 'X-Arena-Participant': identity.participantId }
    : undefined;

  const sendFile = async (list: FileList | File[] | null) => {
    const file = Array.from(list ?? [])[0];
    if (!file || busy || !identity) return;

    if (file.size > config.maxFileBytes) {
      toast(`Ce fichier fait ${humanBytes(file.size)}, la limite est ${humanBytes(config.maxFileBytes)}.`, 'err');
      return;
    }

    setProgress(0);
    // Deux entetes, pas une : le serveur veut savoir qui depose autant que
    // verifier son jeton. Envoyer le seul jeton fait echouer le depot en 403.
    const { promise, cancel } = uploadFiles<Reply>(`/api/session/${code}/submission`, [file], {
      headers: {
        'X-Arena-Token': identity.token,
        'X-Arena-Participant': identity.participantId,
      },
      onProgress: setProgress,
    });
    cancelRef.current = cancel;

    const res = await promise;
    cancelRef.current = null;
    setProgress(null);
    if (input.current) input.current.value = '';

    const body = res.body as Reply;
    if (!res.ok) { toast(body?.error || 'Le depot a echoue.', 'err'); return; }
    toast(body.late ? 'Rendu recu — hors delai' : 'Rendu recu', body.late ? 'info' : 'ok');
  };

  const sendText = async () => {
    if (!identity || busy || draft.trim().length < 2) return;
    setSaving(true);
    const res = await fetch(`/api/session/${code}/submission`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' } as HeadersInit,
      body: JSON.stringify({ body: draft }),
    });
    const body = await res.json().catch(() => ({ error: 'Reponse illisible.' }));
    setSaving(false);
    if (!res.ok) { toast(body.error || 'L’enregistrement a echoue.', 'err'); return; }
    toast(body.late ? 'Texte enregistre — hors delai' : 'Texte enregistre', body.late ? 'info' : 'ok');
  };

  const withdraw = async () => {
    if (!identity || busy) return;
    const res = await fetch(`/api/session/${code}/submission`, { method: 'DELETE', headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast(body.error || 'Retrait impossible.', 'err');
      return;
    }
    setDraft('');
    toast('Rendu retire', 'ok');
  };

  /* ------------------------------ texte ----------------------------- */

  if (isText) {
    const dirty = draft.trim() !== (submission?.textBody ?? '').trim();
    return (
      <div className={styles.box}>
        <div className={styles.head}>
          <h3>Ta creation</h3>
          {submission && <Badge submission={submission} />}
        </div>
        <textarea
          className="input"
          rows={10}
          value={draft}
          maxLength={20000}
          placeholder="Ecris ici. Tu peux revenir dessus tant que la phase est ouverte."
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="row wrap">
          <button className="btn primary" disabled={busy || !dirty || draft.trim().length < 2} onClick={sendText}>
            {submission ? 'Mettre a jour' : 'Deposer'}
          </button>
          {submission && <button className="btn sm ghost" disabled={busy} onClick={withdraw}>Retirer</button>}
          <span className="faint grow" style={{ fontSize: 12, textAlign: 'right' }}>
            {draft.length} caracteres{dirty && submission ? ' • non enregistre' : ''}
          </span>
        </div>
      </div>
    );
  }

  /* ------------------------------ fichier --------------------------- */

  return (
    <div className={styles.box}>
      <div className={styles.head}>
        <h3>Ta creation</h3>
        {submission && <Badge submission={submission} />}
      </div>

      {submission ? (
        <div className={styles.done}>
          <div className="row">
            <span className={styles.icon} aria-hidden="true">✓</span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className={styles.name}>{submission.filename}</span>
              <span className={styles.meta}>
                {humanBytes(submission.bytes)}
                {submission.replacedCount > 0 && ` • version ${submission.replacedCount + 1}`}
              </span>
            </span>
          </div>

          {/* Se relire avant la fin evite la mauvaise surprise du fichier vide
              ou du mauvais export — c'est la premiere chose que tout le monde
              veut verifier. */}
          {submission.url && submission.inline && submission.kind === 'audio' && (
            <audio className={styles.player} src={submission.url} controls preload="metadata" />
          )}
          {submission.url && submission.inline && submission.kind === 'image' && (
            <img className={styles.image} src={submission.url} alt="Ta creation" />
          )}
          {submission.url && submission.inline && submission.kind === 'video' && (
            <video className={styles.player} src={submission.url} controls preload="metadata" playsInline />
          )}

          {submission.error && submission.status === 'ready' && (
            <span className="faint" style={{ fontSize: 12 }}>
              Le fichier n&apos;a pas pu etre converti : il sera diffuse tel quel.
              {submission.kind === 'audio' || submission.kind === 'video'
                ? ' Verifie qu’il s’ouvre bien chez toi.'
                : ''}
            </span>
          )}

          <div className="row wrap">
            <button className="btn sm" disabled={busy} onClick={() => input.current?.click()}>
              Remplacer
            </button>
            <button className="btn sm ghost" disabled={busy} onClick={withdraw}>Retirer</button>
          </div>
        </div>
      ) : (
        <div
          className={`${styles.zone} ${dragging ? styles.over : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void sendFile(e.dataTransfer.files); }}
        >
          <span className={styles.big} aria-hidden="true">⬆</span>
          <button className="btn primary" disabled={busy} onClick={() => input.current?.click()}>
            Choisir mon fichier
          </button>
          <span className="faint" style={{ fontSize: 12.5, textAlign: 'center' }}>
            {config.allowedExt.length ? config.allowedExt.join(', ') : ACCEPTED_HINT[mediaType]}
            {' • '}{humanBytes(config.maxFileBytes)} maximum
          </span>
        </div>
      )}

      {progress !== null && (
        <>
          <div className={styles.bar}><i style={{ transform: `scaleX(${progress})` }} /></div>
          <div className="row">
            <span className="faint grow" style={{ fontSize: 12.5 }}>Envoi… {Math.round(progress * 100)} %</span>
            <button className="btn xs ghost" onClick={() => cancelRef.current?.()}>Annuler</button>
          </div>
        </>
      )}

      <input
        ref={input}
        type="file"
        className="sr-only"
        disabled={busy}
        onChange={(e) => void sendFile(e.target.files)}
      />

      {closingAt && (
        <span className="faint" style={{ fontSize: 11.5 }}>
          Tu peux remplacer ton fichier jusqu&apos;a la fermeture des depots.
        </span>
      )}
    </div>
  );
}

/**
 * Etat du depot.
 *
 * « Traitement » le temps que le serveur re-encode le fichier ; c'est court,
 * mais un participant qui voit « depose » avant que ce soit vrai relance
 * parfois son envoi. Un transcodage rate n'est pas un echec du depot : le
 * fichier concourt tel quel, et on le dit.
 */
function Badge({ submission }: { submission: OwnSubmission }) {
  if (submission.status === 'pending' || submission.status === 'transcoding') {
    return <span className="pill"><span className="dot" /> Traitement…</span>;
  }
  if (submission.late) return <span className="pill" style={{ color: '#ffc9dc' }}>Hors delai</span>;
  return <span className="pill ok"><span className="dot" /> {submission.transcoded ? 'Pret' : 'Depose'}</span>;
}
