// server/tests/scene-export.test.js
//
// Engine Bridge (#29) — serializes REAL world_buildings rows into a neutral
// scene graph. No mock data: we insert real building rows and assert the
// exported transforms/bounds match them exactly. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { exportScene, sceneStats, SCENE_FORMAT } from "../lib/scene-export.js";
import registerSceneBridgeMacros from "../domains/scenebridge.js";

function building(db, id, worldId, fields) {
  const f = { building_type: "house", x: 0, y: 0, z: 0, rotation: 0, width: 10, depth: 10, height: 8, material: "stone", floors: 1, state: "standing", health_pct: 1, ...fields };
  db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, x, y, z, rotation, width, depth, height, material, floors, state, health_pct)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, worldId, f.building_type, f.x, f.y, f.z, f.rotation, f.width, f.depth, f.height, f.material, f.floors, f.state, f.health_pct);
}

describe("Engine Bridge / Scene Export (#29)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    building(db, "b1", "w1", { building_type: "forge", x: 10, y: 0, z: 20, rotation: 1.57, width: 12, depth: 8, height: 6, material: "steel" });
    building(db, "b2", "w1", { building_type: "house", x: -30, y: 0, z: -10, width: 10, depth: 10, height: 8 });
    building(db, "b3", "w1", { building_type: "tower", x: 0, y: 0, z: 0, state: "collapsed" });
    macros = new Map();
    registerSceneBridgeMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("serializes real buildings into glTF-style transform nodes", () => {
    const s = exportScene(db, "w1");
    assert.equal(s.ok, true);
    assert.equal(s.format, SCENE_FORMAT);
    assert.equal(s.count, 2, "collapsed building excluded by default");
    const forge = s.nodes.find((n) => n.id === "b1");
    assert.deepEqual(forge.transform.translation, [10, 0, 20]);
    assert.deepEqual(forge.transform.scale, [12, 6, 8], "scale = footprint w/h/d");
    assert.equal(forge.transform.rotationY, 1.57);
    assert.equal(forge.material, "steel");
    assert.equal(forge.type, "forge");
  });

  it("computes real world bounds from the footprints", () => {
    const s = exportScene(db, "w1");
    // forge spans x∈[4,16], house x∈[-35,-25]; min x = -35, max x = 16.
    assert.equal(s.bounds.min[0], -35);
    assert.equal(s.bounds.max[0], 16);
    assert.equal(s.bounds.max[1], 8, "max Y from the tallest building height");
  });

  it("can include collapsed buildings when asked", () => {
    const s = exportScene(db, "w1", { includeCollapsed: true });
    assert.equal(s.count, 3);
  });

  it("an empty world exports an honest empty scene", () => {
    const s = exportScene(db, "void");
    assert.equal(s.ok, true);
    assert.deepEqual(s.nodes, []);
    assert.equal(s.bounds, null);
  });

  it("scenebridge macros round-trip", async () => {
    const exp = await macros.get("scenebridge.export")({ db }, { worldId: "w1" });
    assert.equal(exp.count, 2);
    const stats = await macros.get("scenebridge.stats")({ db }, { worldId: "w1" });
    assert.equal(stats.total, 3);
    assert.equal(stats.byType.forge, 1);
  });
});
