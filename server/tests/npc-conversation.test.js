// Pins the 2026-10-23 NPC conversation rebuild: NPCs who socialize talk to
// the nearest named person, in names, from what is true about them.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { composeExchange, backstorySentence } from "../lib/npc-conversation.js";
import { NPCSimulator, NPCAgent } from "../lib/npc-simulator.js";

const W = "talk-world";
let db;
const brain = async () => ({ handle: { generate: async () => "" } });

function agent(id, { archetype = "trader", name, faction = "guild", x = 0, z = 0, story } = {}) {
  db.prepare(`INSERT INTO world_npcs (id, world_id, npc_type, archetype, faction, level, state, current_location, narrative_context, spawn_method, is_dead)
              VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'world_seed', 0)`)
    .run(id, W, archetype, archetype, faction, JSON.stringify(name ? { name } : {}), JSON.stringify({ x, y: 0, z }),
      story ? JSON.stringify({ backstory: story }) : null);
  return new NPCAgent(db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(id), W, db, brain);
}

before(async () => {
  db = new Database(":memory:");
  await runMigrations(db);
});

test("an exchange uses names, the hour, and what the speaker is doing", () => {
  const lines = composeExchange(
    { id: "a", name: "Oswen Vellis", work: "blacksmith", faction: "guild", activity: "build_structure" },
    { id: "b", name: "Ivelle Reade", work: "healer", faction: "guild" },
    { segment: "dusk", seed: "s" },
  );
  assert.ok(lines.length >= 2);
  assert.match(lines[0].text, /Ivelle Reade/);
  assert.match(lines[1].text, /frame by the road/);
  assert.equal(lines.at(-1).from, "b", "the listener answers");
  assert.ok(lines.every((l) => !/\b[a-b]\b pauses/.test(l.text)));
});

test("a quest comes up in conversation, and the friend offers to ask around", () => {
  const lines = composeExchange(
    { id: "a", name: "Oswen Vellis", work: "blacksmith", faction: "guild", quest: "Iron ore for Oswen Vellis" },
    { id: "b", name: "Ivelle Reade", work: "healer", faction: "guild" },
  );
  assert.match(lines[1].text, /Iron ore for Oswen Vellis/);
  assert.match(lines[2].text, /ask around the guild/);
});

test("a past-tense backstory comes back as hearsay; others are not forced into speech", () => {
  assert.equal(backstorySentence(JSON.stringify({ backstory: "Answered every call for aid. Then more." })), "Answered every call for aid.");
  assert.equal(backstorySentence(JSON.stringify({ backstory: "Apprenticed to the lore-keepers of scholars_guild." })), "Apprenticed to the lore-keepers of scholars guild.", "faction ids read as words");
  const heard = composeExchange({ id: "a", name: "A", work: "healer", faction: "x", backstory: "Answered every call for aid." }, { id: "b", name: "B", work: "cook", faction: "y" });
  assert.match(heard.at(-1).text, /^People say you answered every call for aid\.$/);
  const noun = composeExchange({ id: "a", name: "A", work: "healer", faction: "x", backstory: "A familiar face in the guild." }, { id: "b", name: "B", work: "cook", faction: "y" });
  assert.ok(noun.every((l) => !/familiar face/.test(l.text)));
});

test("the simulator: a socializing NPC talks to the nearest named person, not a creature", async () => {
  const events = [];
  const prev = globalThis._concordREALTIME;
  globalThis._concordREALTIME = { io: { to: () => ({ emit: (ev, body) => events.push({ ev, body }) }) } };
  try {
    const sim = new NPCSimulator(W, db, brain);
    const speaker = agent("s1", { name: "Halvor Halfhand", archetype: "builder", x: 0, z: 0 });
    const deer = agent("d1", { name: "Deer", archetype: "creature:deer", x: 1, z: 1 });
    const near = agent("n1", { name: "Saoirse Greenfell", archetype: "warrior", x: 10, z: 0 });
    const far = agent("f1", { name: "Far Away", archetype: "cook", x: 500, z: 500 });
    sim._agents = [speaker, deer, near, far];
    speaker._lastAction = "socialize";
    near.needs.social = 0.2;
    await sim._tickNPCConversations(sim._agents, []);
    const row = db.prepare("SELECT npc_a, npc_b, messages_json FROM npc_conversations WHERE world_id = ?").get(W);
    assert.ok(row, "a conversation was recorded");
    assert.deepEqual([row.npc_a, row.npc_b].sort(), ["n1", "s1"]);
    const text = JSON.parse(row.messages_json).map((m) => m.text).join(" | ");
    assert.match(text, /Saoirse Greenfell/);
    assert.ok(near.needs.social > 0.2, "the listener's social need rose");
    const ev = events.find((e) => e.ev === "npc:conversation-bid");
    assert.ok(ev);
    assert.equal(ev.body.nameA, "Halvor Halfhand");
    assert.equal(ev.body.nameB, "Saoirse Greenfell");

    // Same pair again inside the cooldown: no second conversation.
    speaker._lastAction = "socialize";
    await sim._tickNPCConversations(sim._agents, []);
    assert.equal(db.prepare("SELECT count(*) n FROM npc_conversations WHERE world_id = ?").get(W).n, 1);
  } finally {
    globalThis._concordREALTIME = prev;
  }
});
