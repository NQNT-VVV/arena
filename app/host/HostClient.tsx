'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { AssetPack } from '@/components/AssetPack';
import { AssetUploader } from '@/components/AssetUploader';
import { Brand } from '@/components/Brand';
import { DiffusionStage } from '@/components/DiffusionStage';
import { Podium } from '@/components/Podium';
import { Chrono } from '@/components/Chrono';
import { PhaseRail } from '@/components/PhaseRail';
import { QrCode } from '@/components/QrCode';
import { humanBytes, humanDuration, humanThreshold, PHASE_LABELS } from '@/lib/format';
import { hostKeys } from '@/lib/identity';
import { sfx } from '@/lib/sfx';
import { call } from '@/lib/socket';
import { copyToClipboard } from '@/lib/storage';
import { toast } from '@/lib/toast';
import { MEDIA_LABELS, type Asset, type LatePolicy, type MediaType } from '@/lib/types';
import { useBattleSocket } from '@/lib/useBattleSocket';
import { usePhaseClock } from '@/lib/usePhaseClock';
import styles from './host.module.css';

/** Seuils proposes en un clic. L'animateur en coche autant qu'il veut. */
const ALERT_CHOICES = [900, 600, 300, 120, 60, 30];

/**
 * Miroir de `BattleServer.ASSET_ADD_PHASES` et `ASSET_REMOVE_PHASES`.
 *
 * Le serveur reste seul juge — il refuse ce qu'il doit refuser. Ces ensembles
 * ne servent qu'a griser les commandes plutot qu'a laisser cliquer pour rien.
 */
const ASSET_ADD_PHASES = new Set(['config', 'lobby', 'creation']);
const ASSET_REMOVE_PHASES = new Set(['config', 'lobby']);

const LATE_POLICIES: { id: LatePolicy; label: string; hint: string }[] = [
  { id: 'reject', label: 'Refuses', hint: 'Passe l’heure, le depot est bloque.' },
  { id: 'unranked', label: 'Hors classement', hint: 'Le rendu passe en diffusion mais ne concourt pas.' },
  { id: 'penalty', label: 'Penalises', hint: 'Le rendu concourt, avec une note amputee.' },
];

interface Draft {
  name: string;
  mediaType: MediaType;
  brief: string;
  durationMin: number;
  graceMin: number;
  alerts: number[];
  scale: number;
  defaultVote: number;
  latePolicy: LatePolicy;
  latePenalty: number;
  autoAdvance: boolean;
}

const EMPTY_DRAFT: Draft = {
  name: '',
  mediaType: 'audio',
  brief: '',
  durationMin: 60,
  graceMin: 2,
  alerts: [600, 120, 60, 30],
  scale: 5,
  defaultVote: 3,
  latePolicy: 'reject',
  latePenalty: 1,
  autoAdvance: false,
};

export function HostClient() {
  const [code, setCode] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  /**
   * Reprise de la regie.
   *
   * Rejouee a chaque connexion, y compris apres une coupure : le serveur voit
   * une socket neuve, qui doit se re-annoncer pour recevoir les etats.
   */
  const attach = useCallback(async (socket: Socket) => {
    const known = code ?? hostKeys.last();
    const token = known ? hostKeys.get(known) : null;
    if (!known || !token) {
      setBooted(true);
      return;
    }
    const res = await call<{ code: string }>(socket, 'host:attach', { code: known, hostToken: token });
    if (res.ok) {
      setCode(res.code);
    } else {
      // Session purgee, ou jeton d'une autre installation : on repart a zero
      // plutot que de laisser la page tourner sur une regie fantome.
      hostKeys.clear(known);
      toast(res.error, 'err');
    }
    setBooted(true);
  }, [code]);

  const { socket, state, connected } = useBattleSocket(attach);

  const chrono = usePhaseClock(state, {
    onAlert: (s) => { sfx.alert(s); toast(`Plus que ${humanThreshold(s)}`, 'info'); },
    onEnd: () => sfx.end(),
  });

  // Le contexte audio ne demarre qu'apres un geste : sans ce declencheur, les
  // alertes de la regie resteraient muettes toute la soiree.
  useEffect(() => {
    const wake = () => sfx.unlock();
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  // Quand la session existe deja, le formulaire reflete ses reglages reels.
  useEffect(() => {
    if (!state) return;
    setDraft((d) => ({
      ...d,
      name: state.name,
      mediaType: state.mediaType,
      brief: state.brief,
      durationMin: Math.round(state.config.durationMs / 60000),
      graceMin: Math.round(state.config.graceMs / 60000),
      alerts: state.config.alerts,
      scale: state.config.scale,
      defaultVote: state.config.defaultVote,
      latePolicy: state.config.latePolicy,
      latePenalty: state.config.latePenalty,
      autoAdvance: state.config.autoAdvance,
    }));
  }, [state?.code, state?.phase]);

  const inviteUrl = useMemo(
    () => (code && typeof window !== 'undefined' ? `${window.location.origin}/j/${code}` : ''),
    [code],
  );

  const act = async (event: string, payload: Record<string, unknown> = {}) => {
    if (!socket) return false;
    setBusy(true);
    const res = await call(socket, event, payload);
    setBusy(false);
    if (!res.ok) toast(res.error, 'err');
    return res.ok;
  };

  const draftToConfig = (d: Draft) => ({
    durationMs: d.durationMin * 60_000,
    graceMs: d.graceMin * 60_000,
    alerts: d.alerts,
    scale: d.scale,
    defaultVote: d.defaultVote,
    latePolicy: d.latePolicy,
    latePenalty: d.latePenalty,
    autoAdvance: d.autoAdvance,
  });

  const create = async () => {
    if (!socket) return;
    setBusy(true);
    const res = await call<{ code: string; hostToken: string }>(socket, 'host:create', {
      name: draft.name,
      mediaType: draft.mediaType,
      brief: draft.brief,
      config: draftToConfig(draft),
    });
    setBusy(false);
    if (!res.ok) {
      toast(res.error, 'err');
      return;
    }
    hostKeys.save(res.code, res.hostToken);
    hostKeys.setLast(res.code);
    setCode(res.code);
    sfx.phase();
  };

  /**
   * Retrait d'un element.
   *
   * Passe par HTTP et non par la socket : c'est la meme ressource que le
   * depot, et la faire vivre a deux endroits garantit qu'un jour les deux
   * divergeront.
   */
  const dropAsset = async (asset: Asset) => {
    if (!code) return;
    const res = await fetch(`/api/session/${code}/assets/${asset.id}`, {
      method: 'DELETE',
      headers: { 'X-Arena-Token': hostKeys.get(code) ?? '' },
    });
    const body = await res.json().catch(() => ({ error: 'Reponse illisible.' }));
    if (!res.ok) toast(body.error || 'Retrait impossible.', 'err');
    else toast('Element retire', 'ok');
  };

  /**
   * Telechargement de l'archive.
   *
   * Passe par une requete et un blob, pas par un lien : un `<a href>` ne sait
   * pas porter l'entete du jeton d'animateur, et mettre le jeton dans l'URL le
   * ferait atterrir dans l'historique du navigateur et les journaux du serveur.
   */
  const download = async (format: 'json' | 'csv') => {
    if (!code) return;
    const res = await fetch(`/api/session/${code}/results.${format}`, {
      headers: { 'X-Arena-Token': hostKeys.get(code) ?? '' },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast(body.error || 'Export impossible.', 'err');
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `${code}-classement.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveConfig = () => act('host:configure', {
    name: draft.name,
    mediaType: draft.mediaType,
    brief: draft.brief,
    config: draftToConfig(draft),
  });

  const quit = () => {
    if (code) hostKeys.clear(code);
    hostKeys.clear('last');
    setCode(null);
    setDraft(EMPTY_DRAFT);
    window.location.reload();
  };

  /* ------------------------------ rendu ----------------------------- */

  if (!booted) {
    return <div className={styles.boot}><span className="pill"><span className="dot" /> Connexion…</span></div>;
  }

  if (!code || !state) return renderCreate();

  const phase = state.phase;
  const editable = phase === 'config' || phase === 'lobby';

  return (
    <>
      <header className="topbar">
        <Brand compact />
        <span className="grow">
          <span className="session-name">{state.name}</span>
          <span className="faint" style={{ fontSize: 12 }}>{PHASE_LABELS[phase]}</span>
        </span>
        <span className={`pill ${connected ? 'ok' : ''}`}>
          <span className="dot" /> {connected ? 'En ligne' : 'Reconnexion…'}
        </span>
        <span className="pill">
          <span className="code-chip">{state.code}</span>
        </span>
        <button className="btn sm ghost" onClick={quit}>Quitter</button>
      </header>

      <div className="shell">
        <PhaseRail phase={phase} />

        <section className={styles.grid}>
          <div className={`card pad ${styles.stage}`}>
            <Chrono clock={chrono} />
            {renderControls()}
          </div>

          <div className="col">
            <div className={`card pad ${styles.invite}`}>
              <h2 className="section-title">Inviter</h2>
              <div className={styles.codeBig}><span className="code-chip">{state.code}</span></div>
              {inviteUrl && <QrCode text={inviteUrl} className="screen-qr" />}
              <div className="row">
                <input className="input grow" readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} />
                <button
                  className="btn sm"
                  onClick={() => { void copyToClipboard(inviteUrl); toast('Lien copie', 'ok'); }}
                >
                  Copier
                </button>
              </div>
              <a className="btn sm block" href={`/screen?code=${state.code}`} target="_blank" rel="noreferrer">
                📺 Ouvrir l&apos;ecran de projection
              </a>
            </div>

            <div className="stats">
              <div className="stat"><span className="v">{state.counts.participants}</span><span className="k">Inscrits</span></div>
              <div className="stat"><span className="v">{state.counts.connected}</span><span className="k">En ligne</span></div>
              <div className="stat"><span className="v">{state.counts.submitted}</span><span className="k">Rendus</span></div>
            </div>
          </div>
        </section>

        {phase === 'diffusion' && state.diffusion && (
          <section className="card pad col">
            <h2 className="section-title">Rendu diffuse</h2>
            {/* La regie voit exactement ce que voit la salle : aucun auteur,
                aucun nom de fichier. Elle partage souvent son ecran. */}
            <DiffusionStage diffusion={state.diffusion} config={state.config} votes={{}} isMine={false} />
          </section>
        )}

        {phase === 'results' && state.podium && (
          <section className="card pad col">
            <h2 className="section-title">Classement</h2>
            <Podium podium={state.podium} />
          </section>
        )}

        <section className="card pad col">
          <h2 className="section-title">Consigne</h2>
          <p className="brief">{state.brief}</p>
          <div className="row wrap faint" style={{ fontSize: 12.5 }}>
            <span>{MEDIA_LABELS[state.mediaType].icon} {MEDIA_LABELS[state.mediaType].label}</span>
            <span>•</span>
            <span>{humanDuration(state.config.durationMs)} de creation</span>
            <span>•</span>
            <span>{humanDuration(state.config.graceMs)} de grace</span>
            <span>•</span>
            <span>note sur {state.config.scale}</span>
            {state.config.alerts.length > 0 && (
              <>
                <span>•</span>
                <span>alertes a {state.config.alerts.map(humanThreshold).join(', ')}</span>
              </>
            )}
          </div>
        </section>

        <section className="card pad col">
          <h2 className="section-title">
            Elements imposes
            {state.assets.length > 0 && (
              <span className="faint" style={{ fontSize: 11.5, letterSpacing: 0, textTransform: 'none' }}>
                {state.assets.length} • {humanBytes(state.assets.reduce((n, a) => n + a.bytes, 0))}
              </span>
            )}
          </h2>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Samples, screenshots, rushes, templates. Les participants les consultent directement
            dans leur page et peuvent recuperer le pack complet.
          </p>
          <AssetUploader
            code={state.code}
            token={hostKeys.get(state.code)}
            disabled={!ASSET_ADD_PHASES.has(phase)}
            hint="ou glisse-les ici — plusieurs a la fois"
          />
          <AssetPack
            assets={state.assets}
            zipUrl={state.assets.length ? state.assetsZipUrl : undefined}
            onRemove={ASSET_REMOVE_PHASES.has(phase) ? dropAsset : undefined}
            emptyLabel="Aucun element pour l'instant. Une session peut tres bien s'en passer : une consigne seule suffit."
          />
        </section>

        {editable && <section className="card pad col">{renderForm(true)}</section>}

        <section className="card pad col">
          <h2 className="section-title">Participants ({state.counts.participants})</h2>
          {state.roster.length === 0
            ? <p className="empty">Personne pour l&apos;instant. Partage le code ou le QR.</p>
            : (
              <div className="roster">
                {state.roster.map((p) => (
                  <div
                    key={p.id}
                    className={`roster-row ${p.connected ? '' : 'off'} ${p.disqualified ? 'dq' : ''} ${p.hasSubmitted ? styles.submitted : ''}`}
                  >
                    <span className="avatar" aria-hidden="true">{p.avatar}</span>
                    <span className="who grow">
                      <span className="pseudo ellipsis">{p.pseudo}</span>
                      <span className="sub">
                        {p.hasSubmitted ? '✓ a rendu' : (p.connected ? 'en ligne' : 'deconnecte')}
                      </span>
                    </span>
                    <button
                      className="btn xs ghost"
                      title={p.disqualified ? 'Reintegrer' : 'Disqualifier'}
                      onClick={() => act('host:disqualify', { participantId: p.id, on: !p.disqualified })}
                    >
                      {p.disqualified ? '↩' : '✕'}
                    </button>
                  </div>
                ))}
              </div>
            )}
        </section>
      </div>
    </>
  );

  /* --------------------------- sous-rendus -------------------------- */

  function renderControls() {
    const btn = (label: string, event: string, payload?: Record<string, unknown>, cls = 'btn') => (
      <button className={cls} disabled={busy} onClick={() => act(event, payload ?? {})}>{label}</button>
    );

    switch (phase) {
      case 'config':
        return (
          <div className={styles.controls}>
            <p className="muted">Regle la session ci-dessous, puis ouvre le lobby pour que les participants puissent entrer.</p>
            {btn('Ouvrir le lobby', 'host:publish', {}, 'btn primary lg')}
          </div>
        );
      case 'lobby':
        return (
          <div className={styles.controls}>
            <p className="muted">
              {state!.counts.participants === 0
                ? 'En attente des participants.'
                : `${state!.counts.participants} inscrit(s). Le chrono part des que tu lances.`}
            </p>
            <div className="row wrap">
              {btn('Revenir aux reglages', 'host:unpublish')}
              {btn('▶ Lancer la creation', 'host:start', {}, 'btn primary lg')}
            </div>
          </div>
        );
      case 'creation':
        return (
          <div className={styles.controls}>
            <div className="row wrap">
              {btn('− 5 min', 'host:add-time', { deltaMs: -5 * 60_000 }, 'btn sm')}
              {btn('+ 1 min', 'host:add-time', { deltaMs: 60_000 }, 'btn sm')}
              {btn('+ 5 min', 'host:add-time', { deltaMs: 5 * 60_000 }, 'btn sm')}
              {btn('+ 15 min', 'host:add-time', { deltaMs: 15 * 60_000 }, 'btn sm')}
            </div>
            <div className="row wrap">
              {chrono.paused
                ? btn('▶ Reprendre', 'host:resume', {}, 'btn good')
                : btn('⏸ Pause', 'host:pause', {}, 'btn')}
              {btn('Clore la creation', 'host:close-creation', {}, 'btn primary')}
            </div>
          </div>
        );
      case 'upload':
        return (
          <div className={styles.controls}>
            <p className="muted">
              Fenetre de depot. {state!.counts.submitted} rendu(s) recu(s) sur {state!.counts.participants} inscrit(s).
            </p>
            <div className="row wrap">
              {btn('+ 2 min', 'host:add-time', { deltaMs: 2 * 60_000 }, 'btn sm')}
              {btn('Lancer la diffusion', 'host:start-diffusion', {}, 'btn primary lg')}
            </div>
          </div>
        );
      case 'diffusion': {
        const d = state!.diffusion;
        const last = !d || d.index >= d.total - 1;
        const everyone = !!d && d.eligible > 0 && d.voted >= d.eligible;
        return (
          <div className={styles.controls}>
            <p className="muted">
              {d && d.total > 0
                ? <>Rendu <b>{d.index + 1}</b> sur {d.total} — <b>{d.voted}</b> / {d.eligible} ont note</>
                : 'Aucun rendu a diffuser.'}
            </p>
            <div className="row wrap">
              <button className="btn sm" disabled={busy || !d || d.index === 0} onClick={() => act('host:diffusion-prev')}>
                ← Precedent
              </button>
              <button
                className={`btn ${everyone ? 'good' : ''}`}
                disabled={busy || last}
                onClick={() => act('host:diffusion-next')}
              >
                Suivant →
              </button>
            </div>
            {btn('Afficher les resultats', 'host:results', {}, `btn ${last ? 'primary' : ''}`)}
            {!last && (
              <span className="faint" style={{ fontSize: 12 }}>
                Il reste {(d?.total ?? 0) - (d?.index ?? 0) - 1} rendu(s) a passer.
              </span>
            )}
          </div>
        );
      }
      case 'results': {
        const p = state!.podium;
        return (
          <div className={styles.controls}>
            <p className="muted">
              {p?.complete
                ? 'Classement entierement devoile.'
                : <>Devoile du dernier au premier — <b>{p?.revealed ?? 0}</b> / {p?.total ?? 0}</>}
            </p>
            <div className="row wrap">
              <button className="btn primary" disabled={busy || !!p?.complete} onClick={() => act('host:reveal')}>
                Devoiler la place suivante
              </button>
              <button className="btn sm" disabled={busy || !!p?.complete} onClick={() => act('host:reveal', { all: true })}>
                Tout devoiler
              </button>
            </div>
            <div className="row wrap">
              <button className="btn sm ghost" onClick={() => download('csv')}>⬇ CSV</button>
              <button className="btn sm ghost" onClick={() => download('json')}>⬇ JSON</button>
              {btn('Archiver la session', 'host:archive', {}, 'btn sm ghost')}
            </div>
          </div>
        );
      }
      default:
        return <p className="muted">Session archivee.</p>;
    }
  }

  function renderCreate() {
    return (
      <>
        <header className="topbar">
          <Brand />
          <span className="grow" />
        </header>
        <div className="shell narrow">
          <header>
            <h1 style={{ fontSize: 30, marginBottom: 6 }}>Nouvelle session</h1>
            <p className="muted">Tout reste modifiable tant que la creation n&apos;a pas demarre.</p>
          </header>
          <section className="card pad col">{renderForm(false)}</section>
        </div>
      </>
    );
  }

  function renderForm(existing: boolean) {
    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

    return (
      <>
        <h2 className="section-title">{existing ? 'Reglages' : 'La session'}</h2>

        <div className="field">
          <label htmlFor="name">Nom de la session</label>
          <input
            id="name" className="input" value={draft.name} maxLength={60}
            placeholder="Beat Battle #12"
            onChange={(e) => set('name', e.target.value)}
          />
        </div>

        <div className="field">
          <label>Type de rendu attendu</label>
          <div className="media-choice">
            {(Object.keys(MEDIA_LABELS) as MediaType[]).map((type) => (
              <button
                key={type} type="button"
                aria-pressed={draft.mediaType === type}
                onClick={() => set('mediaType', type)}
              >
                <span className="ico" aria-hidden="true">{MEDIA_LABELS[type].icon}</span>
                {MEDIA_LABELS[type].label}
              </button>
            ))}
          </div>
          <span className="faint" style={{ fontSize: 12 }}>{MEDIA_LABELS[draft.mediaType].hint}</span>
        </div>

        <div className="field">
          <label htmlFor="brief">Consigne</label>
          <textarea
            id="brief" className="input" rows={5} value={draft.brief} maxLength={4000}
            placeholder={'Les 5 samples du pack sont obligatoires.\nAucun autre son externe.\nDuree libre.'}
            onChange={(e) => set('brief', e.target.value)}
          />
          <span className="faint" style={{ fontSize: 12 }}>Affichee en permanence aux participants.</span>
        </div>

        <div className={styles.two}>
          <div className="field">
            <label htmlFor="duration">Duree de creation (minutes)</label>
            <input
              id="duration" className="input" type="number" min={1} max={720} value={draft.durationMin}
              onChange={(e) => set('durationMin', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="grace">Fenetre de grace (minutes)</label>
            <input
              id="grace" className="input" type="number" min={0} max={30} value={draft.graceMin}
              onChange={(e) => set('graceMin', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="field">
          <label>Alertes sonores</label>
          <div className="row wrap">
            {ALERT_CHOICES.map((s) => {
              const on = draft.alerts.includes(s);
              return (
                <button
                  key={s} type="button"
                  className={`btn xs ${on ? 'good' : 'ghost'}`}
                  aria-pressed={on}
                  onClick={() => set('alerts', on ? draft.alerts.filter((a) => a !== s) : [...draft.alerts, s].sort((a, b) => b - a))}
                >
                  {humanThreshold(s)}
                </button>
              );
            })}
          </div>
          <span className="faint" style={{ fontSize: 12 }}>
            Un signal sonore et un changement de couleur du chrono a chaque seuil coche.
          </span>
        </div>

        <div className={styles.two}>
          <div className="field">
            <label htmlFor="scale">Bareme (note maximale)</label>
            <input
              id="scale" className="input" type="number" min={2} max={100} value={draft.scale}
              onChange={(e) => set('scale', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="defaultVote">Note par defaut</label>
            <input
              id="defaultVote" className="input" type="number" min={0} max={draft.scale} step={0.5} value={draft.defaultVote}
              onChange={(e) => set('defaultVote', Number(e.target.value))}
            />
            <span className="faint" style={{ fontSize: 12 }}>Appliquee quand un votant saute un rendu.</span>
          </div>
        </div>

        <div className="field">
          <label>Depots hors delai</label>
          <div className="seg">
            {LATE_POLICIES.map((p) => (
              <button
                key={p.id} type="button"
                aria-pressed={draft.latePolicy === p.id}
                onClick={() => set('latePolicy', p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span className="faint" style={{ fontSize: 12 }}>
            {LATE_POLICIES.find((p) => p.id === draft.latePolicy)?.hint}
          </span>
        </div>

        <label className="switch">
          <input
            type="checkbox" checked={draft.autoAdvance}
            onChange={(e) => set('autoAdvance', e.target.checked)}
          />
          <span className="track" />
          <span>Enchainer sur la diffusion des la fin de la fenetre de grace</span>
        </label>

        {existing
          ? <button className="btn primary" disabled={busy} onClick={saveConfig}>Enregistrer les reglages</button>
          : <button className="btn primary lg block" disabled={busy || draft.name.trim().length < 2} onClick={create}>
              Creer la session
            </button>}
      </>
    );
  }
}
