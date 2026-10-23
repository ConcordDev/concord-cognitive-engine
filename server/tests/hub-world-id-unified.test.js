// Pins the hub-id unification (2026-10-23): one hub id, "concordia-hub", in
// code (lib/world-ids.js) and data (migration 490).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { up } from "../migrations/490_unify_hub_world_id.js";
import { HUB_WORLD_ID, canonicalWorldId, isHubWorld } from "../lib/world-ids.js";
import { HUB_WORLD, getCurrentWorld } from "../lib/world-travel.js";

test("one hub id, with the old one accepted as an alias", () => {
  assert.equal(HUB_WORLD_ID, "concordia-hub");
  assert.equal(HUB_WORLD, HUB_WORLD_ID);
  assert.equal(canonicalWorldId("concordia"), "concordia-hub");
  assert.equal(canonicalWorldId("crime"), "crime");
  assert.ok(isHubWorld("concordia") && isHubWorld("concordia-hub") && !isHubWorld("fantasy"));
});

test("migration 490 moves hub data, keeps conflicting rows as history, and maps the old default", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  db.prepare("INSERT INTO users (id, username, email, password_hash, role, current_world, created_at) VALUES ('u1','u1','u1@x.test','x','member','concordia', datetime('now'))").run();
  db.prepare("INSERT INTO world_npcs (id, world_id, npc_type, archetype, state, is_dead) VALUES ('n1','concordia','trader','trader','{}',0)").run();
  db.prepare("INSERT INTO world_economy_state (world_id) VALUES ('concordia')").run();
  db.prepare("INSERT INTO world_economy_state (world_id) VALUES ('concordia-hub')").run();

  db.transaction(() => up(db))();

  assert.equal(db.prepare("SELECT current_world FROM users WHERE id='u1'").get().current_world, "concordia-hub");
  assert.equal(getCurrentWorld(db, "u1"), "concordia-hub");
  assert.equal(db.prepare("SELECT world_id FROM world_npcs WHERE id='n1'").get().world_id, "concordia-hub");
  // Unique per world: the hub keeps its own row, the old one stays as history.
  assert.deepEqual(db.prepare("SELECT world_id FROM world_economy_state ORDER BY world_id").all().map((r) => r.world_id), ["concordia", "concordia-hub"]);

  // A new user created with the column's old DEFAULT lands in the hub.
  db.prepare("INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES ('u2','u2','u2@x.test','x','member', datetime('now'))").run();
  assert.equal(db.prepare("SELECT current_world FROM users WHERE id='u2'").get().current_world, "concordia-hub");

  // Idempotent.
  db.transaction(() => up(db))();
});

test("travelling to the old hub id lands in concordia-hub", async () => {
  const { travelTo } = await import("../lib/world-travel.js");
  const db = new Database(":memory:");
  await runMigrations(db);
  db.prepare("INSERT INTO users (id, username, email, password_hash, role, current_world, created_at) VALUES ('t1','t1','t1@x.test','x','member','fantasy', datetime('now'))").run();
  const r = travelTo(db, "t1", "concordia");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.toWorld, "concordia-hub");
  assert.equal(getCurrentWorld(db, "t1"), "concordia-hub");
});

test("no server code defaults a world to the bare old hub id", () => {
  const files = ["lib/world-travel.js", "lib/world-event-scheduler.js", "lib/vehicles.js", "lib/coop-mechanics.js",
    "lib/procedural-creature.js", "lib/creature-crossbreeding.js", "lib/concord-link-walkers.js", "lib/concordia-humanoid-gait.js"];
  for (const f of files) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /(worldId|world|worlds|HUB_WORLD|homeWorld|childWorld)\s*[=:?|]+\s*\[?\s*["']concordia["']/, f);
  }
});
