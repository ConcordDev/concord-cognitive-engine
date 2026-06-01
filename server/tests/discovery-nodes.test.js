// G4 (investigation → resources) + G5 (exploration caches). Both reveal a rare
// world_resource_nodes row from a trigger: G4 on a solved crime (at the scene),
// G5 on a procgen region (at its anchor, keyed to region kind). Idempotent;
// kill-switched; degrade gracefully without tables.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { spawnInvestigationNode, spawnRegionCache, REGION_CACHE } from "../lib/discovery-nodes.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_resource_nodes (
      id TEXT PRIMARY KEY, world_id TEXT, node_type TEXT, resource_id TEXT, resource_name TEXT, biome TEXT,
      x REAL, y REAL, z REAL, depth REAL, quantity_remaining INTEGER, max_quantity INTEGER, quality INTEGER,
      difficulty INTEGER, respawn_hours INTEGER, seeded INTEGER
    );
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, x REAL, z REAL);
  `);
  db.prepare("INSERT INTO world_buildings VALUES ('scene1', 300, 400)").run();
  return db;
}
const node = (db, id) => db.prepare("SELECT * FROM world_resource_nodes WHERE id=?").get(id);

describe("G4 — investigation → resources", () => {
  afterEach(() => { delete process.env.CONCORD_INVESTIGATION_LOOT; });

  it("a solved crime reveals a rare node at the scene", () => {
    const db = freshDb();
    const r = spawnInvestigationNode(db, { worldId: "sere", crimeId: "c1", locationId: "scene1" });
    assert.equal(r.ok, true);
    const n = node(db, "disc_crime_c1");
    assert.equal(n.node_type, "investigation_cache");
    assert.equal(n.resource_id, "soul_essence");
    assert.equal(n.quality, 4);
    assert.equal(n.x, 300); assert.equal(n.z, 400);
  });

  it("is idempotent + kill-switchable", () => {
    const db = freshDb();
    spawnInvestigationNode(db, { worldId: "sere", crimeId: "c1", locationId: "scene1" });
    assert.equal(spawnInvestigationNode(db, { worldId: "sere", crimeId: "c1", locationId: "scene1" }).ok, false);
    process.env.CONCORD_INVESTIGATION_LOOT = "0";
    assert.equal(spawnInvestigationNode(db, { worldId: "sere", crimeId: "c2", locationId: "scene1" }).reason, "disabled");
  });
});

describe("G5 — exploration caches", () => {
  afterEach(() => { delete process.env.CONCORD_EXPLORATION_CACHE; });

  it("a region hides a cache at its anchor, keyed to its kind", () => {
    const db = freshDb();
    const r = spawnRegionCache(db, { worldId: "sere", regionId: "pgr1", regionKind: "haunted_glade", x: 10, z: 20 });
    assert.equal(r.ok, true);
    const n = node(db, "disc_region_pgr1");
    assert.equal(n.node_type, "exploration_cache");
    assert.equal(n.resource_id, REGION_CACHE.haunted_glade.resourceId);
    assert.equal(n.x, 10); assert.equal(n.z, 20);
  });

  it("unknown region kind falls back to a default cache; kill-switchable", () => {
    const db = freshDb();
    assert.equal(spawnRegionCache(db, { worldId: "sere", regionId: "pgr2", regionKind: "weird", x: 1, z: 1 }).ok, true);
    assert.ok(node(db, "disc_region_pgr2"));
    process.env.CONCORD_EXPLORATION_CACHE = "0";
    assert.equal(spawnRegionCache(db, { worldId: "sere", regionId: "pgr3", regionKind: "haunted_glade", x: 1, z: 1 }).reason, "disabled");
  });

  it("degrades to no-op without the nodes table", () => {
    const db = new Database(":memory:");
    assert.equal(spawnRegionCache(db, { worldId: "sere", regionId: "x", regionKind: "silent_field", x: 0, z: 0 }).ok, false);
  });
});
