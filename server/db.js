'use strict';

/**
 * Connexion SQLite et schema.
 *
 * Refrain garde ses parties en memoire : un blind test meurt avec l'onglet, et
 * c'est tres bien. Une battle dure deux heures et porte des fichiers televerses
 * — un redemarrage de conteneur ne peut pas les volatiliser. D'ou une base,
 * mais la plus discrete possible : un fichier, aucun service a operer.
 *
 * Le mode WAL laisse les lectures se faire pendant une ecriture. Sans lui, le
 * televersement d'un rendu bloquerait la diffusion de l'etat aux autres.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

/**
 * Migrations lineaires.
 *
 * `user_version` porte le numero applique. Chaque entree ne s'execute qu'une
 * fois et n'est jamais modifiee apres coup : corriger une migration deja
 * deployee laisserait les bases existantes dans un etat qu'aucun code ne
 * connait. Pour changer le schema, on ajoute une entree.
 */
const MIGRATIONS = [
  function initial(d) {
    d.exec(`
      CREATE TABLE session (
        id               TEXT PRIMARY KEY,
        code             TEXT NOT NULL UNIQUE,
        name             TEXT NOT NULL,
        host_token_hash  TEXT NOT NULL,
        phase            TEXT NOT NULL,
        media_type       TEXT NOT NULL,
        brief            TEXT NOT NULL DEFAULT '',
        config           TEXT NOT NULL,
        duplicated_from  TEXT,
        created_at       INTEGER NOT NULL,
        started_at       INTEGER,
        create_end_at    INTEGER,
        grace_end_at     INTEGER,
        paused_at        INTEGER,
        remaining_ms     INTEGER,
        ended_at         INTEGER,
        diffusion_order  TEXT,
        cursor           INTEGER NOT NULL DEFAULT 0,
        revealed_rank    INTEGER,
        touched_at       INTEGER NOT NULL
      );
      CREATE INDEX session_phase_idx ON session(phase, touched_at);

      CREATE TABLE asset (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        filename    TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        bytes       INTEGER NOT NULL,
        mime        TEXT NOT NULL,
        position    INTEGER NOT NULL,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX asset_session_idx ON asset(session_id, position);

      CREATE TABLE participant (
        id           TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        pseudo       TEXT NOT NULL,
        avatar       TEXT NOT NULL,
        token_hash   TEXT NOT NULL,
        is_host      INTEGER NOT NULL DEFAULT 0,
        joined_at    INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        disqualified INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX participant_session_idx ON participant(session_id);

      CREATE TABLE submission (
        id             TEXT PRIMARY KEY,
        session_id     TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
        rendition_id   TEXT NOT NULL UNIQUE,
        original_key   TEXT,
        original_bytes INTEGER NOT NULL DEFAULT 0,
        original_mime  TEXT,
        text_body      TEXT,
        uploaded_at    INTEGER NOT NULL,
        late           INTEGER NOT NULL DEFAULT 0,
        replaced_count INTEGER NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'pending',
        renditions     TEXT,
        error          TEXT,
        UNIQUE(session_id, participant_id)
      );
      CREATE INDEX submission_session_idx ON submission(session_id);

      CREATE TABLE vote (
        session_id    TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        submission_id TEXT NOT NULL REFERENCES submission(id) ON DELETE CASCADE,
        voter_id      TEXT NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
        criterion_id  TEXT NOT NULL DEFAULT '_',
        value         REAL NOT NULL,
        at            INTEGER NOT NULL,
        PRIMARY KEY (submission_id, voter_id, criterion_id)
      );
      CREATE INDEX vote_session_idx ON vote(session_id);

      CREATE TABLE media_job (
        id            TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES submission(id) ON DELETE CASCADE,
        kind          TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'queued',
        attempts      INTEGER NOT NULL DEFAULT 0,
        error         TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX media_job_status_idx ON media_job(status, created_at);

      CREATE TABLE session_event (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        at         INTEGER NOT NULL,
        type       TEXT NOT NULL,
        payload    TEXT
      );
      CREATE INDEX session_event_idx ON session_event(session_id, id);
    `);
  },
];

const applied = db.pragma('user_version', { simple: true });
for (let v = applied; v < MIGRATIONS.length; v++) {
  db.transaction(() => {
    MIGRATIONS[v](db);
    db.pragma(`user_version = ${v + 1}`);
  })();
}

module.exports = db;
