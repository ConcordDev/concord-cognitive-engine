// server/tests/building-purpose.test.js
//
// Tier-2 contract tests for the purposeful-building framework (master-spec
// A3+A4, "no dead facades"). Pins:
//   - every authored building in city-layout.json has a real purpose + a
//     valid district_id (assertNoDeadFacades() returns [])
//   - every lens-building's `lens` resolves to a non-empty lens id
//   - buildingsForDistrict / buildingPurpose / lensForBuilding round-trip
//   - scene-export additively carries purpose/district_id/lens/levels for
//     REAL world_buildings rows without breaking the existing node shape
//   - seedCityLayout is idempotent and never mutates world_buildings

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { exportScene, SCENE_FORMAT } from "../lib/scene-export.js";
import {
  CITY_LAYOUT_WORLD_ID,
  allBuildings,
  validDistrictIds,
  conceptForDistrict,
  buildingPurpose,
  buildingsForDistrict,
  lensForBuilding,
  buildingPurposeForType,
  assertNoDeadFacades,
  seedCityLayout,
} from "../lib/building-purpose.js";

function building(db, id, worldId, fields) {
  const f = {
    building_type: "house", x: 0, y: 0, z: 0, rotation: 0,
    width: 10, depth: 10, height: 8, material: "stone", floors: 1,
    state: "standing", health_pct: 1, ...fields,
  };
  db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, x, y, z, rotation, width, depth, height, material, floors, state, health_pct)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, worldId, f.building_type, f.x, f.y, f.z, f.rotation, f.width, f.depth, f.height, f.material, f.floors, f.state, f.health_pct);
}

describe("building-purpose — authored layout honesty", () => {
  it("CITY_LAYOUT_WORLD_ID is concordia-hub", () => {
    assert.equal(CITY_LAYOUT_WORLD_ID, "concordia-hub");
  });

  it("has a non-trivial authored building set", () => {
    const all = allBuildings();
    assert.ok(all.length >= 40, `expected at least 40 authored buildings, got ${all.length}`);
  });

  it("exposes exactly the 6 real districts, each with a master-spec concept", () => {
    const ids = validDistrictIds();
    assert.equal(ids.length, 6);
    for (const id of ids) {
      assert.ok(id.startsWith("concordia-hub:"), `district id ${id} should be world-qualified`);
      const concept = conceptForDistrict(id);
      assert.ok(typeof concept === "string" && concept.length > 0, `district ${id} has a concept`);
    }
    // The 6 real geometric districts from server/lib/districts.js, by key.
    const keys = ids.map((id) => id.split(":")[1]).sort();
    assert.deepEqual(keys, ["academy", "industrial", "market", "observatory", "plaza", "riverside"]);
  });

  it("assertNoDeadFacades() returns empty — no building lacks a real purpose or a valid district", () => {
    const offenders = assertNoDeadFacades();
    assert.deepEqual(offenders, [], `dead facades found: ${JSON.stringify(offenders)}`);
  });

  it("every building has a purpose string long enough to be a real function, not a placeholder", () => {
    for (const b of allBuildings()) {
      assert.ok(typeof b.purpose === "string" && b.purpose.trim().length >= 12, `building ${b.id} purpose too thin`);
      assert.ok(!/^(tbd|todo|placeholder|n\/a|none|unknown)$/i.test(b.purpose.trim()), `building ${b.id} purpose looks like a placeholder`);
    }
  });

  it("every building declares one of the 6 valid district ids", () => {
    const valid = new Set(validDistrictIds());
    for (const b of allBuildings()) {
      assert.ok(valid.has(b.district_id), `building ${b.id} has invalid district_id ${b.district_id}`);
    }
  });

  it("every lens-building's lens field is a non-empty string", () => {
    const lensBuildings = allBuildings().filter((b) => b.lens != null);
    assert.ok(lensBuildings.length >= 20, "expected at least the ~20 lens-portal buildings plus station overlaps");
    for (const b of lensBuildings) {
      assert.ok(typeof b.lens === "string" && b.lens.trim().length > 0, `building ${b.id} has an empty lens field`);
      assert.equal(lensForBuilding(b.id), b.lens);
    }
  });

  it("service/infra buildings are honestly non-lens (lens === null)", () => {
    const services = allBuildings().filter((b) => b.source === "service");
    assert.ok(services.length > 0);
    for (const s of services) {
      assert.equal(s.lens, null, `service building ${s.id} should not fabricate a lens`);
    }
  });

  it("buildingPurpose resolves a known id and returns null for an unknown one", () => {
    const known = allBuildings()[0];
    assert.deepEqual(buildingPurpose(known.id), known);
    assert.equal(buildingPurpose("does-not-exist"), null);
    assert.equal(buildingPurpose(), null);
  });

  it("buildingsForDistrict partitions every building across exactly the 6 districts, none empty", () => {
    const ids = validDistrictIds();
    let total = 0;
    for (const id of ids) {
      const inDistrict = buildingsForDistrict(id);
      assert.ok(inDistrict.length > 0, `district ${id} has zero buildings — reads as unpurposed`);
      for (const b of inDistrict) assert.equal(b.district_id, id);
      total += inDistrict.length;
    }
    assert.equal(total, allBuildings().length, "every building belongs to exactly one of the 6 districts");
  });

  it("buildingPurposeForType only resolves REAL (station/service) building_types, never ambiguous lens-portal shells", () => {
    // "studio" is shared by 5 different lens portals (by the pre-existing
    // portal registry's own design) — must stay unresolved by type.
    assert.equal(buildingPurposeForType("studio", "concordia-hub"), null);
    // "courthouse" is a unique station building_type — resolves.
    const r = buildingPurposeForType("courthouse", "concordia-hub");
    assert.ok(r);
    assert.equal(r.lens, "legal");
    assert.ok(typeof r.purpose === "string" && r.purpose.length > 0);
  });

  it("buildingPurposeForType returns null for any world other than concordia-hub — never fabricates cross-world purpose", () => {
    assert.equal(buildingPurposeForType("courthouse", "some-other-world"), null);
    assert.equal(buildingPurposeForType("forge", "w1"), null);
  });
});

describe("building-purpose — scene-export wiring (additive)", () => {
  let db;

  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    building(db, "b1", "concordia-hub", { building_type: "forge", x: 10, y: 0, z: 20, rotation: 1.57, width: 12, depth: 8, height: 6, material: "steel" });
    building(db, "b2", "concordia-hub", { building_type: "courthouse", x: -30, y: 0, z: -10, width: 10, depth: 10, height: 8, floors: 2 });
    building(db, "b3", "w1", { building_type: "house", x: 0, y: 0, z: 0 }); // non-authored world
    building(db, "b4", "concordia-hub", { building_type: "totally-unauthored-type", x: 5, y: 0, z: 5 });
  });

  it("existing node/bounds/format/count contract is unchanged for concordia-hub", () => {
    const s = exportScene(db, "concordia-hub");
    assert.equal(s.ok, true);
    assert.equal(s.format, SCENE_FORMAT);
    assert.equal(s.count, 3);
    assert.ok(Array.isArray(s.nodes) && s.nodes.length === 3);
    assert.ok(s.bounds);
  });

  it("attaches purpose/district_id/lens/levels to a REAL, unambiguous building_type", () => {
    const s = exportScene(db, "concordia-hub");
    const courthouse = s.nodes.find((n) => n.id === "b2");
    assert.ok(courthouse);
    assert.equal(courthouse.extras.lens, "legal");
    assert.ok(typeof courthouse.extras.purpose === "string" && courthouse.extras.purpose.length > 0);
    assert.equal(courthouse.extras.district_id, "concordia-hub:observatory");
    assert.ok(courthouse.extras.levels && typeof courthouse.extras.levels === "object");
    // Pre-existing extras fields must still be present (additive, not replaced).
    assert.equal(courthouse.extras.state, "standing");
    assert.equal(courthouse.extras.floors, 2);
    assert.equal(typeof courthouse.extras.health, "number");

    const forge = s.nodes.find((n) => n.id === "b1");
    assert.equal(forge.extras.lens, null, "forge is a service building, honestly non-lens");
    assert.ok(typeof forge.extras.purpose === "string" && forge.extras.purpose.length > 0);
  });

  it("does NOT fabricate purpose fields for an unauthored building_type", () => {
    const s = exportScene(db, "concordia-hub");
    const unknown = s.nodes.find((n) => n.id === "b4");
    assert.ok(unknown);
    assert.equal(unknown.extras.purpose, undefined);
    assert.equal(unknown.extras.district_id, undefined);
    assert.equal(unknown.extras.lens, undefined);
    assert.equal(unknown.extras.levels, undefined);
    // Base extras contract still holds.
    assert.equal(unknown.extras.state, "standing");
  });

  it("does NOT fabricate purpose fields for a non-authored world, even for a real building_type", () => {
    const s = exportScene(db, "w1");
    assert.equal(s.ok, true);
    const house = s.nodes.find((n) => n.id === "b3");
    assert.ok(house);
    assert.equal(house.extras.purpose, undefined);
    assert.equal(house.extras.district_id, undefined);
    assert.equal(house.extras.lens, undefined);
  });
});

describe("building-purpose — seedCityLayout (read-only diagnostic)", () => {
  let db;

  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
  });

  it("is honest on a fresh install with zero world_buildings rows", () => {
    const r = seedCityLayout(db, "concordia-hub");
    assert.equal(r.ok, true);
    assert.equal(r.deadFacades, 0);
    assert.equal(r.matchedBuildings, 0);
    assert.ok(r.total >= 40);
  });

  it("reports increased coverage once real stations exist, and never writes to world_buildings", () => {
    const before_ = db.prepare(`SELECT COUNT(*) AS n FROM world_buildings WHERE world_id = ?`).get("concordia-hub").n;
    building(db, "s1", "concordia-hub", { building_type: "courthouse" });
    building(db, "s2", "concordia-hub", { building_type: "trading_floor" });
    const r1 = seedCityLayout(db, "concordia-hub");
    assert.equal(r1.matchedBuildings, 2);
    const afterFirstCall = db.prepare(`SELECT COUNT(*) AS n FROM world_buildings WHERE world_id = ?`).get("concordia-hub").n;
    assert.equal(afterFirstCall, before_ + 2, "seedCityLayout must not insert any world_buildings rows");

    // Idempotent — calling again changes nothing.
    const r2 = seedCityLayout(db, "concordia-hub");
    assert.equal(r2.matchedBuildings, 2);
    const afterSecondCall = db.prepare(`SELECT COUNT(*) AS n FROM world_buildings WHERE world_id = ?`).get("concordia-hub").n;
    assert.equal(afterSecondCall, afterFirstCall);
  });

  it("is an honest no-op reason for a world with no authored layout", () => {
    const r = seedCityLayout(db, "some-other-world");
    assert.equal(r.ok, true);
    assert.equal(r.reason, "no_authored_layout_for_world");
  });

  it("degrades gracefully with no db handle (diagnostic-only, never throws)", () => {
    const r = seedCityLayout(undefined, "concordia-hub");
    assert.equal(r.ok, true);
    assert.equal(r.reason, "no_db_diagnostic_only");
  });
});
