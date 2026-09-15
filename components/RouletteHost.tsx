'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { Icon } from '@/components/Icon';
import { humanDuration } from '@/lib/format';
import { hex } from '@/lib/hex';
import {
  chronoWillApply, effectsOf, isBlind, pointsWillApply, statusOf,
} from '@/lib/roulette';
import { call } from '@/lib/socket';
import { copyToClipboard } from '@/lib/storage';
import { toast } from '@/lib/toast';
import type {
  BattleState, Phase, RosterEntry, RouletteRules, RouletteState, SpinAck, SpinTarget, Wheel, WheelSlot,
} from '@/lib/types';

import styles from './RouletteHost.module.css';

/**
 * LA ROULETTE, cote regie.
 *
 * Deux roues, et une seule se prepare. Celle des participants se deduit du
 * roster a l'instant du tirage — elle n'est ni stockee ni reglable, c'est la
 * salle telle qu'elle est. Celle des sorts est nommee, gardee d'une soiree a
 * l'autre, et c'est tout ce panneau.
 *
 * Ce que l'animateur doit pouvoir savoir AVANT de lancer, parce que l'apprendre
 * apres ne sert plus a rien :
 *
 *   - qu'un sort de temps ne bougera pas le chrono dans le mode choisi ;
 *   - que les points ne corrigent plus un classement deja devoile ;
 *   - qu'une contrainte individuelle se reconnait a l'ecoute, dans un jeu qui
 *     vote en aveugle ;
 *   - quelles cases sont muettes, et quelle est la part de chacune.
 */

const TARGETS: { id: SpinTarget; label: string }[] = [
  { id: 'one', label: 'Une personne' },
  { id: 'some', label: 'Quelques-uns' },
  { id: 'all', label: 'Tout le monde' },
];

/** Une case en cours de saisie. Le chrono se regle en secondes, pas en millisecondes. */
interface SlotDraft {
  label: string;
  detail: string;
  weight: number;
  points: number;
  chronoS: number;
}

const EMPTY_SLOT: SlotDraft = { label: '', detail: '', weight: 1, points: 0, chronoS: 0 };

export function RouletteHost({
  socket, wheels, roulette, rules, lastSeed, phase, roster,
}: {
  socket: Socket | null;
  wheels: Wheel[];
  roulette: RouletteState;
  /**
   * Les regles du tirage, telles que le serveur les envoie.
   *
   * Null seulement si un serveur plus ancien ne les envoie pas : on se tait
   * alors plutot que de deviner. Un avertissement faux est pire qu'absent.
   */
  rules: RouletteRules | null;
  lastSeed: string | null;
  phase: Phase;
  roster: RosterEntry[];
}) {
  /**
   * Les roues, telles que la regie les connait a l'instant.
   *
   * `hostView` les porte, mais une action sur une roue ne declenche aucune
   * diffusion : les roues ne vivent que dans la vue de la regie, et une soiree
   * n'a pas a recevoir un etat complet parce qu'on a corrige un libelle. Le
   * serveur rend donc l'etat frais dans l'accuse, et c'est lui qui fait foi
   * juste apres un clic — sans cette copie, une roue creee n'apparaitrait qu'au
   * prochain evenement de session, et le compte de cases resterait faux.
   */
  const [known, setKnown] = useState<Wheel[]>(wheels);
  useEffect(() => { setKnown(wheels); }, [wheels]);

  /** La roue ouverte. Une seule : ouvrir la suivante referme la precedente. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [slots, setSlots] = useState<WheelSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [newWheel, setNewWheel] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  /**
   * L'action destructrice qui attend son second clic.
   *
   * Une roue preparee en trois soirees ne se perd pas sur une pression a cote
   * du pouce. Le motif est le meme pour une roue et pour une case : le bouton
   * devient l'aveu, et « ANNULER » est a cote.
   */
  const [confirming, setConfirming] = useState<string | null>(null);

  const [newSlot, setNewSlot] = useState<SlotDraft>(EMPTY_SLOT);
  const [editing, setEditing] = useState<string | null>(null);
  const [edited, setEdited] = useState<SlotDraft>(EMPTY_SLOT);

  const [target, setTarget] = useState<SpinTarget>('one');
  const [howMany, setHowMany] = useState(2);
  /** Faux = un sort chacun, et differents. C'est le mode qui distribue. */
  const [shared, setShared] = useState(false);
  const [includeSpectators, setIncludeSpectators] = useState(false);
  const [ack, setAck] = useState<SpinAck | null>(null);

  const openRef = useRef<string | null>(null);
  openRef.current = openId;

  const loadSlots = useCallback(async (wheelId: string) => {
    if (!socket) return;
    setLoading(true);
    const res = await call<{ wheelId: string | null; slots: WheelSlot[] }>(socket, 'host:wheel-slots', { wheelId });
    setLoading(false);
    if (!res.ok) { toast(res.error, 'err'); return; }
    // Une reponse en retard ne doit pas ecraser les cases de la roue qu'on
    // vient d'ouvrir a la place.
    if (res.wheelId !== openRef.current) return;
    setSlots(res.slots);
  }, [socket]);

  useEffect(() => {
    if (!openId) { setSlots([]); return; }
    void loadSlots(openId);
  }, [openId, loadSlots]);

  // Une roue supprimee — par nous ou depuis une autre regie — ne reste pas
  // ouverte sur des cases qui n'existent plus.
  useEffect(() => {
    if (openId && !known.some((w) => w.id === openId)) setOpenId(null);
  }, [known, openId]);

  const send = async (event: string, payload: Record<string, unknown>): Promise<boolean> => {
    if (!socket) return false;
    setBusy(true);
    const res = await call<{ state?: BattleState }>(socket, event, payload);
    setBusy(false);
    if (!res.ok) { toast(res.error, 'err'); return false; }
    if (res.state?.wheels) setKnown(res.state.wheels);
    return true;
  };

  /**
   * Une action sur une case : la liste ne vient pas de l'etat, on la redemande.
   *
   * `vers` est la clef du serveur pour la position d'arrivee d'un deplacement,
   * pas un oubli de traduction : la charge utile suit `roulette.deplacerCase`.
   */
  const onSlot = async (event: string, payload: Record<string, unknown>) => {
    const ok = await send(event, payload);
    setConfirming(null);
    if (ok && openId) await loadSlots(openId);
    return ok;
  };

  const open = (id: string) => {
    setConfirming(null);
    setRenaming(null);
    setEditing(null);
    setNewSlot(EMPTY_SLOT);
    setOpenId((current) => (current === id ? null : id));
  };

  const createWheel = async () => {
    const name = newWheel.trim();
    if (!name) return;
    if (await send('host:wheel-create', { name })) {
      setNewWheel('');
      toast(`Roue « ${name} » creee`, 'ok');
    }
  };

  const addSlot = async () => {
    if (!openId || !newSlot.label.trim()) return;
    const ok = await onSlot('host:slot-add', {
      wheelId: openId,
      label: newSlot.label,
      detail: newSlot.detail,
      weight: newSlot.weight,
      points: newSlot.points,
      chronoMs: newSlot.chronoS * 1000,
    });
    if (ok) setNewSlot(EMPTY_SLOT);
  };

  const saveSlot = async (slotId: string) => {
    const ok = await onSlot('host:slot-edit', {
      slotId,
      label: edited.label,
      detail: edited.detail,
      weight: edited.weight,
      points: edited.points,
      chronoMs: edited.chronoS * 1000,
    });
    if (ok) setEditing(null);
  };

  const spin = async () => {
    if (!socket || !openId) return;
    setBusy(true);
    const res = await call<SpinAck>(socket, 'host:spin', {
      wheelId: openId, target, howMany, shared, includeSpectators,
    });
    setBusy(false);
    if (!res.ok) { toast(res.error, 'err'); return; }
    setAck(res);
    toast(`Tirage ${hex(res.spins)} lance`, 'ok');
  };

  /* ---------------------- ce que le mode implique ---------------------- */

  /**
   * Qui est dans la roue des participants.
   *
   * Miroir de `roulette.eligibles` : l'animateur tourne la roue, il n'y est
   * pas ; un disqualifie n'y est plus ; un spectateur n'y entre que si on le
   * demande.
   */
  const pool = roster.filter((p) => !p.disqualified && (includeSpectators || !p.spectator)).length;
  const spectators = roster.filter((p) => !p.disqualified && p.spectator).length;

  const playable = slots.filter((s) => s.weight > 0);
  const weightTotal = playable.reduce((n, s) => n + s.weight, 0);
  const mute = slots.length - playable.length;

  const targeted = target === 'all' ? pool : target === 'one' ? 1 : Math.min(Math.max(1, howMany), pool);
  /** Le meme sort pour toute la salle : le seul mode qui ne designe personne. */
  const collective = target === 'all' && shared;

  /*
   * Les avertissements, tires des regles du serveur.
   *
   * Sans regles recues on n'en affiche aucun : annoncer « le chrono ne bougera
   * pas » a partir d'une supposition serait pire que se taire, l'animateur
   * reglerait son tirage sur une phrase fausse.
   */
  const warnings: string[] = [];
  if (rules) {
    if (!collective && isBlind(rules, phase)) {
      warnings.push(
        'Arena vote en aveugle : une contrainte que tout le monde n’a pas se reconnait a l’ecoute, et le rendu cesse d’etre anonyme.',
      );
    }
    if (playable.some((s) => s.chronoMs !== 0) && !chronoWillApply(rules, phase, target, shared)) {
      warnings.push(
        'Une case de cette roue touche au chrono, et il ne bougera pas : l’horloge d’Arena est partagee, un sort de temps ne s’applique qu’a toute la salle, avec le meme sort, pendant que le chrono court. Le sort restera une consigne.',
      );
    }
    if (playable.some((s) => s.points !== 0) && !pointsWillApply(rules, phase)) {
      warnings.push(
        'A cette phase, les points ne corrigent plus le classement : le sort sera lisible mais ne comptera pas.',
      );
    }
  }
  if (!shared && playable.length > 0 && targeted > playable.length) {
    warnings.push(
      `${hex(targeted)} personnes pour ${hex(playable.length)} cases jouables : la roue recommencera un tour et des sorts se repeteront.`,
    );
  }

  const canSpin = !!openId && !!playable.length && pool > 0 && !busy;

  /*
   * Ce que le dernier tirage a reellement fait.
   *
   * On ne le dit que s'il y a quelque chose a dire : annoncer « le chrono n'a
   * pas bouge » quand aucune case ne touchait au temps ajouterait du bruit a un
   * panneau qui doit se lire d'un coup d'oeil. Les effets tires sont lus dans
   * l'etat, l'accuse ne dit que ce qui s'est applique.
   */
  const outcome: string[] = [];
  if (ack) {
    const drawn = roulette.last?.fates ?? [];
    if (ack.epuise) {
      outcome.push(
        'La roue avait moins de cases jouables que de personnes : elle a recommence un tour, et des sorts identiques sont sortis. Ce n’est pas un hasard, c’est une roue trop courte.',
      );
    }
    if (ack.chronoApplicable && ack.chronoMs !== 0) {
      outcome.push(`Chrono : ${ack.chronoMs > 0 ? '+' : '−'}${humanDuration(Math.abs(ack.chronoMs))}, applique a toute la salle.`);
    }
    if (!ack.chronoApplicable && drawn.some((f) => f.chronoMs !== 0)) {
      outcome.push(
        'Un sort de temps est sorti et le chrono n’a pas bouge : ce mode ne le permet pas. Le sort reste lisible, c’est une consigne.',
      );
    }
    if (!ack.pointsApplicables && drawn.some((f) => f.points !== 0)) {
      outcome.push('Les points n’ont pas ete comptes : a cette phase, le sort est une consigne.');
    }
  }

  /* ------------------------------ rendu ------------------------------ */

  return (
    <section className="card pad col">
      <h2 className="section-title">
        LA ROULETTE
        <span className="meta">TIRAGES {hex(roulette.spins)}</span>
      </h2>
      <p className="meta">
        Quelqu&apos;un est tire, un sort est tire. La roue des participants se deduit de la salle a
        l&apos;instant du tirage ; celle des sorts se prepare ici et se garde d&apos;une soiree a
        l&apos;autre. Le nombre de tirages est affiche a l&apos;ecran : une roue qu&apos;on relance
        en secret n&apos;a plus aucune autorite.
      </p>

      {/* ------------------------------ les roues ----------------------- */}

      <div className={styles.wheels}>
        {known.length === 0 && (
          <p className="empty"><span>AUCUNE ROUE. CREEZ-EN UNE, PUIS REMPLISSEZ-LA CASE PAR CASE.</span></p>
        )}
        {known.map((w) => (
          <div key={w.id} className={`${styles.wheel} ${openId === w.id ? styles.open : ''}`}>
            <button
              type="button" className={styles.head}
              aria-expanded={openId === w.id}
              onClick={() => open(w.id)}
            >
              <Icon name={openId === w.id ? 'fleche-b' : 'fleche-d'} />
              <span className={styles.name}>{w.name}</span>
              <span className="meta">{hex(w.slots ?? 0)} CASE{(w.slots ?? 0) > 1 ? 'S' : ''}</span>
            </button>
            <div className={styles.tools}>
              <button
                className="btn xs ghost" type="button"
                onClick={() => { setRenaming(renaming === w.id ? null : w.id); setOpenId(w.id); }}
              >
                <Icon name="reglages" />RENOMMER
              </button>
              {confirming === `w:${w.id}` ? (
                <>
                  <button className="btn xs ghost" type="button" onClick={() => setConfirming(null)}>ANNULER</button>
                  <button
                    className="btn xs danger" type="button" disabled={busy} aria-busy={busy}
                    onClick={async () => {
                      if (await send('host:wheel-remove', { wheelId: w.id })) {
                        toast(`Roue « ${w.name} » supprimee`, 'ok');
                      }
                      setConfirming(null);
                    }}
                  >
                    CONFIRMER LA SUPPRESSION
                  </button>
                </>
              ) : (
                <button className="btn xs danger" type="button" onClick={() => setConfirming(`w:${w.id}`)}>
                  SUPPRIMER
                </button>
              )}
            </div>

            {renaming === w.id && (
              <WheelName
                wheel={w} busy={busy}
                onCancel={() => setRenaming(null)}
                onSave={async (name, note) => {
                  if (await send('host:wheel-rename', { wheelId: w.id, name, note })) setRenaming(null);
                }}
              />
            )}

            {openId === w.id && (
              <div className={styles.slots}>
                <div className={styles.summary}>
                  <span className="meta">
                    {hex(slots.length)} CASE{slots.length > 1 ? 'S' : ''}
                    {mute > 0 && ` · ${hex(mute)} MUETTE${mute > 1 ? 'S' : ''}`}
                    {weightTotal > 0 && ` · POIDS ${hex(weightTotal)}`}
                  </span>
                  {loading && <span className="meta">LECTURE…</span>}
                </div>

                {slots.length === 0 && !loading && (
                  <p className="empty">
                    <span>
                      Cette roue est vide. Une case porte un texte, un poids, et parfois un effet :
                      des points, ou du temps.
                    </span>
                  </p>
                )}

                <ol className={styles.list}>
                  {slots.map((s, i) => (
                    <li key={s.id} className={`${styles.row} ${s.weight === 0 ? styles.mute : ''}`}>
                      {editing === s.id ? (
                        <SlotForm
                          value={edited} busy={busy} rules={rules}
                          onChange={setEdited}
                          onCancel={() => setEditing(null)}
                          onSave={() => void saveSlot(s.id)}
                          saveLabel="ENREGISTRER"
                        />
                      ) : (
                        <>
                          <span className={styles.index}>{hex(i + 1)}</span>
                          <span className={styles.text}>
                            <span className={styles.label}>{s.label}</span>
                            {s.detail && <span className={styles.detail}>{s.detail}</span>}
                            <span className={styles.marks}>
                              {s.weight === 0
                                ? <span className={styles.mark}>MUETTE · JAMAIS TIREE</span>
                                : (
                                  <span className={styles.mark}>
                                    POIDS {s.weight}
                                    {weightTotal > 0 && ` · ${Math.round((s.weight / weightTotal) * 100)} %`}
                                  </span>
                                )}
                              {s.points !== 0 && (
                                <span className={styles.mark}>
                                  {s.points > 0 ? '+' : '−'}{Math.abs(s.points)} POINT{Math.abs(s.points) > 1 ? 'S' : ''}
                                </span>
                              )}
                              {s.chronoMs !== 0 && (
                                <span className={styles.mark}>
                                  {s.chronoMs > 0 ? '+' : '−'}{humanDuration(Math.abs(s.chronoMs)).toUpperCase()} DE CHRONO
                                </span>
                              )}
                            </span>
                          </span>
                          <span className={styles.tools}>
                            <button
                              className="btn xs ghost" type="button" aria-label="Monter cette case"
                              disabled={busy || i === 0}
                              onClick={() => void onSlot('host:slot-move', { slotId: s.id, vers: i - 1 })}
                            >
                              <Icon name="fleche-h" />
                            </button>
                            <button
                              className="btn xs ghost" type="button" aria-label="Descendre cette case"
                              disabled={busy || i === slots.length - 1}
                              onClick={() => void onSlot('host:slot-move', { slotId: s.id, vers: i + 1 })}
                            >
                              <Icon name="fleche-b" />
                            </button>
                            <button
                              className="btn xs ghost" type="button"
                              onClick={() => {
                                setEditing(s.id);
                                setEdited({
                                  label: s.label, detail: s.detail, weight: s.weight,
                                  points: s.points, chronoS: Math.round(s.chronoMs / 1000),
                                });
                              }}
                            >
                              MODIFIER
                            </button>
                            {confirming === `s:${s.id}` ? (
                              <>
                                <button className="btn xs ghost" type="button" onClick={() => setConfirming(null)}>ANNULER</button>
                                <button
                                  className="btn xs danger" type="button" disabled={busy} aria-busy={busy}
                                  onClick={() => void onSlot('host:slot-remove', { slotId: s.id })}
                                >
                                  CONFIRMER
                                </button>
                              </>
                            ) : (
                              <button
                                className="btn xs danger" type="button" aria-label="Retirer cette case"
                                onClick={() => setConfirming(`s:${s.id}`)}
                              >
                                <Icon name="croix" />
                              </button>
                            )}
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ol>

                <div className={styles.add}>
                  <span className="meta">AJOUTER UNE CASE</span>
                  <SlotForm
                    value={newSlot} busy={busy} rules={rules}
                    onChange={setNewSlot}
                    onSave={() => void addSlot()}
                    saveLabel="AJOUTER"
                  />
                  <span className="meta">
                    Un poids a zero garde le texte sans jamais le tirer : une roue se prepare en
                    plusieurs fois.
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={`row wrap ${styles.create}`}>
        <label className="sr-only" htmlFor="roulette-new-wheel">Nom de la nouvelle roue</label>
        <input
          id="roulette-new-wheel" className="input grow" value={newWheel} maxLength={60}
          placeholder="MALUS LEGERS"
          onChange={(e) => setNewWheel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void createWheel(); }}
        />
        <button className="btn" type="button" disabled={busy || !newWheel.trim()} aria-busy={busy} onClick={() => void createWheel()}>
          <Icon name="plus" />CREER UNE ROUE
        </button>
      </div>

      {/* ------------------------------ le tirage ----------------------- */}

      {openId && (
        <div className={styles.spin}>
          <span className="section-title sub">FAIRE TOURNER</span>

          <div className="field">
            <label>QUI EST TIRE</label>
            <div className="seg">
              {TARGETS.map((t) => (
                <button
                  key={t.id} type="button" aria-pressed={target === t.id}
                  onClick={() => setTarget(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className="meta">
              {pool > 0
                ? `${hex(targeted)} SUR ${hex(pool)} DANS LA ROUE`
                : 'PERSONNE DANS LA ROUE : LA SALLE EST VIDE, OU TOUT LE MONDE REGARDE'}
            </span>
          </div>

          {target === 'some' && (
            <div className="field">
              <label htmlFor="roulette-how-many">COMBIEN DE PERSONNES</label>
              <input
                id="roulette-how-many" className="input" type="number" min={1} max={Math.max(1, pool)}
                value={howMany} onChange={(e) => setHowMany(Number(e.target.value))}
              />
            </div>
          )}

          {targeted > 1 && (
            <div className="field">
              <label>QUEL SORT</label>
              <div className="seg">
                <button type="button" aria-pressed={shared} onClick={() => setShared(true)}>Le meme pour tous</button>
                <button type="button" aria-pressed={!shared} onClick={() => setShared(false)}>Un chacun</button>
              </div>
              <span className="meta">
                {shared
                  ? 'UNE SEULE CASE POUR TOUTE LA CIBLE.'
                  : 'UNE CASE PAR PERSONNE, DIFFERENTES TANT QUE LA ROUE EN A.'}
              </span>
            </div>
          )}

          {spectators > 0 && (
            <label className="switch">
              <input
                type="checkbox" checked={includeSpectators}
                onChange={(e) => setIncludeSpectators(e.target.checked)}
              />
              <span className="track" />
              <span>Mettre les {hex(spectators)} spectateur(s) dans la roue</span>
            </label>
          )}

          {warnings.length > 0 && (
            <ul className={styles.warnings}>
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}

          <button
            className="btn primary lg block" type="button"
            disabled={!canSpin} aria-busy={busy}
            title={!playable.length ? 'Toutes les cases sont a zero' : undefined}
            onClick={() => void spin()}
          >
            <Icon name="roue" />FAIRE TOURNER LA ROUE
          </button>

          {ack && outcome.length > 0 && (
            <div className={styles.outcome}>
              <span className="meta">TIRAGE {hex(ack.spins)} · CE QU’IL A FAIT</span>
              {outcome.map((line) => <p key={line}>{line}</p>)}
            </div>
          )}
        </div>
      )}

      {/* --------------------------- le dernier tirage ------------------- */}

      {roulette.last && (
        <div className={styles.last}>
          <span className="section-title sub">DERNIER TIRAGE</span>
          <span className="meta">
            {roulette.last.wheelName} · {hex(roulette.last.fates.length)} SORT
            {roulette.last.fates.length > 1 ? 'S' : ''}
            {roulette.last.fates.length > 1 && (roulette.last.shared ? ' · LE MEME POUR TOUS' : ' · UN CHACUN')}
          </span>
          <ul className={styles.fates}>
            {roulette.last.fates.map((f) => {
              // La meme lecture que l'ecran et que le telephone : les etats
              // viennent du serveur, aucune des trois surfaces ne les deduit.
              const status = statusOf(effectsOf(f));
              return (
                <li key={`${f.pseudo}-${f.position}`}>
                  <span className={styles.label}>{f.pseudo}</span>
                  <span className={styles.detail}>{f.label}</span>
                  <span className={`${styles.mark} ${status.advice ? styles.advice : ''}`}>
                    {status.short}
                  </span>
                </li>
              );
            })}
          </ul>

          {lastSeed && (
            <div className={styles.seed}>
              <span className="meta">GRAINE</span>
              <code className={styles.code}>{lastSeed}</code>
              <button
                className="btn xs ghost" type="button" aria-label="Copier la graine du dernier tirage"
                onClick={() => { void copyToClipboard(lastSeed); toast('Graine copiee', 'ok'); }}
              >
                <Icon name="copier" />COPIER
              </button>
              <span className="meta">
                Meme graine, meme roue, meme liste : le tirage se refait a l&apos;identique. C&apos;est
                de quoi verifier un tirage conteste devant la salle.
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                             */
/* ------------------------------------------------------------------ */

/** Le nom d'une roue, et sa note : de quoi se souvenir a quoi elle servait. */
function WheelName({
  wheel, busy, onSave, onCancel,
}: {
  wheel: Wheel;
  busy: boolean;
  onSave: (name: string, note: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(wheel.name);
  const [note, setNote] = useState(wheel.note ?? '');
  return (
    <div className={styles.rename}>
      <div className="field">
        <label htmlFor={`wheel-name-${wheel.id}`}>NOM</label>
        <input
          id={`wheel-name-${wheel.id}`} className="input" value={name} maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`wheel-note-${wheel.id}`}>NOTE</label>
        <input
          id={`wheel-note-${wheel.id}`} className="input" value={note} maxLength={280}
          placeholder="A QUOI CETTE ROUE SERT, ET QUAND"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="row wrap">
        <button className="btn sm ghost" type="button" onClick={onCancel}>ANNULER</button>
        <button
          className="btn sm primary" type="button" disabled={busy || !name.trim()} aria-busy={busy}
          onClick={() => onSave(name, note)}
        >
          ENREGISTRER
        </button>
      </div>
    </div>
  );
}

/** Une case : son texte, son detail, son poids, ses effets. */
function SlotForm({
  value, busy, rules, onChange, onSave, onCancel, saveLabel,
}: {
  value: SlotDraft;
  busy: boolean;
  /** Les bornes viennent du serveur : sans elles, le champ n'en impose aucune. */
  rules: RouletteRules | null;
  onChange: (v: SlotDraft) => void;
  onSave: () => void;
  onCancel?: () => void;
  saveLabel: string;
}) {
  const set = <K extends keyof SlotDraft>(key: K, v: SlotDraft[K]) => onChange({ ...value, [key]: v });
  const chronoMaxS = rules ? Math.round(rules.chronoMaxMs / 1000) : undefined;
  return (
    <div className={styles.form}>
      <div className="field">
        <label>TEXTE DE LA CASE</label>
        <input
          className="input" value={value.label} maxLength={120}
          placeholder="MONO SEULEMENT"
          onChange={(e) => set('label', e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.label.trim()) onSave(); }}
        />
      </div>
      <div className="field">
        <label>DETAIL</label>
        <input
          className="input" value={value.detail} maxLength={280}
          placeholder="CE QU’IL FAUT COMPRENDRE, SI LE TEXTE NE SUFFIT PAS"
          onChange={(e) => set('detail', e.target.value)}
        />
      </div>
      <div className={styles.three}>
        <div className="field">
          <label>POIDS</label>
          <input
            className="input" type="number" min={0} max={99} value={value.weight}
            onChange={(e) => set('weight', Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>POINTS</label>
          <input
            className="input" type="number" min={rules ? -rules.pointsMax : undefined} max={rules?.pointsMax}
            value={value.points}
            onChange={(e) => set('points', Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>CHRONO (SECONDES)</label>
          <input
            className="input" type="number" min={chronoMaxS ? -chronoMaxS : undefined} max={chronoMaxS} step={15}
            value={value.chronoS}
            onChange={(e) => set('chronoS', Number(e.target.value))}
          />
        </div>
      </div>
      <div className="row wrap">
        {onCancel && <button className="btn sm ghost" type="button" onClick={onCancel}>ANNULER</button>}
        <button
          className="btn sm primary" type="button"
          disabled={busy || !value.label.trim()} aria-busy={busy}
          onClick={onSave}
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
