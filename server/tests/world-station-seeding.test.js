// Lens-as-Station world placement — the civic ring is seeded into world_buildings
// at logical, lore-backed spots, idempotently, and every station building_type
// has a matching interior template. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedWorldContent } from "../lib/world-seeder.js";
import { ROOM_TEMPLATES } from "../lib/building-interiors.js";

const STATIONS = [
  "courthouse", "cartographer_table", "code_terminal", "trading_floor",
  "ledger_desk", "music_booth", "clinic", "post_office",
];

describe("Lens-as-Station world placement", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    seedWorldContent(db, "concordia-hub", "standard");
  });

  it("places all 8 lens-station buildings as world-owned seed buildings", () => {
    const rows = db.prepare(
      `SELECT building_type, name, x, z, owner_type, is_seed FROM world_buildings
       WHERE world_id = 'concordia-hub' AND building_type IN (${STATIONS.map(() => "?").join(",")})`
    ).all(...STATIONS);
    assert.equal(rows.length, 8, "one of each station");
    for (const r of rows) {
      assert.equal(r.owner_type, "world");
      assert.equal(r.is_seed, 1);
      assert.ok(r.name && r.name.length > 0, "lore-backed name present");
    }
  });

  it("places them in a ring around the city centre (800,1000), not on top of each other", () => {
    const rows = db.prepare(
      `SELECT building_type, x, z FROM world_buildings
       WHERE world_id = 'concordia-hub' AND building_type IN (${STATIONS.map(() => "?").join(",")})`
    ).all(...STATIONS);
    const seen = new Set();
    for (const r of rows) {
      assert.ok(Math.abs(r.x - 800) <= 80 && Math.abs(r.z - 1000) <= 80, `${r.building_type} near centre`);
      const key = `${Math.round(r.x)},${Math.round(r.z)}`;
      assert.ok(!seen.has(key), `${r.building_type} has a distinct position`);
      seen.add(key);
    }
  });

  it("every station building_type has a matching interior template (designs are real)", () => {
    for (const t of STATIONS) {
      assert.ok(ROOM_TEMPLATES[t], `${t} has a ROOM_TEMPLATES interior`);
      assert.ok(ROOM_TEMPLATES[t].width > 0 && ROOM_TEMPLATES[t].depth > 0);
    }
  });

  it("is idempotent — re-seeding does not duplicate stations", () => {
    seedWorldContent(db, "concordia-hub", "standard");
    seedWorldContent(db, "concordia-hub", "standard");
    const n = db.prepare(
      `SELECT COUNT(*) AS n FROM world_buildings
       WHERE world_id = 'concordia-hub' AND building_type IN (${STATIONS.map(() => "?").join(",")})`
    ).get(...STATIONS).n;
    assert.equal(n, 8, "still exactly 8 after re-runs");
  });

  it("back-fills a world that already has a seed city but no stations", () => {
    // Simulate an existing world: a seed building exists, so _seedCity is skipped,
    // but the station pass must still place the ring.
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, name, x, y, z, width, depth, height, material, floors, owner_type, is_seed)
                VALUES ('pre1','legacy-world','inn','Old Inn',800,40,1000,14,12,8,'stone',1,'world',1)`).run();
    const r = seedWorldContent(db, "legacy-world", "standard");
    assert.equal(r.buildings, 0, "city skipped (already seeded)");
    assert.equal(r.stations, 8, "but stations back-filled");
  });
});
