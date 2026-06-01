// Sere extraction-by-rescue — the Mercy Fund bailout that transfers the asset.
// Pins: a rescue tops up the treasury + records the lien; repayment clears it;
// default transfers the collateral building to the creditor (Pell's tea-house →
// the Mercy Fund); the due-sweep + crisis-offer cycle; Sere-scoping; OFF no-op.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upLoans } from "../migrations/322_extraction_loans.js";
import {
  offerRescue, repayLoan, defaultLoan, sweepDueLoans, offerRescuesForCrises, activeLoans, _testing,
} from "../lib/extraction-loans.js";
import { runMercyFundCycle } from "../emergent/mercy-fund-cycle.js";

function freshDb() {
  const db = new Database(":memory:");
  // Minimal slices of the tables the lib reads (the real migrations 158/063 carry
  // cross-deps not relevant here).
  db.exec(`
    CREATE TABLE realms (id TEXT PRIMARY KEY, world_id TEXT, treasury INTEGER DEFAULT 1000);
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, owner_type TEXT, owner_id TEXT);
  `);
  upLoans(db);
  // A crisis realm in Sere + a control realm in another world.
  db.prepare("INSERT INTO realms (id, world_id, treasury) VALUES ('keshar_realm','sere',100)").run();
  db.prepare("INSERT INTO realms (id, world_id, treasury) VALUES ('other_realm','tunya',50)").run();
  // Pell's tea-house: a building owned by the NPC.
  db.prepare("INSERT INTO world_buildings (id, world_id, building_type, owner_type, owner_id) VALUES ('teahouse_pell','sere','inn','npc','pell_of_keshar')").run();
  return db;
}
const treasury = (db, id) => db.prepare("SELECT treasury FROM realms WHERE id=?").get(id).treasury;
const owner = (db, id) => db.prepare("SELECT owner_id FROM world_buildings WHERE id=?").get(id).owner_id;

describe("extraction-by-rescue (ON)", () => {
  beforeEach(() => { process.env.CONCORD_MERCY_FUND = "1"; });
  afterEach(() => { delete process.env.CONCORD_MERCY_FUND; });

  it("a rescue tops up the treasury now and records the lien", () => {
    const db = freshDb();
    const r = offerRescue(db, { worldId: "sere", realmId: "keshar_realm", collateralBuildingId: "teahouse_pell" });
    assert.equal(r.ok, true);
    assert.equal(treasury(db, "keshar_realm"), 100 + _testing.RESCUE_AMOUNT, "the gratitude of the drowning");
    assert.equal(activeLoans(db, "sere").length, 1);
  });

  it("default transfers the collateral to the creditor (Pell's tea-house → the Mercy Fund)", () => {
    const db = freshDb();
    const r = offerRescue(db, { worldId: "sere", realmId: "keshar_realm", creditorId: "the_mercy_fund", collateralBuildingId: "teahouse_pell" });
    assert.equal(owner(db, "teahouse_pell"), "pell_of_keshar");
    const d = defaultLoan(db, r.loanId);
    assert.equal(d.ok, true);
    assert.equal(d.transferred, "teahouse_pell");
    assert.equal(owner(db, "teahouse_pell"), "the_mercy_fund", "the asset that was worth rescuing");
  });

  it("repayment clears the lien (the realm that reads the conditions)", () => {
    const db = freshDb();
    const r = offerRescue(db, { worldId: "sere", realmId: "keshar_realm", collateralBuildingId: "teahouse_pell" });
    assert.equal(repayLoan(db, r.loanId).ok, true);
    assert.equal(activeLoans(db, "sere").length, 0);
    assert.equal(owner(db, "teahouse_pell"), "pell_of_keshar", "asset kept");
  });

  it("the cycle offers to Sere crises + sweeps overdue loans (Sere-scoped)", async () => {
    const db = freshDb();
    const c = await runMercyFundCycle({ db });
    assert.equal(c.ok, true);
    assert.equal(c.offered, 1, "the Sere crisis realm got an offer");
    // the tunya control realm (treasury 50, also < threshold) must NOT be touched
    assert.equal(activeLoans(db).filter((l) => l.world_id === "tunya").length, 0, "other worlds untouched");
    // force the loan overdue + sweep → default
    db.prepare("UPDATE extraction_loans SET due_at = 1 WHERE world_id='sere'").run();
    const swept = sweepDueLoans(db, { worldId: "sere" });
    assert.ok(swept.defaulted.length >= 1);
  });
});

describe("extraction-by-rescue (OFF kill-switch)", () => {
  beforeEach(() => { process.env.CONCORD_MERCY_FUND = "0"; });
  afterEach(() => { delete process.env.CONCORD_MERCY_FUND; });
  it("offers nothing and the cycle is inert", async () => {
    const db = freshDb();
    assert.equal(offerRescue(db, { worldId: "sere", realmId: "keshar_realm" }).reason, "disabled");
    assert.equal((await runMercyFundCycle({ db })).reason, "disabled");
    assert.equal(treasury(db, "keshar_realm"), 100, "no rescue applied");
  });
});
