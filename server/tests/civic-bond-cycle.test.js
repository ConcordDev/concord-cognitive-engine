// Wave 0 — civic-bond-cycle auto-pause sweep. Pins: a stalled (overdue +
// underfunded) drive is paused; a fresh or funded drive is not; the heartbeat
// never throws and no-ops when the kill-switch is off.
//
// Run: node --test tests/civic-bond-cycle.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createBond, openBondForVoting, sweepStalledBonds, getBond } from "../lib/civic-bonds.js";
import { runCivicBondCycle } from "../emergent/civic-bond-cycle.js";

function fundingBond(db, createdAtSec) {
  const r = createBond(db, { worldId: "w1", title: "Slow Drive", targetAmount: 10000, denomination: 100, quorum: 2 });
  openBondForVoting(db, r.bondId);
  // force into 'funding' with an old created_at + small pledge (underfunded)
  db.prepare(`UPDATE civic_bonds SET status='funding', current_pledged=100, created_at=? WHERE id=?`).run(createdAtSec, r.bondId);
  return r.bondId;
}

describe("civic-bond-cycle auto-pause", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { delete process.env.CONCORD_CIVIC_BONDS; try { db.close(); } catch { /* noop */ } });

  it("pauses an overdue, underfunded drive", () => {
    const old = Math.floor(Date.now() / 1000) - 8 * 24 * 3600; // 8 days ago (> 7d deadline)
    const id = fundingBond(db, old);
    const r = sweepStalledBonds(db, {});
    assert.equal(r.paused, 1);
    assert.equal(getBond(db, id).bond.status, "paused");
  });

  it("leaves a fresh drive alone", () => {
    const recent = Math.floor(Date.now() / 1000) - 3600; // 1h ago
    const id = fundingBond(db, recent);
    assert.equal(sweepStalledBonds(db, {}).paused, 0);
    assert.equal(getBond(db, id).bond.status, "funding");
  });

  it("heartbeat no-ops when the kill-switch is off; never throws", async () => {
    const old = Math.floor(Date.now() / 1000) - 8 * 24 * 3600;
    const id = fundingBond(db, old);
    process.env.CONCORD_CIVIC_BONDS = "0";
    const off = await runCivicBondCycle({ db });
    assert.equal(off.reason, "disabled");
    assert.equal(getBond(db, id).bond.status, "funding"); // untouched while off

    process.env.CONCORD_CIVIC_BONDS = "1";
    const on = await runCivicBondCycle({ db });
    assert.equal(on.ok, true);
    assert.equal(on.paused, 1);
    // never-throws on a bad db
    assert.equal((await runCivicBondCycle({})).ok, false);
  });
});
