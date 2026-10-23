/**
 * La migration des manches, eprouvee sur une vraie base de l'ancien schema.
 *
 * C'est la seule migration d'Arena qui reconstruit une table referencee :
 * `submission`, que `vote` et `media_job` designent avec `ON DELETE CASCADE`.
 * Mal faite, elle ne casse rien de visible au demarrage — elle efface en
 * silence tous les votes de toutes les sessions passees. D'ou cette suite : on
 * remplit une base au schema 10, fige dans `fixtures/schema-v10.sql`, on la
 * migre, et on compte.
 */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DATA_DIR = process.env.TEST_DATA_DIR || '/tmp/arena-test-manches-migration';
rmSync(DATA_DIR, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = join(DATA_DIR, 'arena.db');

/* ------------------------------------------------------------------ */
/* Une base au schema 10, avec de quoi perdre                          */
/* ------------------------------------------------------------------ */

const ancienne = new Database(DB_PATH);
ancienne.exec(readFileSync(new URL('./fixtures/schema-v10.sql', import.meta.url), 'utf8'));
ancienne.pragma('user_version = 10');
ancienne.pragma('foreign_keys = ON');

const now = 1_700_000_000_000;
ancienne.prepare(`INSERT INTO session (id, code, name, host_token_hash, phase, media_type, config, created_at, touched_at)
  VALUES ('s1', 'ABCDEF', 'Beat battle', 'h', 'results', 'audio', '{}', ?, ?)`).run(now, now);
for (const [id, pseudo] of [['p1', 'Kira'], ['p2', 'Mael'], ['p3', 'Ines']]) {
  ancienne.prepare(`INSERT INTO participant (id, session_id, pseudo, avatar, token_hash, joined_at, last_seen_at)
    VALUES (?, 's1', ?, 'x', 't', ?, ?)`).run(id, pseudo, now, now);
}
for (const [id, p, r] of [['sub1', 'p1', 'r1'], ['sub2', 'p2', 'r2']]) {
  ancienne.prepare(`INSERT INTO submission (id, session_id, participant_id, rendition_id, uploaded_at, status, kind, inline, filename)
    VALUES (?, 's1', ?, ?, ?, 'ready', 'audio', 1, ?)`).run(id, p, r, now, `${p}.wav`);
}
for (const [sub, voter, v] of [['sub1', 'p2', 4], ['sub1', 'p3', 5], ['sub2', 'p1', 3], ['sub2', 'p3', 2]]) {
  ancienne.prepare('INSERT INTO vote (session_id, submission_id, voter_id, value, at) VALUES (\'s1\', ?, ?, ?, ?)').run(sub, voter, v, now);
}
ancienne.prepare('INSERT INTO media_job (id, submission_id, kind, created_at, updated_at) VALUES (\'j1\', \'sub1\', \'audio\', ?, ?)').run(now, now);
ancienne.close();

/* ------------------------------------------------------------------ */
/* La migration, par le vrai module                                    */
/* ------------------------------------------------------------------ */

process.env.NODE_ENV = 'development';
process.env.DATA_DIR = DATA_DIR;
process.env.DB_PATH = DB_PATH;
process.env.SESSION_SECRET = 'test-secret';
const db = require('../server/db.js');

let passed = 0;
const checks = [];
const test = (name, fn) => checks.push([name, fn]);
const compte = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

test('la base est au dernier schema', () => {
  assert.ok(db.pragma('user_version', { simple: true }) >= 11);
});

test('aucun vote n\'a ete emporte par la reconstruction', () => {
  assert.equal(compte('vote'), 4, 'la cascade du DROP TABLE a efface des votes');
  assert.equal(compte('submission'), 2);
  assert.equal(compte('media_job'), 1, 'la cascade a efface un travail de transcodage');
});

test('les rendus existants deviennent ceux de la manche 1, sans changer d\'identifiant', () => {
  const rows = db.prepare('SELECT id, round, filename, kind, inline, status FROM submission ORDER BY id').all();
  assert.deepEqual(rows.map((r) => [r.id, r.round]), [['sub1', 1], ['sub2', 1]]);
  assert.equal(rows[0].filename, 'p1.wav', 'une colonne ajoutee apres coup a ete perdue');
  assert.equal(rows[0].kind, 'audio');
  assert.equal(rows[0].inline, 1);
  assert.equal(db.prepare('SELECT round FROM session WHERE id = ?').get('s1').round, 1);
});

test('les cles etrangeres sont rallumees, et la base est integre', () => {
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('un participant depose une fois par manche, plus une fois par session', () => {
  const ajout = (id, round) => db.prepare(`INSERT INTO submission (id, session_id, participant_id, round, rendition_id, uploaded_at)
    VALUES (?, 's1', 'p1', ?, ?, ?)`).run(id, round, `r-${id}`, now);
  ajout('sub1-m2', 2);
  assert.throws(() => ajout('sub1-m2-bis', 2), /UNIQUE/);
});

test('les cascades marchent toujours : supprimer une session emporte rendus et votes', () => {
  db.prepare('DELETE FROM session WHERE id = ?').run('s1');
  assert.equal(compte('submission'), 0);
  assert.equal(compte('vote'), 0);
  assert.equal(compte('media_job'), 0);
});

test('les tables de Rebuild The Track existent', () => {
  for (const t of ['extrait', 'attribution', 'manche_resultat']) {
    assert.ok(db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', t), t);
  }
  assert.ok(db.prepare('PRAGMA table_info(spin)').all().some((c) => c.name === 'round'));
});

for (const [name, fn] of checks) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${checks.length} verifications passees`);
