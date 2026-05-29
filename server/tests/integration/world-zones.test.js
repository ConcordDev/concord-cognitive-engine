/**
 * T3.3 — world zones.
 *
 * Pins:
 *   - zoneAt resolves the smallest containing zone (nested sanctuary wins)
 *   - combatRuleFor refuses combat in safe/sanctuary, allows it in pvp/lawless/
 *     hazard, and surfaces hazard dps + pvp + witness-suppression flags
 *   - the world default (no zone) allows combat with PvP off
 *   - the hub hardcode override always refuses
 *   - upsert is idempotent on (world_id, name); seedDefaultZones seeds a hub
 *     sanctuary that agrees with the Concordant Law
 *
 * Run: node --test tests/integration/world-zones.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up262 } from "../../migrations/262_world_zones.js";
import {
  ZONE_KINDS, zoneAt, combatRuleFor, upsertZone, listZones, seedDefaultZones,
} from "../../lib/world-zones.js";

function freshDb() {
  const db = new Database(":memory:");
  up262(db);
  return db;
}

describe("T3.3 — zoneAt resolution", () => {
  it("resolves the smallest containing zone", () => {
    const db = freshDb();
    upsertZone(db, { worldId: "w1", name: "Blight Field", kind: "hazard", centerX: 0, centerZ: 0, radiusM: 200 });
    upsertZone(db, { worldId: "w1", name: "Shrine", kind: "sanctuary", centerX: 0, centerZ: 0, radiusM: 20 });
    // inside both → smallest (Shrine) wins
    assert.equal(zoneAt(db, "w1", 5, 5).name, "Shrine");
    // inside only the hazard field
    assert.equal(zoneAt(db, "w1", 100, 0).name, "Blight Field");
    // outside both
    assert.equal(zoneAt(db, "w1", 500, 500), null);
    db.close();
  });
});

describe("T3.3 — combatRuleFor", () => {
  it("refuses combat in safe/sanctuary", () => {
    const db = freshDb();
    upsertZone(db, { worldId: "w1", name: "Temple", kind: "sanctuary", radiusM: 30 });
    const r = combatRuleFor(db, "w1", 0, 0);
    assert.equal(r.combatAllowed, false);
    assert.equal(r.reason, "sanctuary");
    db.close();
  });

  it("allows combat in pvp/lawless/hazard and surfaces their flags", () => {
    const db = freshDb();
    upsertZone(db, { worldId: "w1", name: "Arena", kind: "pvp", radiusM: 30 });
    upsertZone(db, { worldId: "w2", name: "Slums", kind: "lawless", radiusM: 30 });
    upsertZone(db, { worldId: "w3", name: "Lava", kind: "hazard", radiusM: 30, rules: { hazard: 9, element: "fire" } });

    const pvp = combatRuleFor(db, "w1", 0, 0);
    assert.equal(pvp.combatAllowed, true);
    assert.equal(pvp.pvpAllowed, true);

    const lawless = combatRuleFor(db, "w2", 0, 0);
    assert.equal(lawless.combatAllowed, true);
    assert.equal(lawless.suppressWitness, true);

    const hazard = combatRuleFor(db, "w3", 0, 0);
    assert.equal(hazard.combatAllowed, true);
    assert.equal(hazard.hazardDps, 9);
    assert.equal(hazard.hazardElement, "fire");
    db.close();
  });

  it("world default (no zone) allows combat, PvP off", () => {
    const db = freshDb();
    const r = combatRuleFor(db, "w1", 0, 0);
    assert.equal(r.combatAllowed, true);
    assert.equal(r.pvpAllowed, false);
    assert.equal(r.reason, "default");
    db.close();
  });

  it("hub hardcode override always refuses", () => {
    const db = freshDb();
    const r = combatRuleFor(db, "concordia-hub", 0, 0, { hubHardcoded: true });
    assert.equal(r.combatAllowed, false);
    assert.equal(r.reason, "concordant_law");
    db.close();
  });
});

describe("T3.3 — authoring + seeding", () => {
  it("upsert is idempotent on (world_id, name)", () => {
    const db = freshDb();
    upsertZone(db, { worldId: "w1", name: "Arena", kind: "pvp", radiusM: 30 });
    upsertZone(db, { worldId: "w1", name: "Arena", kind: "pvp", radiusM: 90 }); // update radius
    const zones = listZones(db, "w1");
    assert.equal(zones.length, 1);
    assert.equal(zones[0].radius_m, 90);
    db.close();
  });

  it("rejects invalid kinds", () => {
    const db = freshDb();
    const r = upsertZone(db, { worldId: "w1", name: "X", kind: "nonsense" });
    assert.equal(r.ok, false);
    assert.ok(ZONE_KINDS.includes("sanctuary"));
    db.close();
  });

  it("seedDefaultZones seeds a hub sanctuary agreeing with Concordant Law", () => {
    const db = freshDb();
    const n = seedDefaultZones(db, ["concordia-hub", "tunya"]);
    assert.equal(n, 2);
    const hubZone = zoneAt(db, "concordia-hub", 0, 0);
    assert.equal(hubZone.kind, "sanctuary");
    assert.equal(combatRuleFor(db, "concordia-hub", 0, 0).combatAllowed, false);
    db.close();
  });

  it("degrades to no-zone when world_zones is absent", () => {
    const bare = new Database(":memory:");
    assert.equal(zoneAt(bare, "w1", 0, 0), null);
    assert.equal(combatRuleFor(bare, "w1", 0, 0).combatAllowed, true);
    bare.close();
  });
});
