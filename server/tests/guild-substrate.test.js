// Phase BC1 — guild substrate tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  awardOrgXp, getOrgProgression,
  depositToOrgInventory, withdrawFromOrgInventory,
  listOrgInventory, getOrgInventoryLog,
  claimHallBuilding,
  DEFAULT_XP_CURVE,
} from "../lib/guild-substrate.js";
import { up as upGuild } from "../migrations/238_guild_substrate.js";

function freshDb() {
  const db = new Database(":memory:");
  // Minimal world_buildings stub for the hall-claim path.
  db.exec(`
    CREATE TABLE world_buildings (
      id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT,
      owner_type TEXT, owner_id TEXT
    );
  `);
  upGuild(db);
  return db;
}

const memberOf = (members) => (userId) => members.has(userId);
const officerOf = (officers) => (userId) => officers.has(userId);
const leaderOf = (id) => (userId) => userId === id;

describe("Phase BC1 — guild XP + level curve", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("awardOrgXp rolls up org_level when crossing the next threshold", () => {
    const a = awardOrgXp(db, "org-1", DEFAULT_XP_CURVE(1) - 1);
    assert.equal(a.newLevel, 1);
    const b = awardOrgXp(db, "org-1", 100);
    assert.ok(b.newLevel >= 2);
    assert.equal(b.leveledUp, true);
  });

  it("zero / negative XP is a no-op", () => {
    const a = awardOrgXp(db, "org-1", 0);
    assert.equal(a.awarded, 0);
    assert.equal(getOrgProgression(db, "org-1").org_xp, 0);
  });
});

describe("Phase BC1 — guild bank deposit/withdraw", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("deposit requires membership", () => {
    const members = new Set(["m1"]);
    const r = depositToOrgInventory(db, "stranger", "org-1", {
      itemDescriptor: "herb", quantity: 5, isMember: memberOf(members),
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_member");
  });

  it("deposit stacks on (org, descriptor) PK", () => {
    const members = new Set(["m1"]);
    depositToOrgInventory(db, "m1", "org-1", { itemDescriptor: "herb", quantity: 5, isMember: memberOf(members) });
    depositToOrgInventory(db, "m1", "org-1", { itemDescriptor: "herb", quantity: 7, isMember: memberOf(members) });
    const list = listOrgInventory(db, "org-1");
    assert.equal(list.length, 1);
    assert.equal(list[0].quantity, 12);
  });

  it("withdraw requires officer+", () => {
    const officers = new Set(["officer"]);
    const members = new Set(["m1", "officer"]);
    depositToOrgInventory(db, "m1", "org-1", { itemDescriptor: "herb", quantity: 10, isMember: memberOf(members) });
    const memberAttempt = withdrawFromOrgInventory(db, "m1", "org-1", {
      itemDescriptor: "herb", quantity: 3, isOfficer: officerOf(officers),
    });
    assert.equal(memberAttempt.ok, false);
    assert.equal(memberAttempt.error, "officer_required");
    const officerOk = withdrawFromOrgInventory(db, "officer", "org-1", {
      itemDescriptor: "herb", quantity: 3, isOfficer: officerOf(officers),
    });
    assert.equal(officerOk.ok, true);
    assert.equal(officerOk.remaining, 7);
  });

  it("withdraw insufficient is rejected; balance unchanged", () => {
    const officers = new Set(["o"]); const members = new Set(["m", "o"]);
    depositToOrgInventory(db, "m", "org-1", { itemDescriptor: "herb", quantity: 5, isMember: memberOf(members) });
    const r = withdrawFromOrgInventory(db, "o", "org-1", {
      itemDescriptor: "herb", quantity: 10, isOfficer: officerOf(officers),
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient");
    assert.equal(listOrgInventory(db, "org-1")[0].quantity, 5);
  });

  it("withdraw down to zero deletes the row (clean state)", () => {
    const officers = new Set(["o"]); const members = new Set(["o"]);
    depositToOrgInventory(db, "o", "org-1", { itemDescriptor: "herb", quantity: 5, isMember: memberOf(members) });
    const r = withdrawFromOrgInventory(db, "o", "org-1", {
      itemDescriptor: "herb", quantity: 5, isOfficer: officerOf(officers),
    });
    assert.equal(r.ok, true);
    assert.equal(listOrgInventory(db, "org-1").length, 0);
  });

  it("inventory log captures deposit + withdraw", () => {
    const officers = new Set(["o"]); const members = new Set(["o"]);
    depositToOrgInventory(db, "o", "org-1", { itemDescriptor: "herb", quantity: 5, isMember: memberOf(members) });
    withdrawFromOrgInventory(db, "o", "org-1", { itemDescriptor: "herb", quantity: 2, isOfficer: officerOf(officers) });
    const log = getOrgInventoryLog(db, "org-1");
    assert.equal(log.length, 2);
    assert.ok(log.some(l => l.action === "deposit" && l.quantity === 5));
    assert.ok(log.some(l => l.action === "withdraw" && l.quantity === 2));
  });
});

describe("Phase BC1 — guild hall claim", () => {
  let db;
  beforeEach(() => {
    db = freshDb();
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, owner_type) VALUES ('b-1', 'tunya', 'tower', 'world')`).run();
  });

  it("leader claim transfers building ownership to org", () => {
    const r = claimHallBuilding(db, "leader", "org-1", "b-1", { isLeader: leaderOf("leader") });
    assert.equal(r.ok, true);
    const b = db.prepare(`SELECT owner_type, owner_id FROM world_buildings WHERE id = ?`).get("b-1");
    assert.equal(b.owner_type, "org");
    assert.equal(b.owner_id, "org-1");
    const prog = getOrgProgression(db, "org-1");
    assert.equal(prog.hall_building_id, "b-1");
  });

  it("non-leader claim is rejected", () => {
    const r = claimHallBuilding(db, "officer", "org-1", "b-1", { isLeader: leaderOf("leader") });
    assert.equal(r.ok, false);
    assert.equal(r.error, "leader_only");
  });

  it("re-claim by leader is idempotent", () => {
    claimHallBuilding(db, "leader", "org-1", "b-1", { isLeader: leaderOf("leader") });
    const r = claimHallBuilding(db, "leader", "org-1", "b-1", { isLeader: leaderOf("leader") });
    assert.equal(r.ok, true);
  });
});
