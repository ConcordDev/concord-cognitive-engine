// G3 — destruction -> salvage. A collapsed building spawns a scrap resource node
// scaled by its material; idempotent; only on collapse; kill-switched.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { spawnSalvageOnCollapse } from "../lib/building-salvage.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, material TEXT, state TEXT, x REAL, z REAL, biome TEXT);
    CREATE TABLE world_resource_nodes (
      id TEXT PRIMARY KEY, world_id TEXT, node_type TEXT, resource_id TEXT, resource_name TEXT, biome TEXT,
      x REAL, y REAL, z REAL, depth REAL, quantity_remaining INTEGER, max_quantity INTEGER, quality INTEGER,
      difficulty INTEGER, respawn_hours INTEGER, seeded INTEGER
    );
  `);
  db.prepare("INSERT INTO world_buildings VALUES ('steel_tower','sere','tower','steel','collapsed',100,200,'plains')").run();
  db.prepare("INSERT INTO world_buildings VALUES ('wood_hut','sere','house','wood','collapsed',10,20,'forest')").run();
  db.prepare("INSERT INTO world_buildings VALUES ('standing_inn','sere','inn','stone','standing',5,5,'plains')").run();
  return db;
}
const node = (db, id) => db.prepare("SELECT * FROM world_resource_nodes WHERE id=?").get(id);

describe("building salvage (G3)", () => {
  beforeEach(() => { process.env.CONCORD_SALVAGE = "1"; });
  afterEach(() => { delete process.env.CONCORD_SALVAGE; });

  it("a collapsed steel building yields a scrap-metal node at its position", () => {
    const db = freshDb();
    const r = spawnSalvageOnCollapse(db, "sere", "steel_tower");
    assert.equal(r.ok, true);
    assert.equal(r.resource, "scrap_metal");
    const n = node(db, "salvage_steel_tower");
    assert.equal(n.node_type, "scrap");
    assert.equal(n.x, 100); assert.equal(n.z, 200);
    assert.ok(n.quantity_remaining >= 40, "steel yields the most scrap");
  });

  it("material scales the scrap (wood < steel)", () => {
    const db = freshDb();
    spawnSalvageOnCollapse(db, "sere", "steel_tower");
    spawnSalvageOnCollapse(db, "sere", "wood_hut");
    assert.ok(node(db, "salvage_wood_hut").quantity_remaining < node(db, "salvage_steel_tower").quantity_remaining);
    assert.equal(node(db, "salvage_wood_hut").resource_id, "wood");
  });

  it("is idempotent — a re-collapse does not duplicate the node", () => {
    const db = freshDb();
    assert.equal(spawnSalvageOnCollapse(db, "sere", "steel_tower").ok, true);
    assert.equal(spawnSalvageOnCollapse(db, "sere", "steel_tower").ok, false, "second call no-ops");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM world_resource_nodes").get().n, 1);
  });

  it("only fires on a collapsed building, and respects world scope + kill-switch", () => {
    const db = freshDb();
    assert.equal(spawnSalvageOnCollapse(db, "sere", "standing_inn").ok, false, "standing building yields nothing");
    assert.equal(spawnSalvageOnCollapse(db, "tunya", "steel_tower").ok, false, "wrong world");
    process.env.CONCORD_SALVAGE = "0";
    assert.equal(spawnSalvageOnCollapse(db, "sere", "steel_tower").ok, false, "disabled");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM world_resource_nodes").get().n, 0);
  });
});
