// Wave 0 — the connective chain + DPW labor. Pins: completeBond delivers the
// build capital to the realm treasury (the realm's first real INFLOW), and an
// in-house (DPW) bond consumes less than a contract bond → larger spillover.
//
// Run: node --test tests/civic-bonds-chain.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { creditSparks } from "../lib/sparks-service.js";
import { createBond, openBondForVoting, voteBond, pledgeToBond, fundBond, completeBond } from "../lib/civic-bonds.js";

function mkRealm(db, id, treasury = 1000) {
  db.prepare(`INSERT INTO realms (id, name, world_id, treasury) VALUES (?,?,?,?)`).run(id, id, "w1", treasury);
}
function mkUser(db, id, sparks) {
  db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,'x',?)`)
    .run(id, id, `${id}@t.local`, new Date().toISOString());
  creditSparks(db, { holderKind: "player", holderId: id, amount: sparks, reason: "seed" });
}
function runToFunded(db, bondId) {
  openBondForVoting(db, bondId);
  voteBond(db, bondId, "v1", "for"); voteBond(db, bondId, "v2", "for");
  for (let i = 0; i < 22; i++) { mkUser(db, `${bondId}_p${i}`, 1000); pledgeToBond(db, bondId, { entityId: `${bondId}_p${i}`, amount: 500 }); }
  assert.equal(fundBond(db, bondId).ok, true);
}

describe("civic-bonds chain + DPW", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("delivers build capital to the realm treasury on completion", () => {
    mkRealm(db, "r1", 1000);
    const r = createBond(db, { worldId: "w1", realmId: "r1", title: "Bridge", targetAmount: 10000, denomination: 100, quorum: 2 });
    runToFunded(db, r.bondId);
    const done = completeBond(db, r.bondId);
    assert.equal(done.ok, true);
    // contract labor → full target delivered to treasury
    assert.equal(done.deliveredToTreasury, 10000);
    const treasury = db.prepare(`SELECT treasury FROM realms WHERE id='r1'`).get().treasury;
    assert.equal(treasury, 11000); // 1000 seed + 10000 delivered (the realm finally COLLECTED)
  });

  it("in-house (DPW) costs less → more spillover than contract", () => {
    mkRealm(db, "rc"); mkRealm(db, "rh");
    const c = createBond(db, { worldId: "w1", realmId: "rc", title: "Contract", targetAmount: 10000, denomination: 100, quorum: 2, laborSource: "contract" });
    const h = createBond(db, { worldId: "w1", realmId: "rh", title: "InHouse", targetAmount: 10000, denomination: 100, quorum: 2, laborSource: "in_house" });
    runToFunded(db, c.bondId); runToFunded(db, h.bondId);
    const contract = completeBond(db, c.bondId);
    const inHouse = completeBond(db, h.bondId);
    // in-house consumed 8500 vs 10000 → ~1500 more spillover
    assert.ok(inHouse.spillover > contract.spillover);
    assert.equal(inHouse.deliveredToTreasury, 8500);
  });
});
