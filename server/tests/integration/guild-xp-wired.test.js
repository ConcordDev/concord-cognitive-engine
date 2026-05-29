/**
 * Sprint 1 (Connection) — guild progression revived.
 *
 * awardOrgXp had zero non-test callers — guild leveling literally could not
 * earn a point. It's now called by real guild activity:
 *   - treasury deposit (5 XP/item, capped 100)
 *   - claiming a guild hall (200 XP)
 * Pins that XP accrues + a guild levels up at the quadratic curve (100·L²).
 *
 * Run: node --test tests/integration/guild-xp-wired.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up238 } from "../../migrations/238_guild_substrate.js";
import {
  awardOrgXp, getOrgProgression, depositToOrgInventory, claimHallBuilding,
} from "../../lib/guild-substrate.js";

function freshDb() {
  const db = new Database(":memory:");
  up238(db);
  db.exec(`CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, owner_type TEXT, owner_id TEXT);`);
  return db;
}

describe("Sprint 1 — guild XP accrues", () => {
  it("awardOrgXp raises xp and levels up past the curve (100·L²)", () => {
    const db = freshDb();
    let r = awardOrgXp(db, "guild-1", 50, "test");
    assert.equal(r.ok, true);
    assert.equal(r.newLevel, 1);
    r = awardOrgXp(db, "guild-1", 60, "test"); // total 110 ≥ 100 → level 2
    assert.equal(r.newLevel, 2);
    assert.equal(r.leveledUp, true);
    assert.equal(getOrgProgression(db, "guild-1").org_level, 2);
    db.close();
  });

  it("treasury deposit awards org XP (capped per deposit)", () => {
    const db = freshDb();
    const r = depositToOrgInventory(db, "u1", "guild-1", {
      itemDescriptor: "iron_ingot", quantity: 10, itemKind: "inventory",
    });
    assert.equal(r.ok, true);
    assert.equal(r.orgXp, 50); // 10 items × 5
    // a huge stack is capped at 100 XP
    const big = depositToOrgInventory(db, "u1", "guild-1", {
      itemDescriptor: "gold_bar", quantity: 1000, itemKind: "inventory",
    });
    assert.equal(big.orgXp, 150); // 50 + min(100, 5000)
    db.close();
  });

  it("claiming a hall awards 200 XP (a level-up)", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO world_buildings (id, world_id, owner_type, owner_id) VALUES ('hall1','w1','none',null)`).run();
    const r = claimHallBuilding(db, "leader", "guild-2", "hall1", { isLeader: () => true });
    assert.equal(r.ok, true);
    assert.equal(r.orgLeveledUp, true); // 200 ≥ 100 → level 2
    assert.equal(getOrgProgression(db, "guild-2").org_level, 2);
    db.close();
  });
});
