import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedContent, _persistAuthoredNpcToWorld, getAllAuthoredNPCs } from "../lib/content-seeder.js";
import { seedWorldDensity, authoredHubNpcIds } from "../lib/world-density-seed.js";

describe("world density seed — authored only", () => {
  let db;
  let density;
  const authoredIds = authoredHubNpcIds();

  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");
    await runMigrations(db);
    await seedContent({ db });
    for (const npc of getAllAuthoredNPCs()) {
      const world = npc.world_id || "concordia-hub";
      if (world === "concordia-hub") _persistAuthoredNpcToWorld(db, npc, "concordia-hub");
    }
    density = seedWorldDensity(db, "concordia-hub");
  });

  it("knows the authored hub roster from content files", () => {
    assert.ok(authoredIds.length >= 8, "hub roster is a real authored set");
    assert.ok(authoredIds.includes("archivist_maren") || authoredIds.includes("lord_curator_asbir_thelane"));
  });

  it("persists at least the authored hub NPCs — no fabricated names", () => {
    const rows = db.prepare(`
      SELECT id, json_extract(state, '$.name') AS name
        FROM world_npcs WHERE world_id = 'concordia-hub' AND is_dead = 0
    `).all();
    assert.ok(rows.length >= authoredIds.length, `npcs ${rows.length} < authored ${authoredIds.length}`);
    const have = new Set(rows.map((r) => r.id));
    for (const id of authoredIds) assert.ok(have.has(id), `missing authored npc ${id}`);
    for (const r of rows) {
      if (!authoredIds.includes(r.id)) continue;
      if (!r.name) continue;
      assert.notEqual(r.name, "Citizen");
      assert.notEqual(r.name, "Guest");
    }
    assert.equal(density.invented, false);
  });

  it("seeds hub buildings through world-seeder, not a second writer", () => {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM world_buildings WHERE world_id = 'concordia-hub'`).get().n;
    assert.ok(n > 0, "hub has real seed buildings");
    assert.ok(density.buildings > 0);
  });

  it("writes npc_routine_state from authored daily_schedule", () => {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM npc_routine_state`).get().n;
    assert.ok(n > 0, "routines exist for authored schedules");
  });

  it("skips vehicles when no authored catalog exists", () => {
    assert.equal(density.vehiclesSkipped, true);
    assert.equal(density.vehicleReason, "no_authored_vehicles");
    const n = db.prepare(`SELECT COUNT(*) AS n FROM world_vehicles WHERE world_id = 'concordia-hub'`).get().n;
    assert.equal(n, 0);
  });
});
