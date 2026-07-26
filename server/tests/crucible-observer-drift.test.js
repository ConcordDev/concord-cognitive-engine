/**
 * Tier-2 contract tests for the lattice-crucible bespoke mechanic:
 * "player-conditional drift".
 *
 * Grounded in content/world/lattice-crucible/{npcs,lore}.json (see the
 * citation header in migration 391 and lib/embodied/crucible-observer-drift.js).
 *
 * Pins:
 *   - the mechanic's real effect: a drift event is only ever recorded
 *     while a genuine, open world_visits row proves the caller is
 *     standing in lattice-crucible right now
 *   - the honest failure path: no fabricated success when there's no
 *     observer present, or when called for a different world
 *   - scoping: the mechanic never leaks to (or accepts writes tagged
 *     for) any world other than lattice-crucible
 *   - Orla's corpus accumulates and reports accurately
 *   - disclosure is a deliberate, explicit act — never automatic
 *
 * Run: node --test server/tests/crucible-observer-drift.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../migrate.js";
import {
  recordObserverDrift,
  getOrlaCorpus,
  discloseCorpus,
  isObserverPresent,
  pickDriftType,
  CRUCIBLE_WORLD_ID,
} from "../lib/embodied/crucible-observer-drift.js";
import { ALL_DRIFT_TYPES } from "../emergent/drift-monitor.js";

// Migration 042 (world_visits) assumes earlier migrations already ran —
// applying it standalone throws (no such table: player_world_state). The
// established pattern (see tests/world-overview-connections.test.js) is to
// run the FULL migration chain against a fresh in-memory db instead of
// hand-picking files.
async function setupDb() {
  const db = new Database(":memory:");
  await runMigrations(db);
  db.prepare(`INSERT OR IGNORE INTO worlds (id, name, universe_type) VALUES (?, ?, 'lattice')`)
    .run(CRUCIBLE_WORLD_ID, CRUCIBLE_WORLD_ID);
  return db;
}

function arriveInWorld(db, { userId, worldId, departed = false }) {
  db.prepare(`
    INSERT INTO world_visits (id, user_id, world_id, arrived_at, departed_at)
    VALUES (?, ?, ?, unixepoch(), ?)
  `).run(`visit_${userId}_${worldId}_${Math.random()}`, userId, worldId, departed ? 0 : null);
}

describe("crucible-observer-drift: pickDriftType", () => {
  it("only ever picks from the federation's real drift taxonomy", () => {
    for (let i = 0; i < 25; i++) {
      const t = pickDriftType(`seed-${i}`);
      assert.ok(ALL_DRIFT_TYPES.includes(t), `${t} must be a real DRIFT_TYPES value`);
    }
  });

  it("is deterministic for the same seed", () => {
    assert.equal(pickDriftType("stable-seed"), pickDriftType("stable-seed"));
  });
});

describe("crucible-observer-drift: isObserverPresent", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });

  it("is false with no visit at all", () => {
    assert.equal(isObserverPresent(db, CRUCIBLE_WORLD_ID, "u1"), false);
  });

  it("is true with an open (undeparted) visit", () => {
    arriveInWorld(db, { userId: "u1", worldId: CRUCIBLE_WORLD_ID });
    assert.equal(isObserverPresent(db, CRUCIBLE_WORLD_ID, "u1"), true);
  });

  it("is false once the visit has departed", () => {
    arriveInWorld(db, { userId: "u1", worldId: CRUCIBLE_WORLD_ID, departed: true });
    assert.equal(isObserverPresent(db, CRUCIBLE_WORLD_ID, "u1"), false);
  });

  it("does not count a visit to a different world", () => {
    arriveInWorld(db, { userId: "u1", worldId: "concordia-hub" });
    assert.equal(isObserverPresent(db, CRUCIBLE_WORLD_ID, "u1"), false);
  });
});

describe("crucible-observer-drift: recordObserverDrift (real effect + honest failure)", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });

  it("REAL EFFECT: writes a real row + returns a real drift type when the observer is genuinely present", () => {
    arriveInWorld(db, { userId: "u1", worldId: CRUCIBLE_WORLD_ID });
    const result = recordObserverDrift(db, { worldId: CRUCIBLE_WORLD_ID, userId: "u1" });

    assert.equal(result.ok, true);
    assert.ok(ALL_DRIFT_TYPES.includes(result.driftType));
    assert.equal(result.corpusSize, 1);

    const row = db.prepare("SELECT * FROM crucible_observer_drift_log WHERE id = ?").get(result.logId);
    assert.ok(row, "the log row must actually exist in the DB, not just in the return value");
    assert.equal(row.world_id, CRUCIBLE_WORLD_ID);
    assert.equal(row.observer_user_id, "u1");
    assert.equal(row.drift_type, result.driftType);
    assert.equal(row.disclosed, 0, "undisclosed by default — Orla hasn't told the other Witnesses");
  });

  it("accumulates corpusSize across multiple observers/events", () => {
    arriveInWorld(db, { userId: "u1", worldId: CRUCIBLE_WORLD_ID });
    arriveInWorld(db, { userId: "u2", worldId: CRUCIBLE_WORLD_ID });
    const r1 = recordObserverDrift(db, { worldId: CRUCIBLE_WORLD_ID, userId: "u1" });
    const r2 = recordObserverDrift(db, { worldId: CRUCIBLE_WORLD_ID, userId: "u2" });
    assert.equal(r1.corpusSize, 1);
    assert.equal(r2.corpusSize, 2);
  });

  it("HONEST FAILURE: no observer present -> ok:false, no row written, never a fabricated success", () => {
    const before = db.prepare("SELECT COUNT(*) c FROM crucible_observer_drift_log").get().c;
    const result = recordObserverDrift(db, { worldId: CRUCIBLE_WORLD_ID, userId: "ghost-user" });
    assert.deepEqual(result, { ok: false, reason: "no_observer_present" });
    const after = db.prepare("SELECT COUNT(*) c FROM crucible_observer_drift_log").get().c;
    assert.equal(after, before, "no row should be written on honest failure");
  });

  it("HONEST FAILURE: departed visit does not count as present", () => {
    arriveInWorld(db, { userId: "u1", worldId: CRUCIBLE_WORLD_ID, departed: true });
    const result = recordObserverDrift(db, { worldId: CRUCIBLE_WORLD_ID, userId: "u1" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no_observer_present");
  });

  it("HONEST FAILURE: missing actor -> ok:false, never silently succeeds", () => {
    const result = recordObserverDrift(db, { worldId: CRUCIBLE_WORLD_ID, userId: undefined });
    assert.deepEqual(result, { ok: false, reason: "no_actor" });
  });

  it("SCOPING: does not fire for any world other than lattice-crucible, even with a present player", () => {
    arriveInWorld(db, { userId: "u1", worldId: "concordia-hub" });
    const result = recordObserverDrift(db, { worldId: "concordia-hub", userId: "u1" });
    assert.deepEqual(result, { ok: false, reason: "not_lattice_crucible" });

    const rows = db.prepare("SELECT COUNT(*) c FROM crucible_observer_drift_log").get().c;
    assert.equal(rows, 0, "no cross-world leakage into the crucible log table");
  });

  it("SCOPING: the underlying CHECK constraint rejects a direct insert for another world", () => {
    assert.throws(() => {
      db.prepare(`
        INSERT INTO crucible_observer_drift_log
          (id, world_id, observer_user_id, drift_type, severity, corpus_note, disclosed)
        VALUES ('x', 'concordia-hub', 'u1', 'goodhart', 'info', 'note', 0)
      `).run();
    }, /CHECK constraint failed/);
  });
});

describe("crucible-observer-drift: getOrlaCorpus", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });

  it("reports zero events honestly before anything has fired", () => {
    const corpus = getOrlaCorpus(db, { worldId: CRUCIBLE_WORLD_ID });
    assert.equal(corpus.ok, true);
    assert.equal(corpus.totalEvents, 0);
    assert.equal(corpus.disclosed, false);
    assert.equal(corpus.firstRecordedAt, null);
  });

  it("compiles an accurate breakdown by drift type as events accrue", () => {
    arriveInWorld(db, { userId: "u1", worldId: CRUCIBLE_WORLD_ID });
    const r1 = recordObserverDrift(db, { worldId: CRUCIBLE_WORLD_ID, userId: "u1" });
    arriveInWorld(db, { userId: "u2", worldId: CRUCIBLE_WORLD_ID });
    const r2 = recordObserverDrift(db, { worldId: CRUCIBLE_WORLD_ID, userId: "u2" });

    const corpus = getOrlaCorpus(db, { worldId: CRUCIBLE_WORLD_ID });
    assert.equal(corpus.ok, true);
    assert.equal(corpus.totalEvents, 2);
    const expectedTypes = new Set([r1.driftType, r2.driftType]);
    let sum = 0;
    for (const t of expectedTypes) {
      assert.ok(corpus.byDriftType[t] >= 1);
      sum += corpus.byDriftType[t];
    }
    assert.equal(sum, 2);
  });

  it("SCOPING: honest failure for a non-crucible world, never a fake empty success", () => {
    const corpus = getOrlaCorpus(db, { worldId: "concordia-hub" });
    assert.deepEqual(corpus, { ok: false, reason: "not_lattice_crucible" });
  });
});

describe("crucible-observer-drift: discloseCorpus", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });

  it("is never automatic — corpus stays undisclosed until explicitly released", () => {
    arriveInWorld(db, { userId: "u1", worldId: CRUCIBLE_WORLD_ID });
    recordObserverDrift(db, { worldId: CRUCIBLE_WORLD_ID, userId: "u1" });
    const before = getOrlaCorpus(db, { worldId: CRUCIBLE_WORLD_ID });
    assert.equal(before.disclosed, false);
  });

  it("flips disclosed for all recorded events on explicit release", () => {
    arriveInWorld(db, { userId: "u1", worldId: CRUCIBLE_WORLD_ID });
    recordObserverDrift(db, { worldId: CRUCIBLE_WORLD_ID, userId: "u1" });
    recordObserverDrift(db, { worldId: CRUCIBLE_WORLD_ID, userId: "u1" });

    const result = discloseCorpus(db, { worldId: CRUCIBLE_WORLD_ID });
    assert.equal(result.ok, true);
    assert.equal(result.disclosedCount, 2);

    const after = getOrlaCorpus(db, { worldId: CRUCIBLE_WORLD_ID });
    assert.equal(after.disclosed, true);
  });

  it("SCOPING: honest failure for a non-crucible world", () => {
    const result = discloseCorpus(db, { worldId: "concordia-hub" });
    assert.deepEqual(result, { ok: false, reason: "not_lattice_crucible" });
  });
});
