// G1 — tiered crafting stations. Pins the building_type -> craft-quality lookup
// (world-scoped, damage-degraded, collapsed=0, kill-switched) AND that a higher
// station actually raises output potency through the existing resolveCraft term.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { stationQualityFor, STATION_TIERS } from "../lib/crafting/station-tiers.js";
import { resolveCraft } from "../lib/craft-resolve.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, health_pct REAL DEFAULT 1.0)`);
  db.prepare("INSERT INTO world_buildings (id, world_id, building_type, health_pct) VALUES ('forge1','sere','forge',1.0)").run();
  db.prepare("INSERT INTO world_buildings (id, world_id, building_type, health_pct) VALUES ('ench1','sere','enchanter',1.0)").run();
  db.prepare("INSERT INTO world_buildings (id, world_id, building_type, health_pct) VALUES ('house1','sere','house',1.0)").run();
  db.prepare("INSERT INTO world_buildings (id, world_id, building_type, health_pct) VALUES ('forgeD','sere','forge',0.5)").run();
  db.prepare("INSERT INTO world_buildings (id, world_id, building_type, health_pct) VALUES ('forgeC','sere','forge',0.0)").run();
  return db;
}

describe("station tiers (G1)", () => {
  beforeEach(() => { process.env.CONCORD_CRAFT_STATIONS = "1"; });
  afterEach(() => { delete process.env.CONCORD_CRAFT_STATIONS; });

  it("maps building_type to its craft quality", () => {
    const db = freshDb();
    assert.equal(stationQualityFor(db, "sere", "forge1"), STATION_TIERS.forge);
    assert.equal(stationQualityFor(db, "sere", "ench1"), STATION_TIERS.enchanter);
    assert.equal(stationQualityFor(db, "sere", "house1"), 0, "a house is not a crafting station");
  });

  it("is world-scoped and handles missing/empty buildingId", () => {
    const db = freshDb();
    assert.equal(stationQualityFor(db, "tunya", "forge1"), 0, "wrong world");
    assert.equal(stationQualityFor(db, "sere", null), 0);
    assert.equal(stationQualityFor(db, "sere", "nope"), 0);
  });

  it("degrades a damaged station and zeroes a collapsed one", () => {
    const db = freshDb();
    assert.equal(stationQualityFor(db, "sere", "forgeD"), Math.round(STATION_TIERS.forge * 0.5));
    assert.equal(stationQualityFor(db, "sere", "forgeC"), 0, "collapsed station can't craft at tier");
  });

  it("the kill-switch falls back to hand-craft (0)", () => {
    const db = freshDb();
    process.env.CONCORD_CRAFT_STATIONS = "0";
    assert.equal(stationQualityFor(db, "sere", "forge1"), 0);
  });

  it("a higher station yields higher output potency from the same inputs", () => {
    // resolveCraft resolves properties from the catalog by itemId.
    const inputs = [{ itemId: "iron_ingot", qty: 2 }];
    const recipe = { name: "blade" };
    const hand = resolveCraft({ inputs, recipe, playerSkill: 20, stationQuality: 0 });
    const forge = resolveCraft({ inputs, recipe, playerSkill: 20, stationQuality: STATION_TIERS.forge });
    const enchanter = resolveCraft({ inputs, recipe, playerSkill: 20, stationQuality: STATION_TIERS.enchanter });
    assert.ok(forge.outputPotency > hand.outputPotency, "forge beats hand-craft");
    assert.ok(enchanter.outputPotency > forge.outputPotency, "enchanter beats forge");
  });
});
