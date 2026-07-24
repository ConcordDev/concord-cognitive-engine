// server/tests/handshake-protocol.test.js
//
// Contract tests for lib/handshake-protocol.js — the concord-link-frontier
// bespoke mechanic ("the Handshake Protocol", grounded in that world's own
// authored lore — see the lib file's header for the citations).
//
// Pins:
//   - Frontier-exclusive: only a fromWorld of 'concord-link-frontier' may
//     witness a Handshake.
//   - a Handshake WITNESSES an existing relationship, never creates one.
//   - honest failure states — no DB write (no trust_marks debited, no
//     resonance moved) on any rejection path.
//   - the real effect: resonance_strength moves by exactly the computed
//     point amount, kind flips to 'contracted', trust_marks are debited
//     FIFO across inventory slots.
//   - the cap: MAX_BOOST_PER_CALL and the 100-point ceiling both bound a
//     single call, matching "the Protocol does not solve the rivalry."
//
// Run: node --test server/tests/handshake-protocol.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../migrate.js";
import { witnessHandshake, getTrustMarksBalance, HANDSHAKE_CONSTANTS } from "../lib/handshake-protocol.js";

const FRONTIER = HANDSHAKE_CONSTANTS.FRONTIER_WORLD_ID;

async function setupDb() {
  const db = new Database(":memory:");
  await runMigrations(db);
  return db;
}

function grantTrustMarks(db, userId, qty, { acquiredAt = 1000 } = {}) {
  db.prepare(`
    INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, acquired_at)
    VALUES (?, ?, 'material', 'trust_marks', 'Trust Marks', ?, ?)
  `).run(`inv_${userId}_${Math.random()}`, userId, qty, acquiredAt);
}

function seedRelation(db, { fromWorld = FRONTIER, fromNpcId = "npc_a", toWorld = "tunya", toNpcId = "npc_b", strength = 50, kind = "correspondent" } = {}) {
  db.prepare(`
    INSERT INTO cross_npc_relationships
      (from_world_id, from_npc_id, to_world_id, to_npc_id, kind, resonance_strength, established_via)
    VALUES (?, ?, ?, ?, ?, ?, 'test_seed')
  `).run(fromWorld, fromNpcId, toWorld, toNpcId, kind, strength);
}

describe("handshake-protocol: witnessHandshake — honest failure paths", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });

  it("missing_inputs when required fields are absent", () => {
    const r = witnessHandshake(db, { userId: "u1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("not_frontier_scoped — a call from any other world is rejected before touching the DB", () => {
    grantTrustMarks(db, "u1", 100);
    seedRelation(db, { fromWorld: "tunya", toWorld: FRONTIER });
    const r = witnessHandshake(db, {
      userId: "u1", fromWorld: "tunya", fromNpcId: "npc_a", toWorld: FRONTIER, toNpcId: "npc_b",
      trustMarksToSpend: 50,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_frontier_scoped");

    const bal = getTrustMarksBalance(db, "u1");
    assert.equal(bal, 100, "trust_marks must be untouched on a rejected call");
  });

  it("no_relationship — a Handshake witnesses an existing edge, never creates one", () => {
    grantTrustMarks(db, "u1", 100);
    const r = witnessHandshake(db, {
      userId: "u1", fromWorld: FRONTIER, fromNpcId: "npc_ghost", toWorld: "tunya", toNpcId: "npc_b",
      trustMarksToSpend: 50,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_relationship");

    const row = db.prepare(`SELECT * FROM cross_npc_relationships WHERE from_npc_id = 'npc_ghost'`).get();
    assert.equal(row, undefined, "no relationship row must be fabricated");
  });

  it("insufficient_trust_marks — real balance check before any write", () => {
    grantTrustMarks(db, "u1", 5); // affords only 1 point at 5-per-point, but let's ask for more than balance allows
    seedRelation(db, { strength: 50 });
    const r = witnessHandshake(db, {
      userId: "u1", fromWorld: FRONTIER, fromNpcId: "npc_a", toWorld: "tunya", toNpcId: "npc_b",
      trustMarksToSpend: 1000,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "insufficient_trust_marks");
    assert.equal(r.available, 5);

    const rel = db.prepare(`SELECT * FROM cross_npc_relationships WHERE from_npc_id = 'npc_a'`).get();
    assert.equal(rel.resonance_strength, 50, "resonance must be untouched on a rejected call");
    assert.equal(getTrustMarksBalance(db, "u1"), 5, "trust_marks must be untouched on a rejected call");
  });

  it("already_at_cap — a relationship already at 100 resonance cannot be boosted further", () => {
    grantTrustMarks(db, "u1", 1000);
    seedRelation(db, { strength: 100 });
    const r = witnessHandshake(db, {
      userId: "u1", fromWorld: FRONTIER, fromNpcId: "npc_a", toWorld: "tunya", toNpcId: "npc_b",
      trustMarksToSpend: 100,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "already_at_cap");
  });

  it("spend_too_small — a spend below one trust-mark-per-point unit affords zero points", () => {
    grantTrustMarks(db, "u1", 100);
    seedRelation(db, { strength: 50 });
    const r = witnessHandshake(db, {
      userId: "u1", fromWorld: FRONTIER, fromNpcId: "npc_a", toWorld: "tunya", toNpcId: "npc_b",
      trustMarksToSpend: 2, // TRUST_MARKS_PER_POINT is 5 — 2 affords 0 whole points
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "spend_too_small");
  });
});

describe("handshake-protocol: witnessHandshake — real effect", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });

  it("moves resonance_strength by the real computed point amount and upgrades kind to 'contracted'", () => {
    grantTrustMarks(db, "u1", 100);
    seedRelation(db, { strength: 50 });

    const r = witnessHandshake(db, {
      userId: "u1", fromWorld: FRONTIER, fromNpcId: "npc_a", toWorld: "tunya", toNpcId: "npc_b",
      trustMarksToSpend: 50, // affords 10 points at 5-per-point
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.pointsGained, 10);
    assert.equal(r.cost, 50);
    assert.equal(r.newStrength, 60);
    assert.equal(r.kind, "contracted");

    const rel = db.prepare(`SELECT * FROM cross_npc_relationships WHERE from_npc_id = 'npc_a'`).get();
    assert.equal(rel.resonance_strength, 60, "real DB row must reflect the new strength, not just the return value");
    assert.equal(rel.kind, "contracted");
    assert.equal(rel.established_via, "handshake_witnessed");

    assert.equal(getTrustMarksBalance(db, "u1"), 50, "trust_marks must be genuinely debited");
  });

  it("caps a single call's boost at MAX_BOOST_PER_CALL even with plenty of trust_marks and headroom", () => {
    grantTrustMarks(db, "u1", 10000);
    seedRelation(db, { strength: 0 });

    const r = witnessHandshake(db, {
      userId: "u1", fromWorld: FRONTIER, fromNpcId: "npc_a", toWorld: "tunya", toNpcId: "npc_b",
      trustMarksToSpend: 10000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.pointsGained, HANDSHAKE_CONSTANTS.MAX_BOOST_PER_CALL, "a single Handshake session cannot fully resolve a rivalry");
    assert.equal(r.cost, HANDSHAKE_CONSTANTS.MAX_BOOST_PER_CALL * HANDSHAKE_CONSTANTS.TRUST_MARKS_PER_POINT);
  });

  it("caps the boost at the real headroom to 100 when near the ceiling", () => {
    grantTrustMarks(db, "u1", 10000);
    seedRelation(db, { strength: 95 }); // only 5 points of headroom, well under MAX_BOOST_PER_CALL

    const r = witnessHandshake(db, {
      userId: "u1", fromWorld: FRONTIER, fromNpcId: "npc_a", toWorld: "tunya", toNpcId: "npc_b",
      trustMarksToSpend: 10000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.pointsGained, 5);
    assert.equal(r.newStrength, 100);
  });

  it("debits a partial consumption correctly (decrements quantity, row survives)", () => {
    grantTrustMarks(db, "u1", 20, { acquiredAt: 1000 });
    seedRelation(db, { strength: 0 });

    const r = witnessHandshake(db, {
      userId: "u1", fromWorld: FRONTIER, fromNpcId: "npc_a", toWorld: "tunya", toNpcId: "npc_b",
      trustMarksToSpend: 15, // 3 points at 5-per-point = 15 cost
    });
    assert.equal(r.ok, true);
    assert.equal(r.cost, 15);
    assert.equal(getTrustMarksBalance(db, "u1"), 5, "20 - 15 = 5 remaining");

    const row = db.prepare(`SELECT quantity FROM player_inventory WHERE user_id = 'u1' AND item_id = 'trust_marks'`).get();
    assert.equal(row.quantity, 5, "the row must survive a partial consumption with its quantity decremented");
  });

  it("deletes the inventory row entirely on a full consumption (row_id, item_id) — never leaves a zero-quantity ghost row", () => {
    grantTrustMarks(db, "u1", 15, { acquiredAt: 1000 });
    seedRelation(db, { strength: 0 });

    const r = witnessHandshake(db, {
      userId: "u1", fromWorld: FRONTIER, fromNpcId: "npc_a", toWorld: "tunya", toNpcId: "npc_b",
      trustMarksToSpend: 15, // exactly consumes the whole slot
    });
    assert.equal(r.ok, true);
    assert.equal(r.cost, 15);
    assert.equal(getTrustMarksBalance(db, "u1"), 0);

    const row = db.prepare(`SELECT * FROM player_inventory WHERE user_id = 'u1' AND item_id = 'trust_marks'`).get();
    assert.equal(row, undefined, "a fully-consumed slot must be deleted, never left as a zero-quantity ghost row");
  });

  it("never leaks the mechanic to a same-world call", () => {
    grantTrustMarks(db, "u1", 100);
    const r = witnessHandshake(db, {
      userId: "u1", fromWorld: FRONTIER, fromNpcId: "npc_a", toWorld: FRONTIER, toNpcId: "npc_b",
      trustMarksToSpend: 50,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "same_world");
  });
});
