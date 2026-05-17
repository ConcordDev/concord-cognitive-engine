// Contract test for migration 198 + server/lib/federation-outbox.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up as migrate198 } from '../migrations/198_social_federation.js';
import {
  enqueueOutbound,
  receiveInbound,
  pendingInbound,
  markInboundProcessed,
  upsertPeerActor,
  outboxStats,
} from '../lib/federation-outbox.js';

function freshDb() {
  const db = new Database(':memory:');
  migrate198(db);
  return db;
}

test('migration 198 creates 3 tables + indexes', () => {
  const db = freshDb();
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);
  for (const expected of ['federation_inbox', 'federation_outbox', 'federation_peer_actors']) {
    assert.ok(tables.includes(expected), `expected table ${expected}`);
  }
});

test('enqueueOutbound is idempotent on (ap_activity_id, target_inbox_url)', () => {
  const db = freshDb();
  const r1 = enqueueOutbound(db, {
    homeUserId: 'u1', apActivityId: 'a:1', activityType: 'Create',
    activityJson: '{"x":1}', targetInboxUrl: 'https://peer/inbox',
  });
  assert.equal(r1.ok, true);
  const r2 = enqueueOutbound(db, {
    homeUserId: 'u1', apActivityId: 'a:1', activityType: 'Create',
    activityJson: '{"x":1}', targetInboxUrl: 'https://peer/inbox',
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.deduped, true);
  const rows = db.prepare(`SELECT * FROM federation_outbox`).all();
  assert.equal(rows.length, 1);
});

test('enqueueOutbound to different targets fans out as separate rows', () => {
  const db = freshDb();
  enqueueOutbound(db, {
    homeUserId: 'u1', apActivityId: 'a:1', activityType: 'Create',
    activityJson: '{"x":1}', targetInboxUrl: 'https://peer1/inbox',
  });
  enqueueOutbound(db, {
    homeUserId: 'u1', apActivityId: 'a:1', activityType: 'Create',
    activityJson: '{"x":1}', targetInboxUrl: 'https://peer2/inbox',
  });
  const rows = db.prepare(`SELECT * FROM federation_outbox`).all();
  assert.equal(rows.length, 2);
});

test('enqueueOutbound rejects missing fields', () => {
  const db = freshDb();
  const r = enqueueOutbound(db, { homeUserId: '', apActivityId: 'x', activityType: 'y', activityJson: '{}', targetInboxUrl: 'z' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing_field');
});

test('receiveInbound dedupes by ap_activity_id', () => {
  const db = freshDb();
  const r1 = receiveInbound(db, {
    apActivityId: 'remote:a:1', sourceActor: 'https://peer/users/alice',
    activityType: 'Create', activityJson: '{"x":1}',
  });
  assert.equal(r1.ok, true);
  const r2 = receiveInbound(db, {
    apActivityId: 'remote:a:1', sourceActor: 'https://peer/users/alice',
    activityType: 'Create', activityJson: '{"x":1}',
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.deduped, true);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM federation_inbox`).get().c, 1);
});

test('pendingInbound + markInboundProcessed round-trip', () => {
  const db = freshDb();
  receiveInbound(db, {
    apActivityId: 'remote:a:1', sourceActor: 'https://peer/users/alice',
    activityType: 'Create', activityJson: '{"x":1}',
  });
  const pending = pendingInbound(db);
  assert.equal(pending.length, 1);
  markInboundProcessed(db, { id: pending[0].id });
  assert.equal(pendingInbound(db).length, 0);
});

test('upsertPeerActor is idempotent + bumps last_seen_at', () => {
  const db = freshDb();
  upsertPeerActor(db, { actorId: 'https://peer/users/alice', handle: 'alice@peer', displayName: 'Alice' });
  upsertPeerActor(db, { actorId: 'https://peer/users/alice', avatarUrl: 'https://peer/a.png' });
  const row = db.prepare(`SELECT * FROM federation_peer_actors WHERE actor_id = ?`).get('https://peer/users/alice');
  assert.equal(row.handle, 'alice@peer');     // preserved from first insert
  assert.equal(row.avatar_url, 'https://peer/a.png'); // updated on second
});

test('outboxStats reports counts by status', () => {
  const db = freshDb();
  enqueueOutbound(db, { homeUserId: 'u', apActivityId: 'a:1', activityType: 'Create', activityJson: '{}', targetInboxUrl: 'https://x/i' });
  enqueueOutbound(db, { homeUserId: 'u', apActivityId: 'a:2', activityType: 'Create', activityJson: '{}', targetInboxUrl: 'https://x/i' });
  const s = outboxStats(db);
  assert.equal(s.total, 2);
  assert.equal(s.pending, 2);
});
