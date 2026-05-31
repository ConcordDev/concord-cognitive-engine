// Slice-of-Life SL3 — public/district reputation. Pins: standing aggregates a
// scope's NPC opinions of the player minus their grudges, the faction/world
// scopes resolve correctly, a betrayal-grudge drops standing, and the gate flips
// at a threshold. Derived from the existing consequence stream — no new writes.
//
// Run: node --test tests/reputation.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { recordOpinionEvent } from "../lib/npc-opinions.js";
import { recomputeReputation, getReputation, reputationGate } from "../lib/social/reputation.js";

function mkNpc(db, id, faction, world = "w1") {
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, faction, is_dead) VALUES (?,?,?,?,0)`)
    .run(id, world, "trader", faction);
}

describe("SL3 reputation", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("faction standing = average of that faction's NPCs' opinions of the player", () => {
    mkNpc(db, "n1", "emerald"); mkNpc(db, "n2", "emerald"); mkNpc(db, "n3", "crimson");
    recordOpinionEvent(db, { npcId: "n1", targetKind: "player", targetId: "u1" }, 40, "t");
    recordOpinionEvent(db, { npcId: "n2", targetKind: "player", targetId: "u1" }, 20, "t");
    recordOpinionEvent(db, { npcId: "n3", targetKind: "player", targetId: "u1" }, -80, "t"); // other faction
    const r = recomputeReputation(db, "u1", "faction", "emerald");
    assert.equal(r.ok, true);
    assert.equal(r.standing, 30);    // (40+20)/2 — crimson n3 excluded
    assert.equal(r.sampleCount, 2);
  });

  it("a grudge drops standing below the raw opinion average", () => {
    mkNpc(db, "n1", "emerald");
    recordOpinionEvent(db, { npcId: "n1", targetKind: "player", targetId: "u1" }, 30, "t");
    db.prepare(`INSERT INTO npc_grudges (npc_id, target_kind, target_id, narrative, severity) VALUES ('n1','player','u1','betrayed me',8)`).run();
    const r = recomputeReputation(db, "u1", "faction", "emerald");
    assert.equal(r.standing, 30 - 1.5 * 8); // 18 — grudge weight applied
  });

  it("world scope aggregates across factions", () => {
    mkNpc(db, "n1", "emerald", "w1"); mkNpc(db, "n2", "crimson", "w1");
    recordOpinionEvent(db, { npcId: "n1", targetKind: "player", targetId: "u1" }, 50, "t");
    recordOpinionEvent(db, { npcId: "n2", targetKind: "player", targetId: "u1" }, 10, "t");
    const r = recomputeReputation(db, "u1", "world", "w1");
    assert.equal(r.standing, 30); // (50+10)/2 across both factions
  });

  it("getReputation reads the cache; reputationGate flips at a threshold", () => {
    mkNpc(db, "n1", "emerald");
    recordOpinionEvent(db, { npcId: "n1", targetKind: "player", targetId: "u1" }, 45, "t");
    recomputeReputation(db, "u1", "faction", "emerald");
    assert.equal(getReputation(db, "u1", "faction", "emerald").standing, 45);
    assert.equal(reputationGate(db, "u1", "faction", "emerald", 40), true);
    assert.equal(reputationGate(db, "u1", "faction", "emerald", 50), false);
  });

  it("rejects a bad scope", () => {
    assert.equal(recomputeReputation(db, "u1", "galaxy", "x").reason, "bad_scope");
  });
});
