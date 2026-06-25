// Lens-as-Station world placement — the district ring is seeded into
// world_buildings, idempotently and non-overlapping, every station building_type
// has a matching interior template, and the set scales by data alone. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedWorldContent, stationTypes } from "../lib/world-seeder.js";
import { ROOM_TEMPLATES } from "../lib/building-interiors.js";

const STATIONS = stationTypes();

describe("Lens-as-Station world placement", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    seedWorldContent(db, "concordia-hub", "standard");
  });

  it("places every lens-station as a world-owned seed building with a lore name", () => {
    const rows = db.prepare(
      `SELECT building_type, name, owner_type, is_seed FROM world_buildings
       WHERE world_id = 'concordia-hub' AND building_type IN (${STATIONS.map(() => "?").join(",")})`
    ).all(...STATIONS);
    assert.equal(rows.length, STATIONS.length, "one of each station");
    assert.ok(STATIONS.length >= 24, "scaled well beyond the initial flagships");
    for (const r of rows) {
      assert.equal(r.owner_type, "world");
      assert.equal(r.is_seed, 1);
      assert.ok(r.name && r.name.length > 0, "lore-backed name present");
    }
  });

  it("auto-places them on a ring around the centre — distinct, non-overlapping spots", () => {
    const rows = db.prepare(
      `SELECT building_type, x, z, width, depth FROM world_buildings
       WHERE world_id = 'concordia-hub' AND building_type IN (${STATIONS.map(() => "?").join(",")})`
    ).all(...STATIONS);
    // Distinct positions + a minimum centre-to-centre clearance so footprints don't collide.
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i];
      assert.ok(Math.hypot(a.x - 800, a.z - 1000) >= 50, `${a.building_type} sits outside the core cluster`);
      for (let j = i + 1; j < rows.length; j++) {
        const b = rows[j];
        const gap = Math.hypot(a.x - b.x, a.z - b.z);
        assert.ok(gap >= 18, `${a.building_type} vs ${b.building_type} clearance ${gap.toFixed(1)} too tight`);
      }
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
    assert.equal(n, STATIONS.length, "still exactly one of each after re-runs");
  });

  it("back-fills a world that already has a seed city but no stations", () => {
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, name, x, y, z, width, depth, height, material, floors, owner_type, is_seed)
                VALUES ('pre1','legacy-world','inn','Old Inn',800,40,1000,14,12,8,'stone',1,'world',1)`).run();
    const r = seedWorldContent(db, "legacy-world", "standard");
    assert.equal(r.buildings, 0, "city skipped (already seeded)");
    assert.equal(r.stations, STATIONS.length, "but the full district ring is back-filled");
  });
});
