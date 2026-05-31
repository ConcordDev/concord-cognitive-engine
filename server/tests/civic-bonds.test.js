// Wave 0 — Civic Bonds lifecycle. Pins the headline contract: the 110% gate
// (rejects 105%, accepts 110%), the 5% single-entity cap, sparks escrow→return
// round-trip, spillover residue, and failBond full-refund. All money is sparks.
//
// Run: node --test tests/civic-bonds.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { creditSparks, getSparks } from "../lib/sparks-service.js";
import {
  createBond, openBondForVoting, voteBond, checkQuorum, pledgeToBond,
  fundBond, completeBond, failBond, getSpillover, getBond,
} from "../lib/civic-bonds.js";

function mkUser(db, id, sparks = 0) {
  db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,'x',?)`)
    .run(id, id, `${id}@t.local`, new Date().toISOString());
  if (sparks) creditSparks(db, { holderKind: "player", holderId: id, amount: sparks, reason: "seed" });
}

// target 10000 → 5% cap = 500 (>= denomination 100, so a 500 pledge is legal).
// tiny quorum so two test votes approve.
function freshBond(db, target = 10000) {
  const r = createBond(db, { worldId: "w1", realmId: "r1", title: "Ember Bridge", targetAmount: target, denomination: 100, quorum: 2 });
  openBondForVoting(db, r.bondId);
  voteBond(db, r.bondId, "v1", "for");
  voteBond(db, r.bondId, "v2", "for");
  return r.bondId;
}

describe("civic-bonds lifecycle", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("votes reach quorum + approval", () => {
    const id = freshBond(db);
    const q = checkQuorum(db, id);
    assert.equal(q.quorumMet, true);
    assert.equal(q.approved, true);
  });

  it("enforces the 5% single-entity cap + denomination", () => {
    const id = freshBond(db, 10000); // cap = 500
    mkUser(db, "whale", 100000);
    const over = pledgeToBond(db, id, { entityId: "whale", amount: 600 }); // 600 > 500 cap
    assert.equal(over.ok, false);
    assert.equal(over.reason, "exceeds_single_entity_cap");
    const bad = pledgeToBond(db, id, { entityId: "whale", amount: 30 }); // not a multiple of 100
    assert.equal(bad.reason, "bad_denomination");
  });

  it("the 110% gate rejects 105% and accepts 110%", () => {
    // target 10000 → need 11000 to fund. cap 500/pledger → 22 pledgers of 500.
    const id = freshBond(db, 10000);
    for (let i = 0; i < 21; i++) { mkUser(db, `p${i}`, 1000); pledgeToBond(db, id, { entityId: `p${i}`, amount: 500 }); }
    const r1 = fundBond(db, id); // 21×500 = 10500 (105%)
    assert.equal(r1.ok, false);
    assert.equal(r1.reason, "funding_gate_not_met");
    mkUser(db, "p21", 1000); pledgeToBond(db, id, { entityId: "p21", amount: 500 }); // → 11000
    const r2 = fundBond(db, id);
    assert.equal(r2.ok, true);
    assert.equal(getBond(db, id).bond.status, "active");
  });

  it("sparks escrow→return round-trip + spillover residue on completion", () => {
    const id = freshBond(db, 10000);
    for (let i = 0; i < 22; i++) { mkUser(db, `c${i}`, 1000); pledgeToBond(db, id, { entityId: `c${i}`, amount: 500 }); }
    assert.equal(getSparks(db, "player", "c0"), 500); // 1000 seed − 500 escrowed
    assert.equal(fundBond(db, id).ok, true);
    const done = completeBond(db, id);
    assert.equal(done.ok, true);
    // return_rate 0.005 × 500 = 2.5 → floor 2 per pledger → returns paid
    assert.ok(done.returnsPaid > 0);
    assert.equal(getSparks(db, "player", "c0"), 502); // got the +2 capped return back
    // residue = pledged(11000) − target(10000) − returns → spillover > 0
    assert.ok(done.spillover > 0);
    assert.equal(getSpillover(db, "city", "w1"), done.spillover);
    assert.equal(getBond(db, id).bond.status, "completed");
  });

  it("failBond refunds every escrowed pledge in full", () => {
    const id = freshBond(db, 10000);
    mkUser(db, "a", 1000); mkUser(db, "b", 1000);
    pledgeToBond(db, id, { entityId: "a", amount: 500 });
    pledgeToBond(db, id, { entityId: "b", amount: 500 });
    assert.equal(getSparks(db, "player", "a"), 500);
    const f = failBond(db, id);
    assert.equal(f.ok, true);
    assert.equal(f.refunded, 1000);
    assert.equal(getSparks(db, "player", "a"), 1000); // fully refunded
    assert.equal(getSparks(db, "player", "b"), 1000);
  });
});
