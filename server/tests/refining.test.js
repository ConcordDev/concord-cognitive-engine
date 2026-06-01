// G2 — refining chains (ore -> ingot -> alloy). Pins: a basic refine consumes the
// input and yields the ingot; higher tiers are gated behind a better station;
// insufficient mats / not-refinable / kill-switch; and a forced backfire ruins the
// melt (mats consumed, no output, debuff) — the soft failure the spec wants.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { refine, REFINING_CHAINS } from "../lib/refining.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_inventory (id TEXT PRIMARY KEY, user_id TEXT, item_type TEXT, item_id TEXT, item_name TEXT, quantity INTEGER, quality TEXT, acquired_at INTEGER);
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, health_pct REAL DEFAULT 1.0);
    CREATE TABLE user_active_effects (id TEXT PRIMARY KEY, user_id TEXT, effect_id TEXT, magnitude REAL, expires_at INTEGER, source TEXT);
  `);
  db.prepare("INSERT INTO world_buildings VALUES ('forge1','sere','forge',1.0)").run();
  db.prepare("INSERT INTO world_buildings VALUES ('fab1','sere','factory_workbench',1.0)").run();
  return db;
}
function give(db, itemId, qty) {
  db.prepare("INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality, acquired_at) VALUES (?, 'u1','item',?,?,?,'raw',unixepoch())")
    .run(`inv_${itemId}_${qty}_${Math.random()}`, itemId, itemId, qty);
}
const qty = (db, itemId) => Number(db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM player_inventory WHERE user_id='u1' AND item_id=?").get(itemId).n);

describe("refining (G2)", () => {
  beforeEach(() => { process.env.CONCORD_REFINING = "1"; process.env.CONCORD_CRAFT_STATIONS = "1"; });
  afterEach(() => { delete process.env.CONCORD_REFINING; delete process.env.CONCORD_CRAFT_STATIONS; });

  it("the basic tier needs no station and consumes the input", () => {
    const db = freshDb();
    give(db, "iron_ore", 5);
    // iron_ore -> iron_ingot has minStation 0, so it runs without a building
    // (the gate is not the failure mode). resolveCraft is seeded/deterministic, so
    // we assert the path ran + the input was consumed, not a specific roll.
    const r = refine(db, "u1", "sere", "iron_ore", {});
    assert.equal(r.ok, true);
    assert.notEqual(r.reason, "station_too_basic");
    assert.equal(qty(db, "iron_ore"), 5 - REFINING_CHAINS.iron_ore.inputQty, "ore consumed by the melt");
  });

  it("a station-gated refine yields the refined output (iron_ingot -> steel_ingot)", () => {
    const db = freshDb();
    give(db, "iron_ingot", 3);
    const r = refine(db, "u1", "sere", "iron_ingot", { buildingId: "forge1" });
    assert.equal(r.ok, true);
    assert.equal(r.failed, false);
    assert.equal(r.refined, "steel_ingot");
    assert.equal(qty(db, "iron_ingot"), 0, "ingots consumed");
    assert.equal(qty(db, "steel_ingot"), REFINING_CHAINS.iron_ingot.outputQty, "steel minted");
  });

  it("higher tiers are gated behind a better station", () => {
    const db = freshDb();
    give(db, "iron_ingot", 6);
    // iron_ingot -> steel_ingot needs station >= 60; hand-craft (no building) fails
    assert.equal(refine(db, "u1", "sere", "iron_ingot", {}).reason, "station_too_basic");
    // at a forge (60) it succeeds
    const r = refine(db, "u1", "sere", "iron_ingot", { buildingId: "forge1" });
    assert.equal(r.ok, true);
    assert.equal(r.refined, "steel_ingot");
    // steel_ingot -> steel_alloy needs station >= 80 (fabricator)
    give(db, "steel_ingot", 4);
    assert.equal(refine(db, "u1", "sere", "steel_ingot", { buildingId: "forge1" }).reason, "station_too_basic");
    assert.equal(refine(db, "u1", "sere", "steel_ingot", { buildingId: "fab1" }).ok, true);
  });

  it("rejects insufficient mats, unrefinable items, and the kill-switch", () => {
    const db = freshDb();
    give(db, "iron_ore", 1); // need 2
    assert.equal(refine(db, "u1", "sere", "iron_ore", {}).reason, "insufficient_materials");
    assert.equal(refine(db, "u1", "sere", "wood", {}).reason, "not_refinable");
    process.env.CONCORD_REFINING = "0";
    give(db, "iron_ore", 5);
    assert.equal(refine(db, "u1", "sere", "iron_ore", {}).reason, "disabled");
  });

  it("a backfire ruins the melt — mats consumed, no output, a debuff", () => {
    const db = freshDb();
    // resolveCraft's backfire roll is seeded/deterministic per input; iron_ore at
    // its 8% chance lands a backfire for this exact composition — a clean pin of
    // the soft-failure PATH (mats gone, nothing made, a minor debuff, never a throw).
    process.env.CONCORD_CRAFT_RESOLVE = "1";
    give(db, "iron_ore", 2);
    const r = refine(db, "u1", "sere", "iron_ore", {});
    assert.equal(r.ok, true);
    assert.equal(r.failed, true, "this seeded input backfires");
    assert.equal(r.refined, null, "no ingot produced");
    assert.equal(qty(db, "iron_ore"), 0, "mats consumed by the ruined melt");
    assert.equal(qty(db, "iron_ingot"), 0, "nothing made");
    assert.ok(r.debuff?.effect_id, "a minor debuff is applied");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM user_active_effects WHERE source='refine_backfire'").get().n, 1);
    delete process.env.CONCORD_CRAFT_RESOLVE;
  });
});
