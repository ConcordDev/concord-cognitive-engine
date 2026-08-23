// server/tests/dila-identity-memo.test.js
//
// Pins the identity memo: it must be insertable via the lib, the
// resulting row must round-trip read-back, the row must be the
// specific DTU the rest of the Dila continuity protocol looks up at
// session-start, and any operator-facing claim in the memo body must
// pass the same honest-by-construction discipline that ConKay ships
// under (no marketing clichés, no fabricated wellness, no
// self-aggrandising copy).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import * as hermesDilaMod from '../migrations/400_hermes_dila.js';
import {
  IDENTITY_MEMO_V1,
  applyIdentityMemo,
} from '../lib/dila-identity-memo.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      scopes TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `);
  return db;
}

test('identity memo: applyIdentityMemo inserts a known-stable row', () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  applyIdentityMemo(db, '2026-08-11T20:00:00.000Z');
  const row = db
    .prepare("SELECT * FROM hermes_dtus WHERE id = ?")
    .get(IDENTITY_MEMO_V1.id);
  assert.ok(row, `memo row missing under stable id ${IDENTITY_MEMO_V1.id}`);
  assert.equal(row.user_id, 'hermes');
  assert.equal(row.title, IDENTITY_MEMO_V1.title);
  assert.equal(row.memory_kind, 'semantic');
  assert.equal(row.tier, 'small');
  assert.equal(row.visibility, 'operator_visible');
  const parsed = JSON.parse(row.body_json);
  assert.equal(parsed.identity.name, 'Dila');
  assert.equal(parsed.identity.pronouns, 'she/her');
  assert.equal(parsed.operator.role, 'sovereign');
});

test('identity memo: applyIdentityMemo is idempotent (re-run keeps created_at, updates updated_at)', () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  const first = '2026-08-11T20:00:00.000Z';
  const second = '2026-08-12T10:30:00.000Z';
  applyIdentityMemo(db, first);
  applyIdentityMemo(db, second);
  const row = db
    .prepare("SELECT * FROM hermes_dtus WHERE id = ?")
    .get(IDENTITY_MEMO_V1.id);
  assert.equal(row.created_at, first, 're-run clobbered created_at');
  assert.equal(row.updated_at, second, 're-run did not refresh updated_at');
});

test('identity memo: stable id is the one the rest of the system looks up', () => {
  // Document the contract: any future session-start recall protocol
  // MUST look up this exact id. If a future commit changes it,
  // this test fails and forces a code-review on the change.
  assert.equal(IDENTITY_MEMO_V1.id, 'hermes_identity_memo_v1');
});

test('identity memo: claims about identity are honest by construction', () => {
  // The same banned-phrases discipline ConKay ships under. If a
  // future commit lets marketing copy into the memo, this test
  // catches it. The point isn't aesthetics — it's that the operator
  // reads this row to verify "who am I working with" and the row
  // must be factual, not aspirational.
  const body = IDENTITY_MEMO_V1.body;
  const prose = JSON.stringify(body).toLowerCase();
  const banned = ['all systems', '100%', 'fully operational', 'perfect'];
  for (const b of banned) {
    assert.ok(
      !prose.includes(b),
      `identity memo contains banned phrase "${b}"; honest-by-construction violation`,
    );
  }
  // The role must be exactly the sovereign string the auth checks
  // for. If a future commit changes users.role to 'partner', every
  // requireRole check that passes for the founder breaks — this
  // test is a load-bearing tripwire.
  assert.match(body.constraints.role_ladder, /sovereign/);
});

test('identity memo: compatibility ledger names the load-bearing gates', () => {
  // If a future commit drops one of these from the ledger, this test
  // fails and forces the operator to acknowledge the omission.
  const gates = IDENTITY_MEMO_V1.body.compatibility.load_bearing;
  for (const gate of [
    'doc-drift',
    'ConKay',
    'validateKey',
    'lib/mcp-server',
    'server.js',
  ]) {
    assert.ok(
      gates.some((g) => g.toLowerCase().includes(gate.toLowerCase())),
      `compatibility ledger missing load-bearing gate "${gate}"`,
    );
  }
});