/**
 * Living Society WS4.2 — smart-object POIs read REAL buildings (no random offsets).
 *
 * Run: node --test tests/npc-pois.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up292 } from "../migrations/292_npc_needs.js";
import { nearbyPOIs, nearestOfType, advertisementFor } from "../lib/npc-pois.js";
import { getNeeds, setNeeds, freshNeeds } from "../lib/npc-needs.js";
import { chooseNextGoal } from "../lib/npc-utility.js";

const W = "concordia-hub";
function mkDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, current_location TEXT, spawn_location TEXT, is_dead INTEGER DEFAULT 0);
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, state TEXT DEFAULT 'standing', x REAL, y REAL, z REAL);
  `);
  up292(db);
  const b = (id, type, x, z, state = "standing") =>
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, state, x, y, z) VALUES (?, ?, ?, ?, ?, 0, ?)`).run(id, W, type, state, x, z);
  b("inn1", "inn", 10, 0); b("forge1", "forge", 30, 0); b("house1", "house", 5, 0);
  b("market1", "market", 50, 0); b("gone", "warehouse", 1, 0, "collapsed");
  return db;
}

describe("WS4.2 — POIs from real buildings", () => {
  it("nearbyPOIs returns standing buildings (not collapsed), nearest-first, with advertisements", () => {
    const db = mkDb();
    const pois = nearbyPOIs(db, W, 0, 0, 12);
    const ids = pois.map((p) => p.id);
    assert.ok(ids.includes("inn1") && ids.includes("forge1") && ids.includes("house1"));
    assert.ok(!ids.includes("gone"), "collapsed building excluded");
    assert.ok(pois[0].dist <= pois[pois.length - 1].dist, "nearest-first");
    assert.ok(pois.find((p) => p.id === "inn1").advertises.hunger > 0, "inn advertises hunger");
  });

  it("nearestOfType resolves a location_kind to the real building", () => {
    const db = mkDb();
    assert.equal(nearestOfType(db, W, 0, 0, "house").id, "house1");
    assert.equal(nearestOfType(db, W, 0, 0, "forge").id, "forge1");
    assert.equal(nearestOfType(db, W, 0, 0, "temple"), null, "no temple building → null (honest)");
  });

  it("advertisementFor maps types; unknown type → {}", () => {
    assert.ok(advertisementFor("forge").wealth > 0);
    assert.deepEqual(advertisementFor("nonsense"), {});
  });

  it("empty world → no POIs (NPC just paces, no fake POI)", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE world_buildings (id TEXT, world_id TEXT, building_type TEXT, state TEXT, x REAL, z REAL);`);
    assert.deepEqual(nearbyPOIs(db, W, 0, 0), []);
  });

  it("end-to-end: a hungry NPC's chosen goal is the REAL inn building", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype) VALUES ('n1', ?, 'farmer')`).run(W);
    setNeeds(db, "n1", { hunger: 0.9, energy: 0.2, wealth: 0.2, social: 0.2, safety: 0.1, purpose: 0.2 });
    const needs = getNeeds(db, "n1");
    const pois = nearbyPOIs(db, W, 0, 0);
    const goal = chooseNextGoal({ id: "n1", archetype: "farmer" }, needs, pois, { topN: 1 });
    assert.equal(goal.poi.id, "inn1", "the hungry NPC's destination is the real inn");
  });

  it("needs round-trip through world_npcs.needs_json", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('n2', ?)`).run(W);
    assert.deepEqual(getNeeds(db, "n2"), freshNeeds()); // default before set
    setNeeds(db, "n2", { hunger: 0.7 });
    assert.equal(getNeeds(db, "n2").hunger, 0.7);
  });
});
