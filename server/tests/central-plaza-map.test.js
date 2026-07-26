// server/tests/central-plaza-map.test.js
//
// Master-spec A1 — Central Plaza system. Pins two additive, honest-by-
// construction surfaces built on top of the REAL district geometry
// (migration 374, server/lib/districts.js) and the REAL authored building
// purposes (server/lib/building-purpose.js, sourced from
// content/world/concordia-hub/city-layout.json):
//
//   1. `exportScene`'s additive `plaza` field — a locator (districtId, name,
//      real polygon centroid) for the one district seeded with key "plaza".
//   2. The new `scenebridge.map` macro — the district+building directory a
//      Godot/Three.js client renders as an orientation UI.
//
// No mock data: districts come from the real seeded rows, buildings come
// from the real authored city-layout.json. A world with no authored layout
// gets honest empty/null results, never fabricated ones.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedDefaultDistricts, listDistricts } from "../lib/districts.js";
import { exportScene, SCENE_FORMAT } from "../lib/scene-export.js";
import registerSceneBridgeMacros from "../domains/scenebridge.js";

describe("Central Plaza system (master-spec A1)", () => {
  let db, macros;

  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    seedDefaultDistricts(db, "concordia-hub");
    macros = new Map();
    registerSceneBridgeMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("exportScene carries a plaza locator without breaking the existing shape", () => {
    const s = exportScene(db, "concordia-hub");
    assert.equal(s.ok, true);
    assert.equal(s.format, SCENE_FORMAT);
    assert.ok(Array.isArray(s.districts), "existing districts contract unchanged");
    assert.ok(s.plaza, "plaza locator present for concordia-hub");
    assert.equal(s.plaza.districtId, "concordia-hub:plaza");
    assert.match(s.plaza.name, /Plaza/i);
    // The seeded plaza district is a 140x140 rect centered on the origin
    // (rect(0, 0, 70, 70) in districts.js) — its real centroid is (0, 0).
    assert.deepEqual(s.plaza.position, [0, 0, 0]);
  });

  it("a world with no recorded plaza district gets an honest null, never a guess", () => {
    const s = exportScene(db, "some-world-with-no-districts");
    assert.equal(s.ok, true);
    assert.equal(s.plaza, null);
  });

  it("scenebridge.map returns a real district+building directory", async () => {
    const map = await macros.get("scenebridge.map")({ db }, { worldId: "concordia-hub" });
    assert.equal(map.ok, true);
    assert.equal(map.worldId, "concordia-hub");
    assert.equal(map.authored, true);

    // Every geometric district is represented (6 authored + real rows).
    const geometric = listDistricts(db, "concordia-hub");
    assert.equal(map.districts.length, geometric.length);
    assert.ok(map.districts.length >= 5);

    // Plaza is identified and matches exportScene's locator.
    assert.ok(map.plaza);
    assert.equal(map.plaza.districtId, "concordia-hub:plaza");
    assert.equal(map.plaza.concept, "Social");

    // Every district entry carries real geometry fields (not fabricated).
    for (const d of map.districts) {
      assert.equal(typeof d.districtId, "string");
      assert.ok(d.name, `district ${d.districtId} has a real name`);
      assert.ok(d.palette && d.palette.primary, `district ${d.districtId} has a real palette`);
      assert.ok(Array.isArray(d.buildings));
      assert.equal(d.buildingCount, d.buildings.length);
    }

    // The plaza district's buildings are the real authored ones (Forum,
    // Agora, Community Hall, ...) — never invented.
    const plazaDistrict = map.districts.find((d) => d.districtId === "concordia-hub:plaza");
    assert.ok(plazaDistrict.buildings.length > 0, "plaza has real authored buildings");
    const forum = plazaDistrict.buildings.find((b) => b.id === "station-forum_hall");
    assert.ok(forum, "the authored Forum building is present");
    assert.equal(forum.lens, "forum");

    // totalBuildings sums every district's buildingCount.
    const summed = map.districts.reduce((s, d) => s + d.buildingCount, 0);
    assert.equal(map.totalBuildings, summed);
  });

  it("scenebridge.map on an unauthored world returns an honest empty directory", async () => {
    const map = await macros.get("scenebridge.map")({ db }, { worldId: "some-unauthored-world" });
    assert.equal(map.ok, true);
    assert.equal(map.authored, false);
    assert.equal(map.plaza, null);
    assert.deepEqual(map.districts, []);
    assert.equal(map.totalBuildings, 0);
  });

  it("scenebridge.map without a db is an honest failure, not a fabricated map", async () => {
    const map = await macros.get("scenebridge.map")({}, { worldId: "concordia-hub" });
    assert.equal(map.ok, false);
    assert.equal(map.reason, "no_db");
  });
});
