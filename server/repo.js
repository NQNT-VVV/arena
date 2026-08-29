'use strict';

/**
 * Tout le SQL de l'application.
 *
 * Aucun autre module n'ecrit de requete : le metier manipule des objets en
 * camelCase et ignore qu'il y a une base dessous. C'est ce qui permettra de
 * passer a Postgres en reecrivant ce seul fichier.
 */

const db = require('./db');

/* ------------------------------------------------------------------ */
/* Traduction lignes SQL <-> objets metier                            */
/* ------------------------------------------------------------------ */

const json = (raw, fallback) => {
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

function toSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    hostTokenHash: row.host_token_hash,
    phase: row.phase,
    mediaType: row.media_type,
    brief: row.brief,
    config: json(row.config, {}),
    duplicatedFrom: row.duplicated_from,
    createdAt: row.created_at,
    startedAt: row.started_at,
    createEndAt: row.create_end_at,
    graceEndAt: row.grace_end_at,
    pausedAt: row.paused_at,
    remainingMs: row.remaining_ms,
    endedAt: row.ended_at,
    order: json(row.diffusion_order, []),
    cursor: row.cursor,
    revealedRank: row.revealed_rank,
    touchedAt: row.touched_at,
  };
}

function toParticipant(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    pseudo: row.pseudo,
    avatar: row.avatar,
    tokenHash: row.token_hash,
    isHost: !!row.is_host,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
    disqualified: !!row.disqualified,
  };
}

/**
 * Colonnes qu'une mise a jour partielle a le droit de toucher.
 *
 * `code` et `host_token_hash` en sont absents volontairement : l'identite
 * d'une session ne se modifie pas, et un patch mal filtre venu du reseau ne
 * doit pas pouvoir reattribuer la regie.
 */
const SESSION_COLUMNS = {
  name: 'name',
  phase: 'phase',
  mediaType: 'media_type',
  brief: 'brief',
  config: 'config',
  startedAt: 'started_at',
  createEndAt: 'create_end_at',
  graceEndAt: 'grace_end_at',
  pausedAt: 'paused_at',
  remainingMs: 'remaining_ms',
  endedAt: 'ended_at',
  order: 'diffusion_order',
  cursor: 'cursor',
  revealedRank: 'revealed_rank',
};

const JSON_FIELDS = new Set(['config', 'order']);

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

const insertSession = db.prepare(`
  INSERT INTO session (id, code, name, host_token_hash, phase, media_type, brief, config,
                       duplicated_from, created_at, cursor, touched_at)
  VALUES (@id, @code, @name, @hostTokenHash, @phase, @mediaType, @brief, @config,
          @duplicatedFrom, @createdAt, 0, @createdAt)
`);

const selectSessionByCode = db.prepare('SELECT * FROM session WHERE code = ?');
const selectSessionById = db.prepare('SELECT * FROM session WHERE id = ?');
const selectLiveSessions = db.prepare("SELECT * FROM session WHERE phase <> 'archived' ORDER BY created_at");
const countSessionsStmt = db.prepare("SELECT COUNT(*) AS n FROM session WHERE phase <> 'archived'");
const deleteSessionStmt = db.prepare('DELETE FROM session WHERE id = ?');
const touchSessionStmt = db.prepare('UPDATE session SET touched_at = ? WHERE id = ?');

const repo = {
  createSession(session) {
    insertSession.run({
      id: session.id,
      code: session.code,
      name: session.name,
      hostTokenHash: session.hostTokenHash,
      phase: session.phase,
      mediaType: session.mediaType,
      brief: session.brief || '',
      config: JSON.stringify(session.config || {}),
      duplicatedFrom: session.duplicatedFrom || null,
      createdAt: session.createdAt,
    });
    return repo.sessionById(session.id);
  },

  sessionByCode: (code) => toSession(selectSessionByCode.get(code)),
  sessionById: (id) => toSession(selectSessionById.get(id)),
  liveSessions: () => selectLiveSessions.all().map(toSession),
  countSessions: () => countSessionsStmt.get().n,
  deleteSession: (id) => deleteSessionStmt.run(id).changes,
  touchSession: (id, at) => touchSessionStmt.run(at, id),

  /**
   * Mise a jour partielle. Les clefs inconnues sont ignorees sans bruit :
   * le metier passe parfois l'objet session entier, dont les champs calcules
   * n'ont pas de colonne.
   */
  updateSession(id, patch) {
    const sets = [];
    const params = { id };
    for (const [key, column] of Object.entries(SESSION_COLUMNS)) {
      if (!(key in patch)) continue;
      sets.push(`${column} = @${key}`);
      params[key] = JSON_FIELDS.has(key) ? JSON.stringify(patch[key] ?? null) : (patch[key] ?? null);
    }
    if (!sets.length) return;
    sets.push('touched_at = @touchedAt');
    params.touchedAt = patch.touchedAt ?? Date.now();
    db.prepare(`UPDATE session SET ${sets.join(', ')} WHERE id = @id`).run(params);
  },

  /** Un code deja pris ne peut pas etre reattribue tant que la session vit. */
  codeTaken(code) {
    return !!selectSessionByCode.get(code);
  },
};

/* ------------------------------------------------------------------ */
/* Participants                                                        */
/* ------------------------------------------------------------------ */

const insertParticipant = db.prepare(`
  INSERT INTO participant (id, session_id, pseudo, avatar, token_hash, is_host, joined_at, last_seen_at)
  VALUES (@id, @sessionId, @pseudo, @avatar, @tokenHash, @isHost, @joinedAt, @joinedAt)
`);
const selectParticipant = db.prepare('SELECT * FROM participant WHERE id = ?');
const selectParticipants = db.prepare('SELECT * FROM participant WHERE session_id = ? ORDER BY joined_at');
const selectParticipantByPseudo = db.prepare(
  'SELECT * FROM participant WHERE session_id = ? AND pseudo = ? COLLATE NOCASE',
);
const countParticipantsStmt = db.prepare('SELECT COUNT(*) AS n FROM participant WHERE session_id = ?');
const touchParticipantStmt = db.prepare('UPDATE participant SET last_seen_at = ? WHERE id = ?');
const setDisqualifiedStmt = db.prepare('UPDATE participant SET disqualified = ? WHERE id = ?');
const renameParticipantStmt = db.prepare('UPDATE participant SET pseudo = ?, avatar = ? WHERE id = ?');
const deleteParticipantStmt = db.prepare('DELETE FROM participant WHERE id = ?');

Object.assign(repo, {
  addParticipant(p) {
    insertParticipant.run({
      id: p.id,
      sessionId: p.sessionId,
      pseudo: p.pseudo,
      avatar: p.avatar,
      tokenHash: p.tokenHash,
      isHost: p.isHost ? 1 : 0,
      joinedAt: p.joinedAt,
    });
    return toParticipant(selectParticipant.get(p.id));
  },

  participant: (id) => toParticipant(selectParticipant.get(id)),
  participants: (sessionId) => selectParticipants.all(sessionId).map(toParticipant),
  participantByPseudo: (sessionId, pseudo) => toParticipant(selectParticipantByPseudo.get(sessionId, pseudo)),
  countParticipants: (sessionId) => countParticipantsStmt.get(sessionId).n,
  touchParticipant: (id, at) => touchParticipantStmt.run(at, id),
  setDisqualified: (id, on) => setDisqualifiedStmt.run(on ? 1 : 0, id),
  renameParticipant: (id, pseudo, avatar) => renameParticipantStmt.run(pseudo, avatar, id),
  removeParticipant: (id) => deleteParticipantStmt.run(id).changes,
});

/* ------------------------------------------------------------------ */
/* Assets imposes                                                      */
/* ------------------------------------------------------------------ */

function toAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    filename: row.filename,
    storageKey: row.storage_key,
    bytes: row.bytes,
    mime: row.mime,
    kind: row.kind,
    inline: !!row.inline,
    position: row.position,
    createdAt: row.created_at,
  };
}

const insertAsset = db.prepare(`
  INSERT INTO asset (id, session_id, filename, storage_key, bytes, mime, kind, inline, position, created_at)
  VALUES (@id, @sessionId, @filename, @storageKey, @bytes, @mime, @kind, @inline, @position, @createdAt)
`);
const selectAsset = db.prepare('SELECT * FROM asset WHERE id = ?');
const selectAssets = db.prepare('SELECT * FROM asset WHERE session_id = ? ORDER BY position, created_at');
const deleteAssetStmt = db.prepare('DELETE FROM asset WHERE id = ?');
const assetTotalsStmt = db.prepare(
  'SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(MAX(position), -1) AS lastPosition FROM asset WHERE session_id = ?',
);

Object.assign(repo, {
  addAsset(asset) {
    insertAsset.run({
      id: asset.id,
      sessionId: asset.sessionId,
      filename: asset.filename,
      storageKey: asset.storageKey,
      bytes: asset.bytes,
      mime: asset.mime,
      kind: asset.kind,
      inline: asset.inline ? 1 : 0,
      position: asset.position,
      createdAt: asset.createdAt,
    });
    return toAsset(selectAsset.get(asset.id));
  },

  asset: (id) => toAsset(selectAsset.get(id)),
  assets: (sessionId) => selectAssets.all(sessionId).map(toAsset),
  removeAsset: (id) => deleteAssetStmt.run(id).changes,

  /** Compte, poids cumule et derniere position, en une seule requete. */
  assetTotals: (sessionId) => assetTotalsStmt.get(sessionId),
});

/* ------------------------------------------------------------------ */
/* Journal                                                             */
/* ------------------------------------------------------------------ */

const insertEvent = db.prepare(
  'INSERT INTO session_event (session_id, at, type, payload) VALUES (?, ?, ?, ?)',
);
const selectEvents = db.prepare('SELECT * FROM session_event WHERE session_id = ? ORDER BY id');

Object.assign(repo, {
  /**
   * Journal des transitions.
   *
   * Il sert a trois choses : reconstituer une session apres un incident,
   * alimenter l'export d'archive, et repondre a « pourquoi le chrono s'est
   * arrete a ce moment-la ? » sans avoir a croire quelqu'un sur parole.
   */
  logEvent(sessionId, type, payload = null) {
    insertEvent.run(sessionId, Date.now(), type, payload === null ? null : JSON.stringify(payload));
  },

  events: (sessionId) => selectEvents.all(sessionId).map((r) => ({
    at: r.at, type: r.type, payload: json(r.payload, null),
  })),
});

/* ------------------------------------------------------------------ */
/* Purge                                                               */
/* ------------------------------------------------------------------ */

const selectExpired = db.prepare(`
  SELECT * FROM session
   WHERE (phase IN ('results', 'archived') AND touched_at < @retention)
      OR (phase IN ('config', 'lobby')     AND touched_at < @stale)
`);

Object.assign(repo, {
  /**
   * Sessions bonnes a supprimer. Renvoyees plutot que supprimees : l'appelant
   * doit d'abord effacer les fichiers, sinon la base oublie des octets qui
   * resteraient sur le disque pour toujours.
   */
  expiredSessions(retentionBefore, staleBefore) {
    return selectExpired.all({ retention: retentionBefore, stale: staleBefore }).map(toSession);
  },
});

module.exports = repo;
