// server/tests/vegetation-scatter.test.js
//
// Phase M2 (Godot vegetation instancing) — pins server/lib/vegetation-
// scatter.js#scatterVegetationForWorld: determinism, real per-point
// containment inside its own district's real boundary polygon, species
// membership, honest-empty on a world with no recorded districts, and the
// maxPerDistrict cap.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedDefaultDistricts, listDistricts, pointInPolygon } from "../lib/districts.js";
import { scatterVegetationForWorld, VEGETATION_SPECIES } from "../lib/vegetation-scatter.js";

describe("vegetation-scatter — scatterVegetationForWorld", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    seedDefaultDistricts(db, "concordia-hub");
  });

  it("is deterministic — identical output across two calls against the same district set", () => {
    const a = scatterVegetationForWorld(db, "concordia-hub");
    const b = scatterVegetationForWorld(db, "concordia-hub");
    assert.deepEqual(a, b);
    assert.ok(a.length > 0, "concordia-hub has real seeded districts, so this must produce real entries");
  });

  it("every entry's (x,z) is genuinely inside its own district's real boundary polygon", () => {
    const districts = listDistricts(db, "concordia-hub");
    const byId = new Map(districts.map((d) => [d.id, d]));
    const entries = scatterVegetationForWorld(db, "concordia-hub");
    assert.ok(entries.length > 0);
    for (const e of entries) {
      const d = byId.get(e.districtId);
      assert.ok(d, `entry references a real district id (${e.districtId})`);
      assert.ok(
        pointInPolygon(e.x, e.z, d.boundary),
        `entry ${e.id} at (${e.x},${e.z}) must be inside its own district's real boundary`
      );
    }
  });

  it("every entry's species is one of the real on-disk vegetation GLB ids", () => {
    const entries = scatterVegetationForWorld(db, "concordia-hub");
    for (const e of entries) {
      assert.ok(VEGETATION_SPECIES.includes(e.species), `${e.species} must be a real known species id`);
    }
  });

  it("uses each district's real elevationHint for y, never a guessed height", () => {
    const districts = listDistricts(db, "concordia-hub");
    const byId = new Map(districts.map((d) => [d.id, d]));
    const entries = scatterVegetationForWorld(db, "concordia-hub");
    for (const e of entries) {
      const d = byId.get(e.districtId);
      assert.equal(e.y, Number(d.elevationHint) || 0);
    }
  });

  it("a world with no recorded districts returns an honestly empty array", () => {
    const entries = scatterVegetationForWorld(db, "a-world-with-no-districts-at-all");
    assert.deepEqual(entries, []);
  });

  it("respects maxPerDistrict regardless of district area", () => {
    const entries = scatterVegetationForWorld(db, "concordia-hub", { maxPerDistrict: 2 });
    const byDistrict = new Map();
    for (const e of entries) {
      byDistrict.set(e.districtId, (byDistrict.get(e.districtId) || 0) + 1);
    }
    for (const count of byDistrict.values()) {
      assert.ok(count <= 2, "no district may exceed the requested maxPerDistrict cap");
    }
  });

  it("a lower densityPerM2 produces fewer (or equal) entries than a higher one", () => {
    const sparse = scatterVegetationForWorld(db, "concordia-hub", { densityPerM2: 0.0001, maxPerDistrict: 1000 });
    const dense = scatterVegetationForWorld(db, "concordia-hub", { densityPerM2: 0.001, maxPerDistrict: 1000 });
    assert.ok(dense.length >= sparse.length, "a higher density must never produce fewer real placements");
  });
});
