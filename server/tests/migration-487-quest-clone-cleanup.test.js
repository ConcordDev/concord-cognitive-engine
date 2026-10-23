// Pins migration 487: removes quest-spawned clone NPCs and abandoned template
// quests, and nothing else — authored NPCs, player-accepted quests and
// unrelated rows stay.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { up } from "../migrations/487_remove_quest_clone_npcs_and_template_quests.js";

test("clones and template quests go; authored NPCs and player quests stay", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  const npc = db.prepare(`INSERT INTO world_npcs (id, world_id, npc_type, archetype, state, narrative_context, spawn_method, spawned_by_quest, is_dead)
                          VALUES (?, 'w', 'trader', 'trader', ?, ?, ?, ?, 0)`);
  npc.run("authored", JSON.stringify({ name: "Oswen Vellis" }), JSON.stringify({ backstory: "Kept the forge lit." }), "world_seed", null);
  npc.run("clone1", JSON.stringify({ name: "social" }), null, "quest", "q-old-1");
  npc.run("clone2", JSON.stringify({ name: "social" }), null, "recruited", "q-old-2");
  npc.run("storied-quest-npc", JSON.stringify({ name: "Kept" }), JSON.stringify({ backstory: "Has a story." }), "quest", "q-old-1");

  const quest = db.prepare(`INSERT INTO world_quests (id, world_id, giver_npc_id, title, status) VALUES (?, 'w', ?, ?, ?)`);
  quest.run("q-old-1", "authored", "Help trader with social", "available");
  quest.run("q-old-2", "clone1", "Help generic with social", "available");
  quest.run("q-player", "authored", "Help trader with social", "available");
  quest.run("q-good", "authored", "Word for Ivelle Reade", "available");
  quest.run("q-done", "authored", "Help trader with social", "completed");
  db.prepare("INSERT INTO player_quests (id, user_id, quest_id, world_id, status) VALUES ('pq', 'u', 'q-player', 'w', 'active')").run();
  db.prepare("INSERT INTO quest_objectives (id, quest_id, type, target, required_count, description, order_index) VALUES ('o1', 'q-old-1', 'talk_to', 'authored', 1, '', 0)").run();
  db.prepare("INSERT INTO quest_objectives (id, quest_id, type, target, required_count, description, order_index) VALUES ('o2', 'q-good', 'talk_to', 'authored', 1, '', 0)").run();
  db.prepare("INSERT INTO npc_jobs (id, npc_id, world_id, job_type) VALUES ('j1', 'clone1', 'w', 'merchant')").run();
  db.prepare("INSERT INTO npc_jobs (id, npc_id, world_id, job_type) VALUES ('j2', 'authored', 'w', 'blacksmith')").run();

  db.transaction(() => up(db))();

  const ids = (sql) => db.prepare(sql).all().map((r) => r.id).sort();
  assert.deepEqual(ids("SELECT id FROM world_npcs"), ["authored", "storied-quest-npc"]);
  assert.deepEqual(ids("SELECT id FROM world_quests"), ["q-done", "q-good", "q-player"]);
  assert.deepEqual(ids("SELECT id FROM quest_objectives"), ["o2"]);
  assert.deepEqual(ids("SELECT id FROM npc_jobs"), ["j2"]);

  // Idempotent.
  db.transaction(() => up(db))();
  assert.equal(db.prepare("SELECT count(*) n FROM world_npcs").get().n, 2);
});
