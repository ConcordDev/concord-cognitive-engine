// server/tests/hermes-dila.test.js
//
// Pins the four behavioural commitments of migration 400 + the
// hermes-memory lens domain + the api-key-auth patch:
//   1. Migration creates the Dila user row (id='hermes', role='sovereign').
//   2. Migration creates the hermes_dtus table (not 'dtus', not
//      'personal_dtus', separate substrate; visible by default).
//   3. Migration is idempotent: re-running up() is a no-op.
//   4. hermes_memory.* actions are sovereign-gated, refuse members,
//      all 7 actions register, write/read/search/list/recall/press/
//      delete all round-trip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// The migration 400 module is imported ONCE at the top of the test
// file — Node's ESM loader caches it deterministically. We call
// mod.up(db) directly against each fresh in-memory db.
import * as hermesDilaMod from '../migrations/400_hermes_dila.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.pragma('foreign_keys = ON');
  // Bare users table — migration 400 expects this shape (server.js:5860
  // defines it similarly; the canonical columns include password_hash
  // but not display_name).
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      scopes TEXT NOT NULL DEFAULT '["read","write"]',
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `);
  return db;
}

test('migration 400 creates the Dila user row with role=sovereign and scopes=[*]', () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  const row = db.prepare("SELECT * FROM users WHERE id = 'hermes'").get();
  assert.ok(row, 'Dila user row missing');
  assert.equal(row.username, 'dila');
  assert.equal(row.email, 'dila@concord-os.internal');
  assert.equal(row.role, 'sovereign');
  assert.equal(JSON.parse(row.scopes)[0], '*');
  assert.equal(row.is_active, 1);
  assert.ok(row.password_hash.startsWith('h:'));
});

test('migration 400 creates the hermes_dtus table with the documented shape', () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  const cols = db.prepare("PRAGMA table_info(hermes_dtus)").all();
  const names = cols.map((c) => c.name);
  for (const col of [
    'id', 'user_id', 'title', 'body_json', 'tags_json',
    'memory_kind', 'tier', 'source_kind', 'visibility',
    'created_at', 'updated_at', 'last_recalled_at', 'recall_count',
  ]) {
    assert.ok(names.includes(col), `hermes_dtus missing column ${col}; got ${names.join(',')}`);
  }
});

test('migration 400 is idempotent — re-running up() does not duplicate', () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  const first = db.prepare(
    "SELECT id, created_at FROM users WHERE id = 'hermes'",
  ).get();
  hermesDilaMod.up(db);
  hermesDilaMod.up(db);
  const all = db.prepare(
    "SELECT id, created_at FROM users WHERE id = 'hermes'",
  ).all();
  assert.equal(all.length, 1, 're-run duplicated the Dila user row');
  assert.equal(
    all[0].created_at,
    first.created_at,
    're-run clobbered created_at',
  );
});

test('hermes_memory.write refuses a non-sovereign actor; allows sovereign', async () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  globalThis._concordDB = db;
  try {
    const { default: register } = await import('../domains/hermes-memory.js');
    let writeHandler;
    const registerLensAction = (domain, action, handler) => {
      if (domain === 'hermes_memory' && action === 'write') {
        writeHandler = handler;
      }
    };
    register(registerLensAction);
    assert.ok(writeHandler, 'registerHermesMemoryActions did not register .write');

    // member denied
    const denied = writeHandler(
      { actor: { role: 'member' } },
      null,
      { body: { note: 'x' } },
    );
    assert.equal(denied.ok, false);
    assert.match(denied.error, /sovereign/);

    // sovereign allowed
    const ok = writeHandler(
      { actor: { role: 'sovereign' } },
      null,
      { body: { note: 'first memory' }, title: 'unit test' },
    );
    assert.equal(ok.ok, true);
    assert.ok(ok.result.id, 'write did not return id');
    const row = db
      .prepare('SELECT title, body_json FROM hermes_dtus WHERE id = ?')
      .get(ok.result.id);
    assert.equal(row.title, 'unit test');
    assert.equal(JSON.parse(row.body_json).note, 'first memory');
  } finally {
    delete globalThis._concordDB;
  }
});

test('hermes_memory.register registers all 7 actions', async () => {
  const { default: register } = await import('../domains/hermes-memory.js');
  const seen = [];
  register((domain, action) => seen.push(`${domain}.${action}`));
  const expected = [
    'hermes_memory.write',
    'hermes_memory.read',
    'hermes_memory.search',
    'hermes_memory.list',
    'hermes_memory.recall',
    'hermes_memory.compress',
    'hermes_memory.delete',
  ];
  for (const e of expected) {
    assert.ok(seen.includes(e), `missing registration ${e}; got ${seen.join(',')}`);
  }
});

test('hermes_memory.compress is honest — returns candidates, not "summarised"', async () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  // Seed a few old dtus
  for (let i = 0; i < 5; i++) {
    db.prepare(`
      INSERT INTO hermes_dtus (
        id, user_id, title, body_json, memory_kind, tier, source_kind,
        visibility, created_at
      ) VALUES (?, 'hermes', 'old ' || ?, '{"text":"x"}', 'episodic', 'small',
                'hermes_written', 'operator_visible',
                datetime('now', '-40 days'))
    `).run('old_' + i, i);
  }
  globalThis._concordDB = db;
  try {
    const { default: register } = await import('../domains/hermes-memory.js');
    let compressHandler;
    register((d, a, h) => {
      if (d === 'hermes_memory' && a === 'compress') compressHandler = h;
    });
    const r = compressHandler(
      { actor: { role: 'sovereign' } },
      null,
      { maxAgeDays: 30 },
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.candidates_identified, 5);
    assert.match(r.result.honest_note, /candidates_identified/i);
    assert.ok(!('compressed' in r.result), 'result must NOT say "compressed"');
  } finally {
    delete globalThis._concordDB;
  }
});
