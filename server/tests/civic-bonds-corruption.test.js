// Wave 0 — the corruption duality. Pins: raiding a bond's escrow diverts it to
// the treasury BUT collapses the realm's legitimacy and raises the ruler's
// refusal_debt (the world punishes it via systems that already exist). The
// honest path (complete) never triggers any of that.
//
// Run: node --test tests/civic-bonds-corruption.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { creditSparks } from "../lib/sparks-service.js";
import { createBond, openBondForVoting, voteBond, pledgeToBond, fundBond, raidBondEscrow, CIVIC_RAID_LEGITIMACY_HIT } from "../lib/civic-bonds.js";

function mkUser(db, id, sparks) {
  db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,'x',?)`)
    .run(id, id, `${id}@t.local`, new Date().toISOString());
  if (sparks) creditSparks(db, { holderKind: "player", holderId: id, amount: sparks, reason: "seed" });
}

describe("civic-bonds corruption duality", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("raiding escrow gains treasury but collapses legitimacy + raises refusal_debt", () => {
    db.prepare(`INSERT INTO realms (id, name, world_id, treasury, legitimacy, ruler_kind, ruler_id) VALUES ('r1','R','w1',1000,60,'player','king')`).run();
    mkUser(db, "king");
    db.prepare(`INSERT INTO player_world_metrics (user_id, world_id, refusal_debt) VALUES ('king', 'w1', 0.2)`).run();

    const r = createBond(db, { worldId: "w1", realmId: "r1", proposerId: "king", title: "Vanity", targetAmount: 10000, denomination: 100, quorum: 2 });
    openBondForVoting(db, r.bondId);
    voteBond(db, r.bondId, "v1", "for"); voteBond(db, r.bondId, "v2", "for");
    for (let i = 0; i < 22; i++) { mkUser(db, `p${i}`, 1000); pledgeToBond(db, r.bondId, { entityId: `p${i}`, amount: 500 }); }
    fundBond(db, r.bondId);

    const before = db.prepare(`SELECT treasury, legitimacy FROM realms WHERE id='r1'`).get();
    const raid = raidBondEscrow(db, r.bondId, "king");
    assert.equal(raid.ok, true);
    assert.equal(raid.corrupt, true);

    const after = db.prepare(`SELECT treasury, legitimacy FROM realms WHERE id='r1'`).get();
    assert.equal(after.treasury, before.treasury + raid.looted); // the theft landed
    assert.equal(after.legitimacy, before.legitimacy - CIVIC_RAID_LEGITIMACY_HIT); // and it cost him
    const debt = db.prepare(`SELECT refusal_debt FROM player_world_metrics WHERE user_id='king'`).get().refusal_debt;
    assert.ok(debt > 0.2); // refusal_debt rose
    assert.equal(db.prepare(`SELECT status FROM civic_bonds WHERE id=?`).get(r.bondId).status, "cancelled");
  });

  it("can't raid a terminal bond", () => {
    const r = createBond(db, { worldId: "w1", realmId: "r1", title: "X", targetAmount: 10000, denomination: 100, quorum: 2 });
    const raid = raidBondEscrow(db, r.bondId, "king"); // proposed, current_pledged 0
    assert.equal(raid.ok, false);
    assert.equal(raid.reason, "nothing_to_raid");
  });
});
