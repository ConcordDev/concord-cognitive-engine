// Pins the 2026-10-23 needs-economy fix. Nothing restored hunger or safety,
// so once hunger hit 0 it was always the most urgent need and its action
// (gather_resource) never restored it: live, 5,314 of 5,366 NPCs were stuck
// gathering forever with social and safety pinned at 0, which in turn
// drove the endless "Help X with social" / "Trouble near X" quests.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { NPCAgent } from "../lib/npc-simulator.js";

const brain = async () => ({ handle: { generate: async () => "" } });

async function agentWithZeroNeeds(db, id, archetype) {
  const needs = { hunger: 0, rest: 0, social: 0, purpose: 0, safety: 0 };
  db.prepare(`INSERT INTO world_npcs (id, world_id, npc_type, archetype, level, state, current_location, spawn_method, is_dead)
              VALUES (?, 'w', ?, ?, 1, ?, '{"x":0,"y":0,"z":0}', 'world_seed', 0)`)
    .run(id, archetype, archetype, JSON.stringify({ name: `N ${id}`, needs }));
  return new NPCAgent(db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(id), "w", db, brain);
}

test("an NPC with every need at 0 recovers and lives a varied day instead of gathering forever", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  const a = await agentWithZeroNeeds(db, "n1", "trader");
  const actions = new Map();
  for (let i = 0; i < 80; i++) {
    a._updateNeeds();
    const act = await a._chooseAction();
    await a._executeAction(act);
    actions.set(act.action, (actions.get(act.action) || 0) + 1);
  }
  for (const k of ["eat", "rest", "socialize"]) assert.ok(actions.get(k) > 0, `${k} happened: ${JSON.stringify([...actions])}`);
  assert.ok((actions.get("gather_resource") || 0) < 40, `not stuck gathering: ${JSON.stringify([...actions])}`);
  for (const k of ["hunger", "rest", "social", "safety"]) assert.ok(a.needs[k] > 0, `${k} recovered above 0: ${JSON.stringify(a.needs)}`);
});

test("animals restore hunger by foraging", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  const deer = await agentWithZeroNeeds(db, "d1", "creature:deer");
  await deer._executeAction({ action: "gather_resource" });
  assert.ok(deer.needs.hunger > 0);
});

test("a world-tick walks NPCs for the real time since the last tick, not a fixed 3 s", async () => {
  const { NPCSimulator } = await import("../lib/npc-simulator.js");
  const db = new Database(":memory:");
  await runMigrations(db);
  const a = await agentWithZeroNeeds(db, "walker", "guard");
  a.needs = { hunger: 1, rest: 1, social: 1, purpose: 1, safety: 1 };
  a.state.currentPath = [{ x: 20, z: 0 }, { x: 40, z: 0 }, { x: 50, z: 0 }];
  a.state.pathIndex = 0;
  const sim = new NPCSimulator("w", db, brain);
  sim._tickRate = 60_000;
  sim._agents = [a];
  sim._lastWorldTickAt = Date.now() - 60_000; // the world last ticked a minute ago
  await sim._tickWorld();
  assert.ok(a.location.x >= 49, `a 50 m walk finishes within a one-minute tick (x=${a.location.x})`);
});
