// Pins lib/npc-life.js (2026-10-23): NPCs level up from work and finished
// quests, improve a trade skill, and take + complete quests no player picked
// up. Live before this, levels never changed, npc_skills and
// npc_active_quests were empty, and the npc:level-up / npc:quest-* events the
// Unity client listens for were never sent.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  actionXp, levelAfterXp, xpForNpcLevel, tradeSkillFor,
  npcTakeOpenQuests, progressNpcQuest, activeNpcQuest, _resetNpcLifeForTest,
} from "../lib/npc-life.js";
import { addQuestObjectives } from "../lib/quests/quest-engine.js";
import { NPCSimulator, NPCAgent } from "../lib/npc-simulator.js";

const W = "life-world";
let db;

function npcRow(id, archetype, { level = 1, name } = {}) {
  db.prepare(`INSERT INTO world_npcs (id, world_id, npc_type, archetype, faction, level, state, spawn_method, is_dead)
              VALUES (?, ?, ?, ?, 'guild', ?, ?, 'world_seed', 0)`)
    .run(id, W, archetype, archetype, level, JSON.stringify({ name: name || id }));
  return db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(id);
}

function postQuest(id, giver, objectives, { hoursAgo = 30, xp = 60 } = {}) {
  db.prepare(`INSERT INTO world_quests (id, world_id, giver_npc_id, title, reward_json, created_at)
              VALUES (?, ?, ?, ?, ?, unixepoch() - ?)`).run(id, W, giver, id, JSON.stringify({ xp }), hoursAgo * 3600);
  addQuestObjectives(db, id, objectives);
}

before(async () => {
  db = new Database(":memory:");
  await runMigrations(db);
  npcRow("giver", "blacksmith", { name: "Oswen Vellis" });
  npcRow("lab", "laborer", { level: 3 });
  npcRow("deer", "creature:deer");
});
beforeEach(() => _resetNpcLifeForTest());

test("levels follow a slow quadratic curve and never go down", () => {
  assert.equal(xpForNpcLevel(1), 0);
  assert.equal(xpForNpcLevel(2), 80);
  assert.equal(xpForNpcLevel(5), 800);
  assert.equal(levelAfterXp(1, 79), 1);
  assert.equal(levelAfterXp(1, 80), 2);
  assert.equal(levelAfterXp(1, 800), 5);
  assert.equal(levelAfterXp(5, 0), 5, "a seeded level-5 NPC with 0 XP stays level 5");
  assert.equal(actionXp("rest"), 0);
  assert.ok(actionXp("build_structure") > 0);
  assert.equal(tradeSkillFor("blacksmith"), "smithing");
  assert.equal(tradeSkillFor("unknown_thing"), "labor");
});

test("an unclaimed supply run is taken by a fitting NPC; defeat quests and fresh quests are not", () => {
  postQuest("fresh", "giver", [{ type: "gather", target: "iron-ore", requiredCount: 2 }], { hoursAgo: 1 });
  postQuest("fight", "giver", [{ type: "defeat", target: "undead", requiredCount: 2 }]);
  postQuest("supply", "giver", [
    { type: "gather", target: "iron-ore", requiredCount: 2 },
    { type: "talk_to", target: "giver", requiredCount: 1 },
  ]);
  const agents = ["giver", "lab", "deer"].map((id) => {
    const r = db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(id);
    return { id: r.id, archetype: r.archetype, level: r.level, isConscious: false };
  });
  const taken = npcTakeOpenQuests(db, W, agents);
  assert.deepEqual(taken, [{ npcId: "lab", questId: "supply" }]);
  assert.equal(db.prepare("SELECT status, accepted_by FROM world_quests WHERE id='supply'").get().accepted_by, "npc:lab");
  assert.equal(db.prepare("SELECT status FROM world_quests WHERE id='fight'").get().status, "available");
  assert.equal(db.prepare("SELECT status FROM world_quests WHERE id='fresh'").get().status, "available");
});

test("the quest moves only with matching actions, then completes and pays XP", () => {
  postQuest("q2", "giver", [
    { type: "gather", target: "iron-ore", requiredCount: 2 },
    { type: "talk_to", target: "giver", requiredCount: 1 },
  ], { xp: 70 });
  const agents = [{ id: "lab", archetype: "laborer", level: 3 }];
  db.prepare("UPDATE world_quests SET status = 'completed' WHERE id = 'supply'").run();
  assert.equal(npcTakeOpenQuests(db, W, agents).length, 1);
  assert.equal(progressNpcQuest(db, "lab", "rest"), null, "resting does nothing");
  assert.equal(progressNpcQuest(db, "lab", "socialize"), null, "talking doesn't gather ore");
  assert.equal(progressNpcQuest(db, "lab", "gather_resource").completed, false);
  assert.equal(activeNpcQuest("lab").step, 0);
  assert.equal(progressNpcQuest(db, "lab", "gather_resource").completed, false);
  assert.equal(activeNpcQuest("lab").step, 1, "two gathers finish the gather step");
  const done = progressNpcQuest(db, "lab", "socialize");
  assert.deepEqual({ completed: done.completed, xp: done.xp, need: done.need, giverId: done.giverId }, { completed: true, xp: 70, need: "purpose", giverId: "giver" });
  assert.equal(db.prepare("SELECT status FROM world_quests WHERE id='q2'").get().status, "completed");
  assert.equal(db.prepare("SELECT status FROM npc_active_quests WHERE quest_id='q2'").get().status, "completed");
  assert.equal(activeNpcQuest("lab"), null);
});

test("the simulator flush writes XP, levels up, improves the trade skill and announces it", () => {
  const events = [];
  const prev = globalThis._concordREALTIME;
  globalThis._concordREALTIME = { io: { to: (room) => ({ emit: (ev, body) => events.push({ room, ev, body }) }) } };
  try {
    const sim = new NPCSimulator(W, db, async () => ({ handle: { generate: async () => "" } }));
    const row = npcRow("smith", "blacksmith", { level: 1, name: "Halvor Halfhand" });
    const a = new NPCAgent(row, W, db, async () => ({ handle: { generate: async () => "" } }));
    sim._agents = [a];
    a._pendingXp = 85;
    a._pendingSkillXp = 6;
    a._persistState();
    sim._flushPendingPersists();
    const r = db.prepare("SELECT xp, level FROM world_npcs WHERE id = 'smith'").get();
    assert.deepEqual(r, { xp: 85, level: 2 });
    assert.equal(a.level, 2);
    const skill = db.prepare("SELECT skill_id, xp FROM npc_skills WHERE npc_id = 'smith'").get();
    assert.deepEqual(skill, { skill_id: "smithing", xp: 6 });
    const lvl = events.find((e) => e.ev === "npc:level-up");
    assert.ok(lvl, JSON.stringify(events));
    assert.equal(lvl.room, `world:${W}`);
    assert.deepEqual({ npcId: lvl.body.npcId, from: lvl.body.from, level: lvl.body.level, name: lvl.body.name }, { npcId: "smith", from: 1, level: 2, name: "Halvor Halfhand" });
  } finally {
    globalThis._concordREALTIME = prev;
  }
});
