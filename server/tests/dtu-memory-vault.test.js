import { test } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { vaultStore, vaultRecall, vaultCompact, vaultClear, initVaultSchema } from '../lib/dtu-memory-vault.js';

function createInMemoryDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  return db;
}

test('vaultStore and vaultRecall roundtrip', () => {
  const db = createInMemoryDb();
  initVaultSchema(db);

  const stored = vaultStore(db, 'user123', 'exchange', 'key1', 'Test content');

  assert(stored.id);
  assert.strictEqual(stored.userId, 'user123');
  assert.strictEqual(stored.kind, 'exchange');
  assert.strictEqual(stored.content, 'Test content');
});

test('vaultRecall returns stored items', () => {
  const db = createInMemoryDb();
  initVaultSchema(db);

  vaultStore(db, 'user123', 'exchange', 'key1', 'Content one');
  vaultStore(db, 'user123', 'exchange', 'key2', 'Content two');

  const recalled = vaultRecall(db, 'user123', '', null, 10);

  assert(recalled.length >= 2);
  assert(recalled.some(r => r.key === 'key1'));
  assert(recalled.some(r => r.key === 'key2'));
});

test('vaultRecall respects topK limit', () => {
  const db = createInMemoryDb();
  initVaultSchema(db);

  for (let i = 0; i < 10; i++) {
    vaultStore(db, 'user123', 'exchange', `key${i}`, `Content ${i}`);
  }

  const recalled = vaultRecall(db, 'user123', '', null, 3);

  assert(recalled.length <= 3);
});

test('vaultRecall returns empty for unknown user', () => {
  const db = createInMemoryDb();
  initVaultSchema(db);

  vaultStore(db, 'user123', 'exchange', 'key1', 'Content');

  const recalled = vaultRecall(db, 'unknown', '', null, 10);

  assert.strictEqual(recalled.length, 0);
});

test('vaultCompact deletes old entries', () => {
  const db = createInMemoryDb();
  initVaultSchema(db);

  const now = Date.now();
  const old = new Date(now - 48 * 60 * 60 * 1000).getTime();

  const stmt = db.prepare(`
    INSERT INTO memory_vault (user_id, kind, key, content, created_at, access_count)
    VALUES (?, ?, ?, ?, ?, 0)
  `);
  stmt.run('user123', 'exchange', 'old_key', 'Old content', old);
  stmt.run('user123', 'exchange', 'new_key', 'New content', now);

  const result = vaultCompact(db, 'user123', 24 * 60 * 60 * 1000);

  assert.strictEqual(result.deleted, 1);

  const recalled = vaultRecall(db, 'user123', '', null, 10);
  assert(recalled.some(r => r.key === 'new_key'));
  assert(!recalled.some(r => r.key === 'old_key'));
});

test('vaultClear deletes all entries for a user', () => {
  const db = createInMemoryDb();
  initVaultSchema(db);

  vaultStore(db, 'user123', 'exchange', 'key1', 'Content one');
  vaultStore(db, 'user123', 'exchange', 'key2', 'Content two');
  vaultStore(db, 'user456', 'exchange', 'key3', 'Content three');

  const result = vaultClear(db, 'user123');

  assert.strictEqual(result.deleted, 2);

  const recalled123 = vaultRecall(db, 'user123', '', null, 10);
  const recalled456 = vaultRecall(db, 'user456', '', null, 10);

  assert.strictEqual(recalled123.length, 0);
  assert.strictEqual(recalled456.length, 1);
});

test('vaultStore with embedding', () => {
  const db = createInMemoryDb();
  initVaultSchema(db);

  const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
  const stored = vaultStore(db, 'user123', 'exchange', 'key1', 'Content', embedding);

  assert(stored.id);

  const recalled = vaultRecall(db, 'user123', '', embedding, 10);

  assert(recalled.length > 0);
  assert(recalled[0].score >= 0);
  assert(recalled[0].score <= 1.0);
});

test('vaultRecall computes similarity scores', () => {
  const db = createInMemoryDb();
  initVaultSchema(db);

  const embedding1 = [1, 0, 0];
  const embedding2 = [0, 1, 0];
  const embedding3 = [1, 0, 0];

  vaultStore(db, 'user123', 'exchange', 'key1', 'Content one', embedding1);
  vaultStore(db, 'user123', 'exchange', 'key2', 'Content two', embedding2);
  vaultStore(db, 'user123', 'exchange', 'key3', 'Content three', embedding3);

  const recalled = vaultRecall(db, 'user123', '', embedding1, 10);

  assert(recalled.length >= 2);
  assert(recalled[0].score >= recalled[1].score);
});
