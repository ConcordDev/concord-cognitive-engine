// Pins the 2026-10-22 event-loop fix: getNearbyNodes/getUndergroundNodes use a
// bounding-box query served by idx_rnodes_pos instead of scanning the whole
// world, and return exactly what the old full-scan + circle filter returned.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getNearbyNodes, getUndergroundNodes } from "../lib/world-gathering.js";

function mkDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_resource_nodes (
    id TEXT PRIMARY KEY, world_id TEXT NOT NULL, node_type TEXT NOT NULL, resource_id TEXT NOT NULL,
    resource_name TEXT NOT NULL, biome TEXT DEFAULT 'plains', x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
    depth REAL DEFAULT 0, quantity_remaining INTEGER NOT NULL DEFAULT 100, max_quantity INTEGER NOT NULL DEFAULT 100,
    quality TEXT DEFAULT 'common', difficulty INTEGER DEFAULT 1, respawn_hours INTEGER DEFAULT 24, respawn_at INTEGER,
    is_depleted INTEGER DEFAULT 0, last_gathered_by TEXT, last_gathered_at INTEGER, seeded INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()));
    CREATE INDEX idx_rnodes_pos ON world_resource_nodes(world_id, x, z);`);
  const ins = db.prepare("INSERT INTO world_resource_nodes (id, world_id, node_type, resource_id, resource_name, x, y, z, depth, is_depleted) VALUES (?,?,?,?,?,?,?,?,?,?)");
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 600; i++) {
    ins.run(`n${i}`, i % 3 ? "w1" : "w2", "tree", "wood", "Wood", rnd() * 400, 0, rnd() * 400, i % 5 === 0 ? 10 + rnd() * 20 : 0, i % 11 === 0 ? 1 : 0);
  }
  // Edge cases: exactly on the radius, exactly on a box corner (outside circle).
  ins.run("edge-on-radius", "w1", "tree", "wood", "Wood", 230, 0, 200, 0, 0);
  ins.run("edge-box-corner", "w1", "tree", "wood", "Wood", 230, 0, 230, 0, 0);
  return db;
}

// The pre-fix implementations, verbatim, as the oracle.
function oldNearby(db, worldId, x, z, radius) {
  const nodes = db.prepare("SELECT * FROM world_resource_nodes WHERE world_id = ? AND is_depleted = 0 AND depth = 0").all(worldId);
  const r2 = radius * radius;
  return nodes.filter((n) => { const dx = n.x - x, dz = n.z - z; return dx * dx + dz * dz <= r2; })
    .map((n) => ({ ...n, distance: Math.sqrt((n.x - x) ** 2 + (n.z - z) ** 2) }))
    .sort((a, b) => a.distance - b.distance);
}
function oldUnderground(db, worldId, x, z, depth) {
  const nodes = db.prepare("SELECT * FROM world_resource_nodes WHERE world_id = ? AND is_depleted = 0 AND depth > 0").all(worldId);
  const r2 = 25 * 25;
  return nodes.filter((n) => { const dx = n.x - x, dz = n.z - z; return dx * dx + dz * dz <= r2 && n.depth >= depth; })
    .sort((a, b) => a.depth - b.depth);
}

test("getNearbyNodes matches the old full-scan result exactly", () => {
  const db = mkDb();
  for (const [x, z, r] of [[200, 200, 30], [0, 0, 30], [399, 1, 50], [123.4, 321.9, 8], [200, 200, 0], [-500, -500, 30]]) {
    for (const w of ["w1", "w2", "nope"]) {
      assert.deepEqual(getNearbyNodes(db, w, x, z, r), oldNearby(db, w, x, z, r), `w=${w} x=${x} z=${z} r=${r}`);
    }
  }
  const ids = getNearbyNodes(db, "w1", 200, 200, 30).map((n) => n.id);
  assert.ok(ids.includes("edge-on-radius"), "a node exactly on the radius is included");
  assert.ok(!ids.includes("edge-box-corner"), "a box corner outside the circle is excluded");
});

test("getUndergroundNodes matches the old full-scan result exactly", () => {
  const db = mkDb();
  for (const [x, z, d] of [[200, 200, 0], [50, 350, 15], [399, 399, 0]]) {
    for (const w of ["w1", "w2"]) assert.deepEqual(getUndergroundNodes(db, w, x, z, d), oldUnderground(db, w, x, z, d));
  }
});

test("the nearby query is served by the position index, not a scan", () => {
  const db = mkDb();
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM world_resource_nodes WHERE world_id = ? AND x BETWEEN ? AND ? AND z BETWEEN ? AND ? AND is_depleted = 0 AND depth = 0")
    .all("w1", 0, 1, 0, 1).map((r) => r.detail).join(" ");
  assert.match(plan, /USING INDEX idx_rnodes_pos/);
});
