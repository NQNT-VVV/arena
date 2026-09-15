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

  function fileKinds(d) {
    // `kind` pilote l'affichage (audio, image, video, text, other) et `inline`
    // dit si le fichier a le droit d'etre rendu dans la page. Les deux sont
    // decides une fois, au televersement, a partir des octets reels : les
    // recalculer a chaque requete voudrait dire relire chaque fichier.
    d.exec(`
      ALTER TABLE asset      ADD COLUMN kind   TEXT    NOT NULL DEFAULT 'other';
      ALTER TABLE asset      ADD COLUMN inline INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE submission ADD COLUMN kind   TEXT    NOT NULL DEFAULT 'other';
      ALTER TABLE submission ADD COLUMN inline INTEGER NOT NULL DEFAULT 0;
    `);
  },

  function submissionFilename(d) {
    // Le nom d'origine sert a proposer un telechargement lisible **apres** la
    // revelation. Il n'apparait jamais pendant la diffusion : c'est souvent la
    // premiere chose qui trahit un auteur.
    d.exec("ALTER TABLE submission ADD COLUMN filename TEXT;");
  },

  function diffusionTiming(d) {
    // L'instant d'ouverture du rendu en cours et l'instant du passage au
    // suivant. Persistes : un redemarrage en pleine diffusion doit reprendre
    // l'ecoute a la bonne seconde et rearmer l'avancement automatique.
    d.exec(`
      ALTER TABLE session ADD COLUMN diffusion_started_at INTEGER;
      ALTER TABLE session ADD COLUMN diffusion_advance_at INTEGER;
    `);
  },

  function diffusionEndsAt(d) {
    // La fin d'ecoute est stockee plutot que recalculee : elle depend de la
    // duree reelle du rendu quand le transcodage l'a mesuree, et ce calcul ne
    // doit etre fait qu'une fois, a l'ouverture du rendu.
    d.exec('ALTER TABLE session ADD COLUMN diffusion_ends_at INTEGER;');
  },

  function podiumIdentity(d) {
    // Compte Podium du participant, lu dans le cookie signe du hub au moment
    // du join. Null pour qui joue sans compte : le pseudo suffit toujours.
    d.exec('ALTER TABLE participant ADD COLUMN podium_pid TEXT;');
  },

  function spectators(d) {
    // Un spectateur vient juger sans creer : il ne depose rien, ne peut pas
    // gagner, mais sa voix compte au meme titre que celle des createurs.
    // Colonne plutot qu'une table : c'est un participant, avec un droit en
    // moins et aucun en plus.
    d.exec('ALTER TABLE participant ADD COLUMN spectator INTEGER NOT NULL DEFAULT 0;');
  },

  /**
   * La chaine : ce que les spectateurs ecrivent pendant que les autres creent.
   *
   * Une ligne par tour. On ne garde pas le tour courant en base — il se deduit
   * de la derniere ligne et de l'ordre des spectateurs, et une valeur deduite
   * ne peut pas se desynchroniser de ce qu'elle decrit.
   */
  function chaine(d) {
    d.exec(`
      CREATE TABLE chain_line (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id     TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        participant_id TEXT REFERENCES participant(id) ON DELETE SET NULL,
        pseudo         TEXT NOT NULL,
        body           TEXT NOT NULL,
        at             INTEGER NOT NULL
      );
      CREATE INDEX chain_line_session_idx ON chain_line(session_id, id);
    `);
  },
  /**
   * LA ROULETTE — un sort tire au hasard, et devant temoin.
   *
   * Arena impose des contraintes : c'est sa premisse. La roulette ne fait que
   * la rendre visible — au lieu que l'animateur decide, on tire.
   *
   * DEUX ROUES, et une seule se stocke. Celle des participants se deduit du
   * roster a l'instant du tirage : la stocker voudrait dire la tenir a jour a
   * chaque arrivee et chaque depart, pour recalculer ce qu'on sait deja.
   * Celle des sorts, elle, se prepare entre deux sessions et se reutilise.
   *
   * CE QUI EST TIRE EST RECOPIE. Le libelle d'un sort et le pseudo d'un
   * participant sont dupliques dans le tirage. Une roue renommee, un sort
   * corrige, un participant parti : rien de tout cela n'a le droit de
   * reecrire ce qui s'est passe.
   *
   * LA GRAINE EST GARDEE. Un tirage qu'on ne peut pas rejouer est un tirage
   * qu'on ne peut pas defendre. Avec elle, la meme graine et la meme liste
   * rendent le meme sort, et la salle peut demander a verifier.
   */
  function roulette(d) {
    d.exec(`
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
      CREATE INDEX wheel_slot_order_idx ON wheel_slot(wheel_id, position);

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
      );
      CREATE INDEX spin_session_idx ON spin(session_id, at);

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
      );
      CREATE INDEX spin_fate_spin_idx ON spin_fate(spin_id, position);
      CREATE INDEX spin_fate_part_idx ON spin_fate(participant_id);
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
