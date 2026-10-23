// Pins migration 489: legacy seed worlds' people move into the matching
// authored region; the old world rows are kept as 'merged' / 'retired' (not
// deleted, not simulated); places and history stay behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { up } from "../migrations/489_merge_legacy_seed_worlds.js";

test("merge moves people, keeps every world row, retires the two without a counterpart", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  const world = db.prepare("INSERT OR REPLACE INTO worlds (id, name, universe_type, status) VALUES (?, ?, 'x', 'active')");
  for (const id of ["crime", "crime-city", "fantasy", "fable-world", "superhero", "superhero-world", "war-zone", "wasteland-world", "concordia-hub"]) world.run(id, id);
  const npc = db.prepare("INSERT INTO world_npcs (id, world_id, npc_type, archetype, state, spawn_method, is_dead) VALUES (?, ?, 'trader', 'trader', '{}', 'world_seed', 0)");
  npc.run("cc1", "crime-city"); npc.run("cc2", "crime-city"); npc.run("fw1", "fable-world");
  npc.run("wz1", "war-zone"); npc.run("stray1", "concordia"); npc.run("c1", "crime");
  db.prepare("INSERT INTO npc_jobs (id, npc_id, world_id, job_type) VALUES ('j1', 'cc1', 'crime-city', 'merchant')").run();
  db.prepare("INSERT INTO world_quests (id, world_id, giver_npc_id, title) VALUES ('q1', 'crime-city', 'cc1', 'Word for X')").run();
  db.prepare("INSERT INTO world_buildings (id, world_id, building_type, name, x, y, z) VALUES ('b1', 'crime-city', 'house', 'Old house', 800, 0, 1000)").run();

  db.transaction(() => up(db))();

  const worldOf = (id) => db.prepare("SELECT world_id FROM world_npcs WHERE id = ?").get(id).world_id;
  assert.equal(worldOf("cc1"), "crime");
  assert.equal(worldOf("cc2"), "crime");
  assert.equal(worldOf("fw1"), "fantasy");
  assert.equal(worldOf("stray1"), "concordia-hub");
  assert.equal(worldOf("wz1"), "war-zone", "retired world keeps its people, dormant");
  assert.equal(db.prepare("SELECT world_id FROM npc_jobs WHERE id = 'j1'").get().world_id, "crime");
  assert.equal(db.prepare("SELECT world_id FROM world_quests WHERE id = 'q1'").get().world_id, "crime");
  assert.equal(db.prepare("SELECT world_id FROM world_buildings WHERE id = 'b1'").get().world_id, "crime-city", "places stay as history");

  const status = Object.fromEntries(db.prepare("SELECT id, status FROM worlds").all().map((r) => [r.id, r.status]));
  assert.equal(status["crime-city"], "merged");
  assert.equal(status["fable-world"], "merged");
  assert.equal(status["superhero-world"], "merged");
  assert.equal(status["war-zone"], "retired");
  assert.equal(status["wasteland-world"], "retired");
  assert.equal(status.crime, "active");
  assert.equal(db.prepare("SELECT count(*) n FROM worlds").get().n, 9, "no world row deleted");
  assert.equal(db.prepare("SELECT count(*) n FROM world_npcs").get().n, 6, "no NPC deleted");

  // Simulators only start for active worlds.
  const simulated = db.prepare("SELECT id FROM worlds WHERE status = 'active' ORDER BY id").all().map((r) => r.id);
  assert.deepEqual(simulated, ["concordia-hub", "crime", "fantasy", "superhero"]);

  // Idempotent.
  db.transaction(() => up(db))();
  assert.equal(worldOf("cc1"), "crime");
});
