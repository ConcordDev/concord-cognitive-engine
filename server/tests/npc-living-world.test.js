import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up416 } from "../migrations/416_world_consequences.js";
import { up as up417 } from "../migrations/417_npc_living_world.js";
import { freshNeeds, decayNeeds, topNeed, NEED_KINDS } from "../lib/npc-needs.js";
import { recordMemory, memoriesFor, inheritMemories } from "../lib/npc-memory.js";
import { applyAxes, getAxes, describeAxes } from "../lib/npc-relation-axes.js";
import { recordConsequence } from "../lib/world-consequence.js";
import { applyPendingConsequences } from "../lib/consequence-apply.js";

function setup() {
  const db = new Database(":memory:");
  up416(db);
  up417(db);
  return db;
}

describe("living-world needs", () => {
  it("includes spec needs and keeps hunger as top of a starving vector", () => {
    assert.ok(NEED_KINDS.includes("thirst"));
    assert.ok(NEED_KINDS.includes("freedom"));
    assert.equal(topNeed({ hunger: 0.95, energy: 0.1 }).kind, "hunger");
    const d = decayNeeds(freshNeeds(), 8);
    assert.ok(d.thirst > freshNeeds().thirst);
  });
});

describe("npc memory", () => {
  let db;
  beforeEach(() => { db = setup(); });

  it("permanent high-importance memories survive fade filter", () => {
    recordMemory(db, {
      npcId: "mara",
      category: "KINDNESS",
      subjectKind: "player",
      subjectId: "p1",
      importance: 0.94,
      emotion: "gratitude",
      text: "rescued my son",
    });
    const rows = memoriesFor(db, "mara");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].persistence, "permanent");
  });

  it("heirs inherit important memories", () => {
    recordMemory(db, {
      npcId: "mara",
      category: "KINDNESS",
      subjectId: "p1",
      subjectKind: "player",
      importance: 0.94,
      text: "rescued my son",
    });
    const n = inheritMemories(db, "mara", "mara-daughter");
    assert.ok(n >= 1);
    const kid = memoriesFor(db, "mara-daughter");
    assert.ok(kid[0].text.includes("inherited"));
  });
});

describe("12-axis relationships", () => {
  let db;
  beforeEach(() => { db = setup(); });

  it("can respect without trusting", () => {
    applyAxes(db, { npcId: "rael", targetKind: "player", targetId: "p1" }, {
      respect: 0.9, trust: 0.1, fear: 0.7, hatred: 0.4,
    });
    const a = getAxes(db, "rael", "player", "p1");
    assert.ok(a.respect > 0.8 && a.trust < 0.2 && a.fear > 0.6);
    const d = describeAxes(a);
    assert.ok(d.includes("untrusted") || d.includes("afraid"));
  });
});

describe("personal_loss schedule", () => {
  it("grief replaces dusk socialize with temple commune", async () => {
    const { composeScheduleForNpc } = await import("../lib/npc-routines.js");
    const slots = composeScheduleForNpc(
      { id: "guard-1", archetype: "guard" },
      1,
      { kind: "personal_loss", narrative: "leader_dead" },
    );
    const dusk = slots.find((s) => s.block_idx === 6);
    assert.equal(dusk.activity_kind, "commune");
    assert.equal(dusk.location_kind, "temple");
  });
});

describe("consequence apply", () => {
  let db;
  beforeEach(() => { db = setup(); });

  it("kindness stamps memory + gratitude and marks applied", () => {
    recordConsequence(db, {
      actorKind: "player", actorId: "p1", action: "kindness",
      targetKind: "npc", targetId: "mara", importance: 0.94,
    });
    const r = applyPendingConsequences(db);
    assert.equal(r.applied, 1);
    const mem = memoriesFor(db, "mara");
    assert.equal(mem[0].category, "KINDNESS");
    const axes = getAxes(db, "mara", "player", "p1");
    assert.ok(axes.gratitude > 0.3);
    const again = applyPendingConsequences(db);
    assert.equal(again.applied, 0);
  });

  it("leader death rewrites faction schedules to grief", async () => {
    const { up: up130 } = await import("../migrations/130_npc_routines.js");
    up130(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS world_npcs (
        id TEXT PRIMARY KEY,
        faction TEXT,
        is_dead INTEGER DEFAULT 0,
        archetype TEXT,
        current_location TEXT,
        spawn_location TEXT,
        world_id TEXT
      );
    `);
    db.prepare(`INSERT INTO world_npcs (id, faction, archetype, spawn_location, world_id)
      VALUES ('g1','sundering-guard','guard','{"x":0,"z":0}','fantasy')`).run();
    const { recordLeaderDeath } = await import("../lib/world-consequence.js");
    recordLeaderDeath(db, {
      worldId: "fantasy",
      actorKind: "player",
      actorId: "p1",
      targetKind: "npc",
      targetId: "king",
      factionId: "sundering-guard",
      immediate: { factionId: "sundering-guard", succession: true },
      longTerm: { factionId: "sundering-guard" },
    });
    const r = applyPendingConsequences(db);
    assert.ok(r.rewritten >= 1);
    const rows = db.prepare(`SELECT activity_kind FROM npc_schedules WHERE npc_id='g1' AND block_idx=6`).all();
    assert.ok(rows.some((x) => x.activity_kind === "commune"));
  });
});
