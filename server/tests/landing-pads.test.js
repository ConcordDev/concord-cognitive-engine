// server/tests/landing-pads.test.js
//
// Master-spec C11/C12 — real landing-pad markers for flight-capable mounts
// and future aircraft. Pins the additive, honest-by-construction surface
// built on top of the REAL authored layout (content/world/concordia-hub/
// city-layout.json's standalone `landingPads` array,
// server/lib/building-purpose.js#landingPadsForWorld):
//
//   1. `landingPadsForWorld` — a world-scoped, honest read of the authored
//      pads (never fabricated for an unauthored world).
//   2. `exportScene`'s additive `landingPads` field — the same real pads,
//      surfaced through the scene-export contract a Godot/Three.js client
//      already consumes for buildings/districts/plaza.
//
// Same pattern as server/tests/central-plaza-map.test.js (the A1 unit this
// C11/C12 unit is told to follow exactly).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { exportScene, SCENE_FORMAT } from "../lib/scene-export.js";
import { landingPadsForWorld, CITY_LAYOUT_WORLD_ID, validDistrictIds } from "../lib/building-purpose.js";

describe("Landing pads (master-spec C11/C12)", () => {
  let db;

  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
  });

  it("landingPadsForWorld returns the real authored pads for concordia-hub", () => {
    const pads = landingPadsForWorld(CITY_LAYOUT_WORLD_ID);
    assert.ok(Array.isArray(pads));
    assert.ok(pads.length >= 3, `expected at least 3 authored landing pads, got ${pads.length}`);

    const ids = pads.map((p) => p.id).sort();
    assert.deepEqual(ids, [
      "landing-pad-industrial",
      "landing-pad-plaza-north",
      "landing-pad-riverside",
    ]);
  });

  it("every authored pad declares a valid district, a real name, and a real position", () => {
    const validDistricts = new Set(validDistrictIds());
    for (const pad of landingPadsForWorld(CITY_LAYOUT_WORLD_ID)) {
      assert.ok(validDistricts.has(pad.district_id), `pad ${pad.id} has invalid district_id ${pad.district_id}`);
      assert.ok(typeof pad.name === "string" && pad.name.trim().length > 0, `pad ${pad.id} has a real name`);
      assert.ok(typeof pad.purpose === "string" && pad.purpose.trim().length >= 12, `pad ${pad.id} has a real purpose`);
      assert.ok(pad.position && typeof pad.position.x === "number" && typeof pad.position.z === "number");
      assert.ok(typeof pad.radius_m === "number" && pad.radius_m > 0, `pad ${pad.id} has a positive radius_m`);
    }
  });

  it("landingPadsForWorld returns an honest empty array for an unauthored world", () => {
    assert.deepEqual(landingPadsForWorld("some-other-world"), []);
    assert.deepEqual(landingPadsForWorld("w1"), []);
  });

  it("exportScene carries the real landing pads without breaking the existing shape", () => {
    const s = exportScene(db, "concordia-hub");
    assert.equal(s.ok, true);
    assert.equal(s.format, SCENE_FORMAT);
    assert.ok(Array.isArray(s.districts), "existing districts contract unchanged");
    assert.ok(Array.isArray(s.landingPads), "landingPads is present and is an array");
    assert.equal(s.landingPads.length, landingPadsForWorld("concordia-hub").length);

    const plazaPad = s.landingPads.find((p) => p.id === "landing-pad-plaza-north");
    assert.ok(plazaPad, "the authored plaza skydock is present");
    assert.equal(plazaPad.district_id, "concordia-hub:plaza");
    assert.equal(plazaPad.position.x, 0);
    assert.equal(plazaPad.position.z, 280);
  });

  it("a world with no authored landing pads gets an honest empty array, never a guess", () => {
    const s = exportScene(db, "some-world-with-no-pads");
    assert.equal(s.ok, true);
    assert.deepEqual(s.landingPads, []);
  });

  it("no authored landing pad overlaps a real world_buildings footprint by coordinate", () => {
    // Positions were hand-chosen clear of every authored building (whose
    // max abs coordinate elsewhere in city-layout.json is 236) — assert
    // that invariant holds numerically rather than just by eyeballing it.
    for (const pad of landingPadsForWorld(CITY_LAYOUT_WORLD_ID)) {
      assert.ok(
        Math.abs(pad.position.x) > 236 || Math.abs(pad.position.z) > 236,
        `pad ${pad.id} at (${pad.position.x}, ${pad.position.z}) sits inside the built-up building coordinate range`,
      );
    }
  });
});
