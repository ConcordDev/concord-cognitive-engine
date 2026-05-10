/**
 * Sprint B Phase 9 — NPC perception snapshot heartbeat contract.
 *
 * Pins the load-bearing behavior:
 *   1. No active grudges + no allied factions → no emit (silent pass).
 *   2. Grudge severity ≥ 6 + player within 30m → emit with
 *      shouldLookAtPlayer = userId, moodBias = 'hostile'.
 *   3. Grudge severity < 6 → no look-at emit.
 *   4. Distance > 30m + finite NPC position → no look-at emit
 *      (position-aware).
 *   5. NPC has no position → unconditional look-at when grudge
 *      severity is high (substrate-only NPCs always react).
 *   6. Multiple grudges → strongest severity wins (single emit per NPC).
 *   7. No active player → silent pass (cheap, no socket noise).
 *
 * The heartbeat reads from city_presence + authored_npcs +
 * npc_grudges (via composeAsymmetryContext). Tests build a small
 * :memory: SQLite seed and stub the realtime emitter.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { runNpcPerceptionSnapshot } from '../emergent/npc-perception-snapshot.js';

let db;
let emittedEvents;
let originalRealtime;

beforeEach(() => {
  db = new Database(':memory:');
  // Minimal schema — enough for composeAsymmetryContext + the
  // heartbeat's queries. We don't run real migrations here; we
  // create only what's needed for the contract.
  db.exec(`
    CREATE TABLE city_presence (
      user_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      x REAL,
      z REAL,
      last_seen_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE authored_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      faction_id TEXT,
      x REAL,
      z REAL
    );
    CREATE TABLE npc_grudges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT,
      narrative TEXT,
      severity INTEGER NOT NULL DEFAULT 1,
      event_at INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at INTEGER
    );
    CREATE TABLE npc_preoccupations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      narrative TEXT,
      established_at INTEGER NOT NULL DEFAULT (unixepoch()),
      fades_at INTEGER
    );
    CREATE TABLE npc_desires (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id TEXT NOT NULL,
      desire_kind TEXT NOT NULL,
      narrative TEXT,
      offered_to_user_id TEXT,
      offered_at INTEGER,
      claimed_at INTEGER
    );
    CREATE TABLE faction_relations (
      faction_a TEXT NOT NULL,
      faction_b TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'neutral',
      since INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (faction_a, faction_b),
      CHECK (faction_a < faction_b)
    );
  `);

  emittedEvents = [];
  originalRealtime = globalThis.__CONCORD_REALTIME__;
  globalThis.__CONCORD_REALTIME__ = {
    io: {
      to: (room) => ({
        emit: (event, payload) => emittedEvents.push({ room, event, payload }),
      }),
    },
  };
});

afterEach(() => {
  try { db?.close(); } catch { /* noop */ }
  globalThis.__CONCORD_REALTIME__ = originalRealtime;
});

function seedPlayer(userId, worldId, x, z) {
  db.prepare(`INSERT INTO city_presence (user_id, world_id, x, z) VALUES (?, ?, ?, ?)`)
    .run(userId, worldId, x, z);
}
function seedNpc(npcId, worldId, factionId, x, z) {
  db.prepare(`INSERT INTO authored_npcs (id, world_id, faction_id, x, z) VALUES (?, ?, ?, ?, ?)`)
    .run(npcId, worldId, factionId, x, z);
}
function seedGrudge(npcId, targetUserId, severity) {
  db.prepare(`
    INSERT INTO npc_grudges (npc_id, target_kind, target_id, narrative, severity)
    VALUES (?, 'player', ?, 'test grudge', ?)
  `).run(npcId, targetUserId, severity);
}

describe('runNpcPerceptionSnapshot — silent pass paths', () => {
  it('no active worlds → silent', async () => {
    const r = await runNpcPerceptionSnapshot({ db });
    assert.equal(r.ok, true);
    assert.equal(r.scanned ?? 0, 0);
    assert.equal(emittedEvents.length, 0);
  });

  it('no players in active world → silent', async () => {
    seedNpc('npc1', 'concordia-hub', 'fac_a', 10, 10);
    const r = await runNpcPerceptionSnapshot({ db });
    assert.equal(r.ok, true);
    // city_presence is the source of "active worlds"; without players
    // the world isn't even iterated.
    assert.equal(emittedEvents.length, 0);
  });

  it('player + npc but no grudge + no faction relation → silent', async () => {
    seedPlayer('u1', 'concordia-hub', 0, 0);
    seedNpc('npc1', 'concordia-hub', null, 5, 5);
    const r = await runNpcPerceptionSnapshot({ db });
    assert.equal(r.ok, true);
    assert.equal(r.scanned, 1);
    assert.equal(emittedEvents.length, 0);
  });
});

describe('runNpcPerceptionSnapshot — grudge → look-at', () => {
  it('grudge severity ≥ 6 + player within 30m → emits look-at', async () => {
    seedPlayer('u1', 'concordia-hub', 0, 0);
    seedNpc('npc1', 'concordia-hub', 'fac_a', 10, 10);
    seedGrudge('npc1', 'u1', 8);
    const r = await runNpcPerceptionSnapshot({ db });
    assert.equal(r.ok, true);
    assert.equal(r.emitted, 1);
    assert.equal(emittedEvents.length, 1);
    const ev = emittedEvents[0];
    assert.equal(ev.event, 'npc:perception-update');
    assert.equal(ev.payload.npcId, 'npc1');
    assert.equal(ev.payload.shouldLookAtPlayer, 'u1');
    assert.equal(ev.payload.activeGrudgeSeverity, 8);
    assert.equal(ev.payload.moodBias, 'hostile');
  });

  it('grudge severity < 6 → no look-at emit', async () => {
    seedPlayer('u1', 'concordia-hub', 0, 0);
    seedNpc('npc1', 'concordia-hub', 'fac_a', 5, 5);
    seedGrudge('npc1', 'u1', 4);
    const r = await runNpcPerceptionSnapshot({ db });
    assert.equal(r.ok, true);
    assert.equal(r.scanned, 1);
    assert.equal(emittedEvents.length, 0);
  });

  it('grudge ≥ 6 + player out of range (distance > 30m) → no look-at', async () => {
    seedPlayer('u1', 'concordia-hub', 0, 0);
    // NPC at 50m away on the X axis
    seedNpc('npc1', 'concordia-hub', 'fac_a', 50, 0);
    seedGrudge('npc1', 'u1', 9);
    const r = await runNpcPerceptionSnapshot({ db });
    assert.equal(r.ok, true);
    assert.equal(emittedEvents.length, 0);
  });

  it('grudge ≥ 6 + NPC has no position → unconditional look-at (substrate NPC)', async () => {
    seedPlayer('u1', 'concordia-hub', 0, 0);
    db.prepare(`INSERT INTO authored_npcs (id, world_id, faction_id) VALUES (?, ?, ?)`)
      .run('npc_substrate', 'concordia-hub', 'fac_a');
    seedGrudge('npc_substrate', 'u1', 7);
    const r = await runNpcPerceptionSnapshot({ db });
    assert.equal(r.emitted, 1);
    assert.equal(emittedEvents[0].payload.shouldLookAtPlayer, 'u1');
  });

  it('multiple grudges → strongest severity wins (one emit per NPC)', async () => {
    seedPlayer('u1', 'concordia-hub', 0, 0);
    seedPlayer('u2', 'concordia-hub', 5, 0);
    seedNpc('npc1', 'concordia-hub', 'fac_a', 8, 0);
    seedGrudge('npc1', 'u1', 6);
    seedGrudge('npc1', 'u2', 9);
    const r = await runNpcPerceptionSnapshot({ db });
    assert.equal(r.emitted, 1);
    assert.equal(emittedEvents[0].payload.shouldLookAtPlayer, 'u2');
    assert.equal(emittedEvents[0].payload.activeGrudgeSeverity, 9);
  });
});

describe('runNpcPerceptionSnapshot — faction-allied posture', () => {
  it('positive faction relation (> 0.30) + multi-faction NPCs → emit ally hint', async () => {
    seedPlayer('u1', 'concordia-hub', 0, 0);
    seedNpc('npc_a', 'concordia-hub', 'fac_a', 10, 10);
    seedNpc('npc_b', 'concordia-hub', 'fac_b', 15, 10);
    db.prepare(`INSERT INTO faction_relations (faction_a, faction_b, score, kind) VALUES (?, ?, ?, ?)`)
      .run('fac_a', 'fac_b', 0.6, 'alliance');
    const r = await runNpcPerceptionSnapshot({ db });
    assert.equal(r.ok, true);
    // Both NPCs should emit (they each see an allied NPC with the same > 0.30 relation).
    assert.ok(r.emitted >= 1);
    const allyEvent = emittedEvents.find(e => e.payload.shouldMirrorPosture);
    assert.ok(allyEvent, 'expected at least one ally-hint emit');
    assert.ok(allyEvent.payload.shouldMirrorPosture.allyNpcId);
    assert.ok(allyEvent.payload.shouldMirrorPosture.intensity > 0);
    assert.equal(allyEvent.payload.moodBias, 'friendly');
  });

  it('relation below threshold → no ally hint', async () => {
    seedPlayer('u1', 'concordia-hub', 0, 0);
    seedNpc('npc_a', 'concordia-hub', 'fac_a', 10, 10);
    seedNpc('npc_b', 'concordia-hub', 'fac_b', 15, 10);
    db.prepare(`INSERT INTO faction_relations (faction_a, faction_b, score, kind) VALUES (?, ?, ?, ?)`)
      .run('fac_a', 'fac_b', 0.10, 'neutral');
    const r = await runNpcPerceptionSnapshot({ db });
    assert.equal(emittedEvents.length, 0);
  });
});

describe('runNpcPerceptionSnapshot — emit shape contract', () => {
  it('payload has the required keys for the npc:perception-update shape', async () => {
    seedPlayer('u1', 'concordia-hub', 0, 0);
    seedNpc('npc1', 'concordia-hub', 'fac_a', 5, 5);
    seedGrudge('npc1', 'u1', 8);
    await runNpcPerceptionSnapshot({ db });
    const ev = emittedEvents[0];
    assert.ok(ev);
    // Required fields per event-shapes.js
    assert.ok('npcId' in ev.payload);
    assert.ok('worldId' in ev.payload);
    assert.ok('moodBias' in ev.payload);
  });
});
