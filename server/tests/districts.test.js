// server/tests/districts.test.js
//
// Tier-2 contract tests for districts as real 2D geometric regions
// (migration 374, server/lib/districts.js). Pins:
//   - pointInPolygon correctness: inside / outside / on-edge
//   - seedDefaultDistricts idempotency (running twice doesn't duplicate)
//   - listDistricts round-trip (boundary/palette parsed back to objects)
//   - scene-export carries a `districts` field without breaking the
//     existing nodes/bounds/format/count shape

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  pointInPolygon,
  polygonArea,
  seedDefaultDistricts,
  listDistricts,
  getDistrict,
  districtAt,
} from "../lib/districts.js";
import { exportScene, SCENE_FORMAT } from "../lib/scene-export.js";

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

describe("districts — pointInPolygon (pure)", () => {
  // A simple square: (0,0) -> (10,0) -> (10,10) -> (0,10)
  const square = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 0, z: 10 },
  ];

  it("returns true for a point clearly inside", () => {
    assert.equal(pointInPolygon(5, 5, square), true);
  });

  it("returns false for a point clearly outside", () => {
    assert.equal(pointInPolygon(50, 50, square), false);
    assert.equal(pointInPolygon(-5, 5, square), false);
  });

  it("treats a point exactly on an edge as inside", () => {
    assert.equal(pointInPolygon(0, 5, square), true, "on left edge");
    assert.equal(pointInPolygon(10, 5, square), true, "on right edge");
    assert.equal(pointInPolygon(5, 0, square), true, "on bottom edge");
    assert.equal(pointInPolygon(5, 10, square), true, "on top edge");
  });

  it("treats a vertex as inside", () => {
    assert.equal(pointInPolygon(0, 0, square), true);
    assert.equal(pointInPolygon(10, 10, square), true);
  });

  it("degrades honestly on a malformed polygon", () => {
    assert.equal(pointInPolygon(1, 1, []), false);
    assert.equal(pointInPolygon(1, 1, null), false);
    assert.equal(pointInPolygon(1, 1, [{ x: 0, z: 0 }, { x: 1, z: 1 }]), false, "only 2 vertices");
  });

  it("works on a non-axis-aligned (rotated) triangle too", () => {
    const tri = [{ x: 0, z: 0 }, { x: 10, z: 4 }, { x: 4, z: 10 }];
    assert.equal(pointInPolygon(4, 4, tri), true);
    assert.equal(pointInPolygon(9, 9, tri), false);
  });
});

describe("districts — polygonArea (pure, F25 district streaming policy)", () => {
  it("computes the exact area of a 10x10 square", () => {
    const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
    assert.equal(polygonArea(square), 100);
  });

  it("is orientation-agnostic (CW and CCW give the same positive area)", () => {
    const ccw = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
    const cw = [{ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 10, z: 10 }, { x: 10, z: 0 }];
    assert.equal(polygonArea(ccw), polygonArea(cw));
  });

  it("matches the real concordia-hub plaza rect area (140x140)", () => {
    // districts.js DEFAULT_DISTRICTS plaza: rect(0, 0, 70, 70)
    const plaza = [
      { x: -70, z: -70 }, { x: 70, z: -70 }, { x: 70, z: 70 }, { x: -70, z: 70 },
    ];
    assert.equal(polygonArea(plaza), 140 * 140);
  });

  it("degrades honestly on a malformed polygon", () => {
    assert.equal(polygonArea([]), 0);
    assert.equal(polygonArea(null), 0);
    assert.equal(polygonArea([{ x: 0, z: 0 }, { x: 1, z: 1 }]), 0, "only 2 vertices");
    assert.equal(polygonArea([{ x: 0, z: 0 }, { x: 1 }, { x: 2, z: 2 }]), 0, "vertex missing z");
  });
});

describe("districts — DB-backed CRUD + seeding", () => {
  let db;

  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
  });

  it("seeds the authored concordia-hub layout", () => {
    const r = seedDefaultDistricts(db, "concordia-hub");
    assert.equal(r.ok, true);
    assert.ok(r.seeded >= 5, "at least 5 authored districts");
  });

  it("is idempotent — seeding twice does not duplicate rows", () => {
    const before1 = listDistricts(db, "concordia-hub").length;
    const r2 = seedDefaultDistricts(db, "concordia-hub");
    assert.equal(r2.seeded, 0, "second pass inserts nothing new");
    assert.ok(r2.skipped >= before1);
    const after = listDistricts(db, "concordia-hub").length;
    assert.equal(after, before1, "row count unchanged after re-seed");
  });

  it("is an honest no-op for a world with no authored layout", () => {
    const r = seedDefaultDistricts(db, "some-unauthored-world");
    assert.equal(r.ok, true);
    assert.equal(r.seeded, 0);
    assert.equal(listDistricts(db, "some-unauthored-world").length, 0);
  });

  it("listDistricts round-trips boundary + palette as parsed objects", () => {
    const districts = listDistricts(db, "concordia-hub");
    assert.ok(districts.length > 0);
    for (const d of districts) {
      assert.equal(typeof d.id, "string");
      assert.equal(d.worldId, "concordia-hub");
      assert.equal(typeof d.name, "string");
      assert.ok(Array.isArray(d.boundary), "boundary parsed to an array");
      assert.ok(d.boundary.length >= 3, "a real polygon, not empty");
      for (const v of d.boundary) {
        assert.equal(typeof v.x, "number");
        assert.equal(typeof v.z, "number");
      }
      assert.equal(typeof d.palette, "object");
      assert.ok(d.palette.primary, "has a primary color");
    }
  });

  it("getDistrict returns a single parsed district by id", () => {
    const all = listDistricts(db, "concordia-hub");
    const one = getDistrict(db, all[0].id);
    assert.ok(one);
    assert.equal(one.id, all[0].id);
    assert.ok(Array.isArray(one.boundary));
  });

  it("getDistrict returns null for a missing id", () => {
    assert.equal(getDistrict(db, "does-not-exist"), null);
  });

  it("districtAt resolves the plaza center to the plaza district", () => {
    const plaza = districtAt(db, "concordia-hub", 0, 0);
    assert.ok(plaza, "origin should resolve to a district");
    assert.match(plaza.name, /Plaza/i);
  });

  it("districtAt returns null for a point outside every district", () => {
    const outside = districtAt(db, "concordia-hub", 100000, 100000);
    assert.equal(outside, null);
  });

  it("districts don't overlap at their sampled centers", () => {
    const all = listDistricts(db, "concordia-hub");
    const seen = new Set();
    for (const d of all) {
      // Sample the polygon centroid (average of vertices) as a stand-in
      // "somewhere well inside" probe.
      const cx = d.boundary.reduce((s, v) => s + v.x, 0) / d.boundary.length;
      const cz = d.boundary.reduce((s, v) => s + v.z, 0) / d.boundary.length;
      const hit = districtAt(db, "concordia-hub", cx, cz);
      assert.ok(hit, `centroid of ${d.name} should resolve to a district`);
      assert.equal(hit.id, d.id, `centroid of ${d.name} resolves to itself, not a neighbor`);
      seen.add(hit.id);
    }
    assert.equal(seen.size, all.length, "every district's centroid is distinct");
  });
});

describe("districts — scene-export additive field", () => {
  let db;

  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    building(db, "b1", "concordia-hub", { building_type: "forge", x: 10, y: 0, z: 20, rotation: 1.57, width: 12, depth: 8, height: 6, material: "steel" });
    building(db, "b2", "concordia-hub", { building_type: "house", x: -30, y: 0, z: -10, width: 10, depth: 10, height: 8 });
    seedDefaultDistricts(db, "concordia-hub");
  });

  it("carries a districts array without breaking the existing shape", () => {
    const s = exportScene(db, "concordia-hub");
    assert.equal(s.ok, true);
    assert.equal(s.format, SCENE_FORMAT);
    // 2 seeded buildings + 13 real, always-on hub tableau nodes (Unburned
    // Court + pillars + embassy gates — lib/scene-export.js#hubTableauNodes,
    // additive for worldId===concordia-hub specifically). This test's own
    // assertion is about the districts field being additive, not about the
    // hub tableau, but it exercises the real exportScene() path on the hub
    // world, so the count must reflect that path's real total.
    assert.equal(s.count, 15, "existing building-count contract unchanged");
    assert.ok(Array.isArray(s.nodes) && s.nodes.length === 15, "existing nodes contract unchanged");
    assert.ok(s.bounds, "existing bounds contract unchanged");
    assert.ok(Array.isArray(s.districts), "new districts field is present");
    assert.ok(s.districts.length >= 5);
    const one = s.districts[0];
    assert.ok(Array.isArray(one.boundary));
    assert.ok(one.palette && typeof one.palette === "object");
  });

  it("a world with no districts gets an honest empty array, never a fabricated one", () => {
    const s = exportScene(db, "some-world-with-no-districts");
    assert.equal(s.ok, true);
    assert.deepEqual(s.districts, []);
  });

  it("each district carries real buildingCount + areaM2 (F25 — district streaming policy)", () => {
    const s = exportScene(db, "concordia-hub");
    const plaza = s.districts.find((d) => d.id === "concordia-hub:plaza");
    // b1 (10,20) and b2 (-30,-10) both fall inside the plaza rect (±70).
    assert.equal(plaza.buildingCount, 2, "both fixture buildings land inside the plaza boundary");
    assert.equal(plaza.areaM2, 140 * 140, "real shoelace area of the plaza rect");
    const market = s.districts.find((d) => d.id === "concordia-hub:market");
    assert.equal(market.buildingCount, 0, "a district with no buildings inside it is honestly 0, not omitted");
    assert.ok(market.areaM2 > 0, "area is still computed even with zero buildings");
  });
});
