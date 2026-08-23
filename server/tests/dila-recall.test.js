// server/tests/dila-recall.test.js
//
// Pins the recall protocol: identity always loads, recent is bounded
// and excludes transient kinds, pinned matches the operator-curated
// tag list, bumpRecallCounts updates recall_count + last_recalled_at,
// and renderRecallPackForContext is bounded and deterministic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import * as hermesDilaMod from '../migrations/400_hermes_dila.js';
import { applyIdentityMemo } from '../lib/dila-identity-memo.js';
import {
  loadRecallPack,
  bumpRecallCounts,
  renderRecallPackForContext,
  DEFAULT_RECALL_CONFIG,
} from '../lib/dila-recall.js';

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

function seed(db, rows) {
  for (const r of rows) {
    db.prepare(`
      INSERT INTO hermes_dtus (
        id, user_id, title, body_json, tags_json, memory_kind, tier,
        source_kind, visibility, created_at, updated_at
      ) VALUES (?, 'hermes', ?, '{}', ?, ?, 'small', 'hermes_written', 'operator_visible', ?, ?)
    `).run(r.id, r.title, JSON.stringify(r.tags || []), r.kind, r.created, r.created);
  }
}

test('recall: identity memo always loaded when present', () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  applyIdentityMemo(db, '2026-08-11T20:00:00.000Z');
  const pack = loadRecallPack(db);
  assert.equal(pack.ok, true);
  assert.equal(pack.identity_present, true);
  assert.equal(pack.identity_memo_id, 'hermes_identity_memo_v1');
});

test('recall: identity_present=false when memo missing (operator can detect drift)', () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  const pack = loadRecallPack(db);
  assert.equal(pack.identity_present, false);
});

test('recall: recent is bounded and skips working/compressed', () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  const rows = [];
  for (let i = 0; i < 50; i++) {
    rows.push({
      id: `r_${i}`,
      title: `row ${i}`,
      tags: [],
      kind: i < 5 ? 'working' : i < 10 ? 'compressed' : 'semantic',
      created: `2026-08-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00.000Z`,
    });
  }
  seed(db, rows);
  const pack = loadRecallPack(db);
  assert.equal(pack.recent.length, DEFAULT_RECALL_CONFIG.recentLimit);
  for (const r of pack.recent) {
    assert.ok(
      r.memory_kind !== 'working' && r.memory_kind !== 'compressed',
      `recall surfaced a ${r.memory_kind} row; should have skipped`,
    );
  }
});

test('recall: pinned tags are matched across the operator-curated tag list', () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  seed(db, [
    { id: 'p1', title: 'pinned one', tags: ['pinned'], kind: 'semantic', created: '2026-08-10T00:00:00Z' },
    { id: 'p2', title: 'reference one', tags: ['reference'], kind: 'semantic', created: '2026-08-10T00:00:00Z' },
    { id: 'p3', title: 'standing one', tags: ['standing-directive'], kind: 'episodic', created: '2026-08-10T00:00:00Z' },
    { id: 'u1', title: 'unpinned', tags: [], kind: 'episodic', created: '2026-08-10T00:00:00Z' },
    { id: 'u2', title: 'unrelated tag', tags: ['unrelated'], kind: 'episodic', created: '2026-08-10T00:00:00Z' },
  ]);
  const pack = loadRecallPack(db);
  const ids = pack.pinned.map((p) => p.id).sort();
  assert.deepEqual(ids, ['p1', 'p2', 'p3']);
});

test('recall: bumpRecallCounts updates recall_count + last_recalled_at, idempotent shape', () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  applyIdentityMemo(db, '2026-08-11T20:00:00.000Z');
  seed(db, [
    { id: 'a', title: 'a', tags: [], kind: 'semantic', created: '2026-08-10T00:00:00Z' },
    { id: 'b', title: 'b', tags: ['pinned'], kind: 'semantic', created: '2026-08-10T00:00:00Z' },
  ]);
  const pack = loadRecallPack(db);
  const before = db.prepare("SELECT recall_count, last_recalled_at FROM hermes_dtus WHERE id = 'a'").get();
  assert.equal(before.recall_count, 0);
  assert.equal(before.last_recalled_at, null);
  bumpRecallCounts(db, pack, 1_700_000_000_000);
  const after = db.prepare("SELECT recall_count, last_recalled_at FROM hermes_dtus WHERE id = 'a'").get();
  assert.equal(after.recall_count, 1);
  assert.ok(after.last_recalled_at, 'last_recalled_at was not set');
});

test('recall: renderRecallPackForContext is bounded and includes identity_memo marker', () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  applyIdentityMemo(db, '2026-08-11T20:00:00.000Z');
  const pack = loadRecallPack(db);
  const rendered = renderRecallPackForContext(pack, 1_000);
  assert.match(rendered, /dila-recall/);
  assert.match(rendered, /identity_memo: hermes_identity_memo_v1 \(always recalled\)/);
  assert.ok(rendered.length <= 1_000, `rendered output ${rendered.length}b exceeds 1000b cap`);
});

test('recall: renderRecallPackForContext is deterministic across calls', () => {
  const db = freshDb();
  hermesDilaMod.up(db);
  applyIdentityMemo(db, '2026-08-11T20:00:00.000Z');
  const pack = loadRecallPack(db, DEFAULT_RECALL_CONFIG, 1_700_000_000_000);
  const a = renderRecallPackForContext(pack);
  const b = renderRecallPackForContext(pack);
  assert.equal(a, b);
});

test('recall: identity_memo failure mode is surfaced, not silent', () => {
  // loadRecallPack with NO memo must not pretend things are fine.
  // The render function MUST emit an explicit "MISSING" marker so
  // any future reasoning that reads the rendered string knows to
  // re-apply the memo before proceeding.
  const db = freshDb();
  hermesDilaMod.up(db);
  const pack = loadRecallPack(db);
  const rendered = renderRecallPackForContext(pack, 2_000);
  assert.match(rendered, /MISSING/);
});