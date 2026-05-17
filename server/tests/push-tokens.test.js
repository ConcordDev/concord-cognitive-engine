// Contract test for migration 197 + server/lib/push.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up as migrate197 } from '../migrations/197_push_tokens.js';
import { registerToken, removeToken, sendPush, purgeStale } from '../lib/push.js';

function freshDb() {
  const db = new Database(':memory:');
  migrate197(db);
  return db;
}

test('migration 197 creates push_tokens with the right shape + indexes', () => {
  const db = freshDb();
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='push_tokens'`).get();
  assert.ok(row);
  const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='push_tokens' ORDER BY name`).all().map(r => r.name);
  for (const expected of ['idx_push_tokens_user', 'idx_push_tokens_token', 'idx_push_tokens_used']) {
    assert.ok(idx.includes(expected), `expected index ${expected}`);
  }
});

test('registerToken inserts and is idempotent on (user_id, token)', () => {
  const db = freshDb();
  const r1 = registerToken(db, { userId: 'u1', token: 'tok-A', platform: 'web' });
  assert.equal(r1.ok, true);
  const r2 = registerToken(db, { userId: 'u1', token: 'tok-A', platform: 'web', deviceLabel: 'Chrome' });
  assert.equal(r2.ok, true);
  const rows = db.prepare(`SELECT * FROM push_tokens WHERE user_id = ?`).all('u1');
  assert.equal(rows.length, 1, 'only one row per (user, token)');
  assert.equal(rows[0].device_label, 'Chrome');
});

test('registerToken rejects invalid platform', () => {
  const db = freshDb();
  const r = registerToken(db, { userId: 'u1', token: 'tok', platform: 'invalid' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid_platform');
});

test('registerToken rejects missing user_id or token', () => {
  const db = freshDb();
  assert.equal(registerToken(db, { userId: '', token: 't', platform: 'web' }).ok, false);
  assert.equal(registerToken(db, { userId: 'u', token: '', platform: 'web' }).ok, false);
});

test('removeToken deletes by token', () => {
  const db = freshDb();
  registerToken(db, { userId: 'u1', token: 'tok-X', platform: 'expo' });
  const r = removeToken(db, { token: 'tok-X' });
  assert.equal(r.ok, true);
  assert.equal(r.removed, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM push_tokens`).get().c, 0);
});

test('sendPush with no registered tokens for the user returns sent: 0', async () => {
  const db = freshDb();
  const r = await sendPush(db, { userId: 'nobody', title: 't', body: 'b' });
  assert.equal(r.ok, true);
  assert.equal(r.sent, 0);
  assert.deepEqual(r.results, []);
});

test('sendPush gracefully reports missing web-push dependency', async () => {
  const db = freshDb();
  registerToken(db, { userId: 'u1', token: JSON.stringify({ endpoint: 'https://example/notify' }), platform: 'web' });
  // No VAPID keys + no web-push npm package in this test env → result
  // is honest "web_push_unavailable" — never a fake "sent" envelope.
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  const r = await sendPush(db, { userId: 'u1', title: 't', body: 'b' });
  assert.equal(r.ok, true);
  assert.equal(r.sent, 0);
  assert.equal(r.results[0].ok, false);
  assert.match(r.results[0].reason, /web_push_unavailable|gone_purged|invalid_subscription_json/);
});

test('purgeStale removes tokens older than the cutoff', () => {
  const db = freshDb();
  registerToken(db, { userId: 'u', token: 'old', platform: 'expo' });
  // Backdate the row
  db.prepare(`UPDATE push_tokens SET last_used_at = 1 WHERE token = 'old'`).run();
  const r = purgeStale(db, 30);
  assert.equal(r.ok, true);
  assert.equal(r.purged, 1);
});
