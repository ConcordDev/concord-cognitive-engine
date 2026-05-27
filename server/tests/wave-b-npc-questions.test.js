// server/tests/wave-b-npc-questions.test.js
//
// Wave B / B1 — NPCs ask the player questions + gossip propagation.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";
import { recordInteraction, getMemory } from "../lib/npc-player-memory.js";
import { schedule } from "../lib/scheduled-consequences.js";
import gossipHandler from "../lib/consequence-handlers/gossip.js";
import { runConsequenceDispatcherCycle } from "../emergent/consequence-dispatcher-cycle.js";

let db;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      x REAL, z REAL, is_dead INTEGER DEFAULT 0,
      archetype TEXT, faction TEXT, name TEXT, family_name TEXT
    );
    CREATE TABLE npc_player_memories (
      npc_id TEXT NOT NULL, player_id TEXT NOT NULL, world_id TEXT NOT NULL,
      summary_json TEXT, sentiment REAL DEFAULT 0,
      sightings INTEGER DEFAULT 0, interactions INTEGER DEFAULT 0,
      first_met_at INTEGER DEFAULT (unixepoch()),
      last_interaction_at INTEGER DEFAULT (unixepoch()),
      last_summary_compiled_at INTEGER,
      PRIMARY KEY (npc_id, player_id)
    );
    CREATE TABLE npc_player_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, npc_id TEXT, player_id TEXT,
      world_id TEXT, kind TEXT, payload_json TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE scheduled_consequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, fires_at INTEGER NOT NULL,
      source_kind TEXT, source_id TEXT, target_kind TEXT, target_id TEXT,
      world_id TEXT, payload_json TEXT, fired_at INTEGER, fire_result TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  // Asker NPC + 3 neighbors within gossip radius + 1 far neighbor
  db.prepare(`INSERT INTO world_npcs (id, world_id, x, z, archetype) VALUES
    ('npc_asker',  'concordia', 10, 10, 'merchant'),
    ('npc_near_a', 'concordia', 15, 12, 'merchant'),
    ('npc_near_b', 'concordia',  8, 14, 'guard'),
    ('npc_near_c', 'concordia', 11, 11, 'scholar'),
    ('npc_far',    'concordia', 200, 200, 'farmer')
  `).run();
});

after(() => { db?.close(); });

describe("npcQuestion prompt composition", () => {
  it("composes a question that references the desire", () => {
    const out = TASK_PROMPTS.npcQuestion({
      npcName: "Mira",
      npcArchetype: "merchant",
      desire: "to know who killed my brother",
      lastTopic: "winter taxes",
      daysSinceLastSeen: 8,
    });
    assert.ok(out.includes("Mira"));
    assert.ok(out.includes("killed my brother"));
    assert.ok(out.includes("winter taxes"));
    assert.ok(out.includes("8 days"));
    assert.ok(out.endsWith("Just ask."));
  });

  it("handles missing optional fields", () => {
    const out = TASK_PROMPTS.npcQuestion({ npcName: "Mira" });
    assert.ok(out.includes("Mira"));
    assert.ok(out.endsWith("Just ask."));
  });
});

describe("gossip propagation", () => {
  it("schedule a gossip consequence + dispatcher routes to handler", async () => {
    // Player answered npc_asker's question; schedule gossip.
    schedule(db, {
      kind: "gossip:player-answered",
      fireInS: 0,
      source: { kind: "npc", id: "npc_asker" },
      target: { kind: "player", id: "U1" },
      worldId: "concordia",
      payload: { topic: "frost magic", body: "My father taught me." },
    });

    const r = await runConsequenceDispatcherCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.fired >= 1, "at least one handler fired");

    // Three near NPCs should have a memory of player_U1 now.
    for (const nid of ["npc_near_a", "npc_near_b", "npc_near_c"]) {
      const m = getMemory(db, nid, "U1");
      assert.ok(m, `${nid} should have memory`);
      assert.ok(m.sentiment > 0, `${nid} sentiment positive from gossip`);
    }
    // Far NPC should NOT have a memory.
    assert.equal(getMemory(db, "npc_far", "U1"), null, "far NPC not gossiped");
    // Source NPC also shouldn't have one created via gossip (self-skip).
    assert.equal(getMemory(db, "npc_asker", "U1"), null, "source skipped");
  });

  it("handler tags listeners with via_gossip in payload", async () => {
    const sched = schedule(db, {
      kind: "gossip:player-answered",
      fireInS: 0,
      source: { kind: "npc", id: "npc_asker" },
      target: { kind: "player", id: "U2" },
      worldId: "concordia",
      payload: { topic: "joining the cult" },
    });
    const consequence = {
      id: sched.id,
      kind: "gossip:player-answered",
      source: { kind: "npc", id: "npc_asker" },
      target: { kind: "player", id: "U2" },
      worldId: "concordia",
      payload: { topic: "joining the cult" },
    };
    const r = await gossipHandler(db, consequence);
    assert.equal(r.ok, true);
    assert.ok(r.listeners >= 1);

    // Verify a listener row exists with via_gossip in the interaction payload.
    const ix = db.prepare(`
      SELECT payload_json FROM npc_player_interactions
      WHERE npc_id IN ('npc_near_a','npc_near_b','npc_near_c') AND player_id = 'U2'
      ORDER BY created_at DESC LIMIT 1
    `).get();
    assert.ok(ix);
    const p = JSON.parse(ix.payload_json);
    assert.equal(p.via_gossip, true);
    assert.equal(p.gossipSource, "npc_asker");
  });

  it("gracefully handles missing source NPC position", async () => {
    const r = await gossipHandler(db, {
      kind: "gossip:player-answered",
      source: { kind: "npc", id: "npc_nonexistent" },
      target: { kind: "player", id: "U3" },
      worldId: "concordia",
      payload: {},
    });
    assert.equal(r.ok, true);
    assert.equal(r.reason, "no_source_position");
  });
});
