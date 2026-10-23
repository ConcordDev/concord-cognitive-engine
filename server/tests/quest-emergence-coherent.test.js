// Pins the 2026-10-23 quest-emergence rebuild. Live, NPC needs had produced
// 53,962 "Help <archetype> with social" quests (none accepted) and 9,813
// identical "social" trader NPCs. Quests must now be built from real world
// state, one open quest per giver, only where players are, and completable
// through objective types the game actually tracks.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { detectQuestOpportunities, planQuest, questGate, expireStaleQuests } from "../lib/quest-emergence.js";
import { recordObjectiveProgress, checkQuestCompletion } from "../lib/quests/quest-engine.js";

let db;
const W = "qe-world";

function npc(id, { archetype = "trader", name, faction = "guild", spawn = "world_seed", world = W, story } = {}) {
  db.prepare(`INSERT INTO world_npcs (id, world_id, npc_type, archetype, faction, level, state, narrative_context, spawn_method, is_dead)
              VALUES (?, ?, ?, ?, ?, 2, ?, ?, ?, 0)`)
    .run(id, world, archetype, archetype, faction, JSON.stringify(name ? { name } : {}),
      story ? JSON.stringify({ backstory: story }) : null, spawn);
}

before(async () => {
  db = new Database(":memory:");
  await runMigrations(db);
  npc("giver", { archetype: "blacksmith", name: "Oswen Vellis", story: "Kept the forge lit through the long winter. Owes nobody." });
  npc("friend", { archetype: "healer", name: "Ivelle Reade" });
  npc("clone", { archetype: "trader", name: "social", spawn: "quest" });
  npc("deer", { archetype: "creature:deer", name: "Deer" });
  npc("ghoul", { archetype: "undead", name: "Ghoul" });
  npc("nameless", { archetype: "farmer" });
  for (const [i, r] of ["iron-ore", "iron-ore", "stone"].entries()) {
    db.prepare(`INSERT INTO world_resource_nodes (id, world_id, node_type, resource_id, resource_name, x, y, z, is_depleted, depth) VALUES (?, ?, 'ore', ?, ?, ?, 0, ?, 0, 0)`).run(`node${i}`, W, r, r, i, i);
  }
});

function seePlayer(world, ago = "-1 hours") {
  db.prepare(`INSERT OR REPLACE INTO player_world_state (user_id, world_id, last_seen_at) VALUES ('p1', ?, datetime('now', ?))`).run(world, ago);
}

test("no quests in a world no player has been in", async () => {
  const q = await detectQuestOpportunities({ id: "giver", worldId: W, needs: { social: 0.1 } }, db);
  assert.deepEqual(q, []);
  assert.equal(questGate(db, db.prepare("SELECT * FROM world_npcs WHERE id='giver'").get()), "no_recent_player");
});

test("creatures, monsters, clones and nameless NPCs never give quests", () => {
  seePlayer(W);
  const row = (id) => db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(id);
  assert.equal(questGate(db, row("deer")), "not_a_person");
  assert.equal(questGate(db, row("ghoul")), "not_a_person");
  assert.equal(questGate(db, row("clone")), "quest_spawned_npc");
  assert.equal(questGate(db, row("nameless")), "unnamed");
});

test("a social need becomes 'carry word' to a real friend, with tracked objectives", async () => {
  const [q] = await detectQuestOpportunities({ id: "giver", worldId: W, needs: { social: 0.1 } }, db);
  assert.ok(q, "quest created");
  assert.equal(q.title, "Word for Ivelle Reade");
  assert.match(q.description, /^Oswen Vellis the blacksmith .* Ivelle Reade the healer/);
  assert.match(q.description, /Kept the forge lit through the long winter\./, "uses the authored backstory");
  const objs = db.prepare("SELECT type, target, required_count FROM quest_objectives WHERE quest_id = ? ORDER BY order_index").all(q.id);
  assert.deepEqual(objs, [
    { type: "talk_to", target: "friend", required_count: 1 },
    { type: "talk_to", target: "giver", required_count: 1 },
  ]);
  assert.equal(db.prepare("SELECT count(*) n FROM world_npcs").get().n, 6, "no NPC was spawned for the quest");
});

test("one open quest per giver", async () => {
  const again = await detectQuestOpportunities({ id: "giver", worldId: W, needs: { social: 0.1 } }, db);
  assert.deepEqual(again, []);
});

test("a purpose need asks for a resource that has nodes in this world", () => {
  const giver = db.prepare("SELECT * FROM world_npcs WHERE id='giver'").get();
  const plan = planQuest(db, giver, "purpose");
  assert.equal(plan.objectives[0].type, "gather");
  assert.equal(plan.objectives[0].target, "iron-ore", "blacksmith wants iron, and this world has it");
  assert.match(plan.title, /^Iron ore for Oswen Vellis$/);
});

test("a safety need targets a hostile archetype alive in this world", () => {
  const giver = db.prepare("SELECT * FROM world_npcs WHERE id='giver'").get();
  const plan = planQuest(db, giver, "safety");
  assert.equal(plan.objectives[0].type, "defeat");
  assert.equal(plan.objectives[0].target, "undead");
});

test("completing the objectives closes the posted quest so the giver can post again", () => {
  const q = db.prepare("SELECT * FROM world_quests WHERE giver_npc_id = 'giver'").get();
  db.prepare("UPDATE world_quests SET status = 'active', accepted_by = 'p1' WHERE id = ?").run(q.id);
  db.prepare("INSERT INTO player_quests (id, user_id, quest_id, world_id, status) VALUES ('pq1', 'p1', ?, ?, 'active')").run(q.id, W);
  recordObjectiveProgress(db, "p1", W, null, "talk_to", "friend", 1);
  recordObjectiveProgress(db, "p1", W, null, "talk_to", "giver", 1);
  assert.equal(checkQuestCompletion(db, "p1", W, q.id), true);
  assert.equal(db.prepare("SELECT status FROM world_quests WHERE id = ?").get(q.id).status, "completed");
  assert.equal(questGate(db, db.prepare("SELECT * FROM world_npcs WHERE id='giver'").get()), null);
});

test("unaccepted quests expire after the TTL", () => {
  db.prepare(`INSERT INTO world_quests (id, world_id, giver_npc_id, title, created_at) VALUES ('old', ?, 'friend', 'old', unixepoch() - 10 * 86400)`).run(W);
  assert.equal(expireStaleQuests(db, { force: true }), 1);
  assert.equal(db.prepare("SELECT status FROM world_quests WHERE id='old'").get().status, "expired");
});
