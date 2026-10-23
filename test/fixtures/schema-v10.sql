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
      , diffusion_started_at INTEGER, diffusion_advance_at INTEGER, diffusion_ends_at INTEGER);

CREATE TABLE asset (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        filename    TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        bytes       INTEGER NOT NULL,
        mime        TEXT NOT NULL,
        position    INTEGER NOT NULL,
        created_at  INTEGER NOT NULL
      , kind   TEXT    NOT NULL DEFAULT 'other', inline INTEGER NOT NULL DEFAULT 0);

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
      , podium_pid TEXT, spectator INTEGER NOT NULL DEFAULT 0);

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
        error          TEXT, kind   TEXT    NOT NULL DEFAULT 'other', inline INTEGER NOT NULL DEFAULT 0, filename TEXT,
        UNIQUE(session_id, participant_id)
      );

CREATE TABLE vote (
        session_id    TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        submission_id TEXT NOT NULL REFERENCES submission(id) ON DELETE CASCADE,
        voter_id      TEXT NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
        criterion_id  TEXT NOT NULL DEFAULT '_',
        value         REAL NOT NULL,
        at            INTEGER NOT NULL,
        PRIMARY KEY (submission_id, voter_id, criterion_id)
      );

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

CREATE TABLE session_event (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        at         INTEGER NOT NULL,
        type       TEXT NOT NULL,
        payload    TEXT
      );

CREATE TABLE chain_line (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id     TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        participant_id TEXT REFERENCES participant(id) ON DELETE SET NULL,
        pseudo         TEXT NOT NULL,
        body           TEXT NOT NULL,
        at             INTEGER NOT NULL
      );

CREATE TABLE wheel (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        note       TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

CREATE TABLE wheel_slot (
        id        TEXT PRIMARY KEY,
        wheel_id  TEXT NOT NULL REFERENCES wheel(id) ON DELETE CASCADE,
        label     TEXT NOT NULL,
        detail    TEXT NOT NULL DEFAULT '',
        -- Un poids fait les sorts rares. Zero retire la case sans l'effacer :
        -- on prepare une roue en plusieurs fois, on n'aime pas perdre un texte.
        weight    INTEGER NOT NULL DEFAULT 1,
        -- L'effet mecanique, s'il y en a un. Zero partout = purement narratif,
        -- et c'est le defaut : un sort qui ne touche a rien ne peut rien casser.
        points    INTEGER NOT NULL DEFAULT 0,
        chrono_ms INTEGER NOT NULL DEFAULT 0,
        position  INTEGER NOT NULL
      );

CREATE TABLE spin (
        id         TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        -- Trace, jamais source : la roue peut disparaitre, le tirage reste.
        wheel_id   TEXT,
        wheel_name TEXT NOT NULL,
        -- 'one' | 'some' | 'all' : combien de personnes sont touchees.
        target     TEXT NOT NULL,
        how_many   INTEGER NOT NULL DEFAULT 1,
        -- Le meme sort pour tous, ou un sort chacun.
        shared     INTEGER NOT NULL DEFAULT 0,
        phase      TEXT NOT NULL,
        seed       TEXT NOT NULL,
        at         INTEGER NOT NULL
      , pool   TEXT NOT NULL DEFAULT '[]', slots  TEXT NOT NULL DEFAULT '[]', spent  INTEGER NOT NULL DEFAULT 0);

CREATE TABLE spin_fate (
        id             TEXT PRIMARY KEY,
        spin_id        TEXT NOT NULL REFERENCES spin(id) ON DELETE CASCADE,
        -- Le participant peut partir ; son sort garde son pseudo.
        participant_id TEXT REFERENCES participant(id) ON DELETE SET NULL,
        pseudo         TEXT NOT NULL,
        label          TEXT NOT NULL,
        detail         TEXT NOT NULL DEFAULT '',
        points         INTEGER NOT NULL DEFAULT 0,
        chrono_ms      INTEGER NOT NULL DEFAULT 0,
        /*
         * Un etat par effet, et non un seul pour les deux.
         *
         * Un sort peut couter des points ET donner du temps, et l'un des deux
         * peut avoir joue sans l'autre : les points ne corrigent plus un
         * classement devoile, le chrono ne bouge que pour la salle entiere
         * pendant qu'il court. Un unique drapeau forcait les pages a redeviner
         * la regle, et une page qui redevine finit par contredire le serveur.
         *
         * Nul veut dire « pas applique » : le sort reste alors une consigne, et
         * l'interface le dit au lieu de faire semblant.
         */
        points_applied_at INTEGER,
        chrono_applied_at INTEGER,
        position       INTEGER NOT NULL
      , pool_index INTEGER NOT NULL DEFAULT -1, slot_index INTEGER NOT NULL DEFAULT -1);

CREATE INDEX session_phase_idx ON session(phase, touched_at);

CREATE INDEX asset_session_idx ON asset(session_id, position);

CREATE INDEX participant_session_idx ON participant(session_id);

CREATE INDEX submission_session_idx ON submission(session_id);

CREATE INDEX vote_session_idx ON vote(session_id);

CREATE INDEX media_job_status_idx ON media_job(status, created_at);

CREATE INDEX session_event_idx ON session_event(session_id, id);

CREATE INDEX chain_line_session_idx ON chain_line(session_id, id);

CREATE INDEX wheel_slot_order_idx ON wheel_slot(wheel_id, position);

CREATE INDEX spin_session_idx ON spin(session_id, at);

CREATE INDEX spin_fate_spin_idx ON spin_fate(spin_id, position);

CREATE INDEX spin_fate_part_idx ON spin_fate(participant_id);
