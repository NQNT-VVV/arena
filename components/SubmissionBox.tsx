'use client';

import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import { clock } from '@/lib/clock';
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
  graceEndAt,
}: {
  code: string;
  identity: { participantId: string; token: string } | null;
  mediaType: MediaType;
  config: SessionConfig;
  submission: OwnSubmission | null;
  /** Instant de fermeture des depots, pour prevenir plutot que refuser. */
  closingAt?: number | null;
  /** Fin de la fenetre de grace, pendant la phase de depot seulement. */
  graceEndAt?: number | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const isText = mediaType === 'text';
  const busy = progress !== null || saving;

  /*
   * Le delai est-il ecoule ?
   *
   * La phase de depot dure jusqu'a ce que l'animateur lance la diffusion, donc
   * bien apres la fin de la fenetre de grace. Passe cet instant le serveur
   * refuse le depot, ou le marque en retard selon le reglage : la page ne doit
   * plus inviter a remplacer comme si de rien n'etait — un rendu arrive a
   * l'heure devenait « hors delai » pour avoir ete remplace.
   */
  const [horsDelai, setHorsDelai] = useState(false);
  useEffect(() => {
    if (!graceEndAt) { setHorsDelai(false); return; }
    const reste = graceEndAt - clock.now();
    setHorsDelai(reste <= 0);
    if (reste <= 0) return;
    const t = setTimeout(() => setHorsDelai(true), reste + 50);
    return () => clearTimeout(t);
  }, [graceEndAt]);

  const ferme = horsDelai && config.latePolicy === 'reject';
  const consequence = config.latePolicy === 'penalty'
    ? `avec une pénalité de ${config.latePenalty} point${config.latePenalty > 1 ? 's' : ''}`
    : 'hors classement';
  /** Avant un geste qui ferait d'un rendu a l'heure un rendu en retard. */
  const confirmerRetard = (geste: string) => {
    if (!horsDelai || !submission || submission.late) return true;
    return window.confirm(`Le délai est écoulé. ${geste}, et tout nouveau dépôt sera compté hors délai (${consequence}). Continuer ?`);
  };
  const delaiNote = !horsDelai
    ? null
    : ferme
      ? (submission
        ? 'Le délai est écoulé : ton rendu est déposé, il ne se remplace plus.'
        : 'Le délai est écoulé : les dépôts sont fermés.')
      : (submission?.late
        ? `Ton rendu est arrivé hors délai : il sera diffusé ${consequence}.`
        : `Le délai est écoulé : un dépôt fait maintenant sera compté hors délai (${consequence}).`);

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
    if (!res.ok) { toast(body?.error || 'Le dépôt a échoué.', 'err'); return; }
    toast(body.late ? 'Rendu reçu — hors délai' : 'Rendu reçu', body.late ? 'info' : 'ok');
  };

  const sendText = async () => {
    if (!identity || busy || draft.trim().length < 2) return;
    if (!confirmerRetard('Mettre à jour maintenant remplace ton texte')) return;
    setSaving(true);
    const res = await fetch(`/api/session/${code}/submission`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' } as HeadersInit,
      body: JSON.stringify({ body: draft }),
    });
    const body = await res.json().catch(() => ({ error: 'Réponse illisible.' }));
    setSaving(false);
    if (!res.ok) { toast(body.error || 'L’enregistrement a échoué.', 'err'); return; }
    toast(body.late ? 'Texte enregistré — hors délai' : 'Texte enregistré', body.late ? 'info' : 'ok');
  };

  const choisir = () => {
    if (submission && !confirmerRetard('Remplacer maintenant retire ton rendu arrivé à l’heure')) return;
    input.current?.click();
  };

  const withdraw = async () => {
    if (!identity || busy) return;
    if (!confirmerRetard('Retirer ton rendu maintenant le supprime')) return;
    const res = await fetch(`/api/session/${code}/submission`, { method: 'DELETE', headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast(body.error || 'Retrait impossible.', 'err');
      return;
    }
    setDraft('');
    toast('Rendu retiré', 'ok');
  };

  /* ------------------------------ texte ----------------------------- */

  if (isText) {
    const dirty = draft.trim() !== (submission?.textBody ?? '').trim();
    return (
      <div className={styles.box}>
        <div className={styles.head}>
          <h3>Ta création</h3>
          {submission && <Badge submission={submission} />}
        </div>
        <textarea
          className="input"
          rows={10}
          value={draft}
          maxLength={20000}
          placeholder="Écris ici. Tu peux revenir dessus tant que la phase est ouverte."
          readOnly={ferme}
          onChange={(e) => setDraft(e.target.value)}
        />
        {!ferme && (
          <div className="row wrap">
            <button className="btn primary" disabled={busy || !dirty || draft.trim().length < 2} aria-busy={busy} onClick={sendText}>
              {submission ? 'Mettre à jour' : 'Déposer'}
            </button>
            {submission && <button className="btn sm ghost" disabled={busy} aria-busy={busy} onClick={withdraw}>Retirer</button>}
            <span className="faint grow" style={{ textAlign: 'right' }}>
              {draft.length} caractères{dirty && submission ? ' • non enregistré' : ''}
            </span>
          </div>
        )}
        {delaiNote && <span className="meta">{delaiNote}</span>}
      </div>
    );
  }

  /* ------------------------------ fichier --------------------------- */

  return (
    <div className={styles.box}>
      <div className={styles.head}>
        <h3>Ta création</h3>
        {submission && <Badge submission={submission} />}
      </div>

      {submission ? (
        <div className={styles.done}>
          <div className="row">
            <Icon name="valide" size="lg" className={styles.icon} />
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
            <img className={styles.image} src={submission.url} alt="Ta création" />
          )}
          {submission.url && submission.inline && submission.kind === 'video' && (
            <video className={styles.player} src={submission.url} controls preload="metadata" playsInline />
          )}

          {submission.error && submission.status === 'ready' && (
            <span className="meta">
              Le fichier n’a pas pu être converti : il sera diffusé tel quel.
              {submission.kind === 'audio' || submission.kind === 'video'
                ? ' Vérifie qu’il s’ouvre bien chez toi.'
                : ''}
            </span>
          )}

          {!ferme && (
            <div className="row wrap">
              <button className="btn sm" disabled={busy} aria-busy={busy} onClick={choisir}>
                Remplacer
              </button>
              <button className="btn sm ghost" disabled={busy} aria-busy={busy} onClick={withdraw}>Retirer</button>
            </div>
          )}
        </div>
      ) : ferme ? null : (
        <div
          className={`${styles.zone} ${dragging ? styles.over : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void sendFile(e.dataTransfer.files); }}
        >
          <span className={styles.big} aria-hidden="true">⬆</span>
          <button className="btn primary" disabled={busy} aria-busy={busy} onClick={() => input.current?.click()}>
            Choisir mon fichier
          </button>
          <span className="faint" style={{ textAlign: 'center' }}>
            {config.allowedExt.length ? config.allowedExt.join(', ') : ACCEPTED_HINT[mediaType]}
            {' • '}{humanBytes(config.maxFileBytes)} maximum
          </span>
        </div>
      )}

      {progress !== null && (
        <>
          <div className={styles.bar}><i style={{ transform: `scaleX(${progress})` }} /></div>
          <div className="row">
            <span className="faint grow">Envoi… {Math.round(progress * 100)} %</span>
            <button className="btn xs ghost" onClick={() => cancelRef.current?.()}>Annuler</button>
          </div>
        </>
      )}

      <input
        ref={input}
        type="file"
        className="sr-only"
        disabled={busy} aria-busy={busy}
        onChange={(e) => void sendFile(e.target.files)}
      />

      {delaiNote
        ? <span className="meta">{delaiNote}</span>
        : closingAt && (
          <span className="meta">
            Tu peux remplacer ton fichier jusqu’à la fin du délai.
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
  if (submission.late) return <span className="pill err"><span>Hors délai</span></span>;
  return <span className="pill ok"><span className="dot" /> {submission.transcoded ? 'Prêt' : 'Déposé'}</span>;
}
