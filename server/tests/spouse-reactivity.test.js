/**
 * E4 — spouse reactivity. The married NPC reacts to who the player is in the
 * wider world (factions, kills, schemes), shifting courtship affinity and
 * estranging the marriage when it sours far enough.
 *
 * Run: node --test tests/spouse-reactivity.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up153 } from "../migrations/153_npc_opinions.js";
import { up as up206 } from "../migrations/206_romance.js";
import {
  computeReaction, reactToPlayerEvent, getSpouses, SPOUSE_REACTIVITY_CONSTANTS,
} from "../lib/spouse-reactivity.js";

function setupDb() {
  const db = new Database(":memory:");
  up153(db);
  up206(db);
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, faction TEXT, world_id TEXT);`);
  return db;
}

function marry(db, userId, npcId, affinity = 0.9) {
  db.prepare(`INSERT INTO player_courtship (player_user_id, partner_kind, partner_id, affinity, status) VALUES (?, 'npc', ?, ?, 'married')`).run(userId, npcId, affinity);
  db.prepare(`INSERT INTO player_marriages (id, player_user_id, partner_kind, partner_id) VALUES (?, ?, 'npc', ?)`).run(`mar_${npcId}`, userId, npcId);
}

function setNpc(db, id, faction) {
  db.prepare(`INSERT INTO world_npcs (id, faction, world_id) VALUES (?, ?, 'w')`).run(id, faction || null);
}

describe("E4 — getSpouses + no-op when unmarried", () => {
  it("returns active NPC spouses only", () => {
    const db = setupDb();
    marry(db, "u1", "spouse1");
    assert.equal(getSpouses(db, "u1").length, 1);
    assert.equal(getSpouses(db, "u2").length, 0);
  });

  it("reactToPlayerEvent is a clean no-op for an unmarried player", () => {
    const db = setupDb();
    const r = reactToPlayerEvent(db, "u_single", { kind: "npc_killed", targetNpcId: "x" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.reactions, []);
  });
});

describe("E4 — computeReaction by event kind", () => {
  it("faction_join aligned vs rival vs neutral", () => {
    const db = setupDb();
    setNpc(db, "sp", "iron_guild");
    assert.equal(computeReaction(db, "sp", { kind: "faction_join", factionId: "iron_guild" }).delta, SPOUSE_REACTIVITY_CONSTANTS.faction_join_aligned);
    assert.equal(computeReaction(db, "sp", { kind: "faction_join", factionId: "other_guild" }).delta, SPOUSE_REACTIVITY_CONSTANTS.faction_join_neutral);
  });

  it("faction_betray of the spouse's own faction is the harshest faction hit", () => {
    const db = setupDb();
    setNpc(db, "sp", "iron_guild");
    assert.equal(computeReaction(db, "sp", { kind: "faction_betray", factionId: "iron_guild" }).delta, SPOUSE_REACTIVITY_CONSTANTS.faction_betray_own);
  });

  it("npc_killed: liked → wounded, enemy → relieved, neutral → uneasy", () => {
    const db = setupDb();
    setNpc(db, "sp", null);
    // spouse's opinion of the victims
    db.prepare(`INSERT INTO character_opinions (npc_id, target_kind, target_id, score, kind) VALUES ('sp','npc','friend',60,'likes')`).run();
    db.prepare(`INSERT INTO character_opinions (npc_id, target_kind, target_id, score, kind) VALUES ('sp','npc','foe',-60,'hates')`).run();
    assert.equal(computeReaction(db, "sp", { kind: "npc_killed", targetNpcId: "friend" }).delta, SPOUSE_REACTIVITY_CONSTANTS.kill_liked);
    assert.equal(computeReaction(db, "sp", { kind: "npc_killed", targetNpcId: "foe" }).delta, SPOUSE_REACTIVITY_CONSTANTS.kill_enemy);
    assert.equal(computeReaction(db, "sp", { kind: "npc_killed", targetNpcId: "stranger" }).delta, SPOUSE_REACTIVITY_CONSTANTS.kill_neutral);
  });

  it("scheme_exposed: cruel/paranoid spouse admires, others are shamed", () => {
    const db = setupDb();
    setNpc(db, "sp", null);
    db.exec(`CREATE TABLE npc_stress (npc_id TEXT PRIMARY KEY, coping_trait TEXT);`);
    db.prepare(`INSERT INTO npc_stress (npc_id, coping_trait) VALUES ('sp','cruel')`).run();
    assert.equal(computeReaction(db, "sp", { kind: "scheme_exposed" }).delta, SPOUSE_REACTIVITY_CONSTANTS.scheme_admired);
    db.prepare(`UPDATE npc_stress SET coping_trait = 'stoic' WHERE npc_id = 'sp'`).run();
    assert.equal(computeReaction(db, "sp", { kind: "scheme_exposed" }).delta, SPOUSE_REACTIVITY_CONSTANTS.scheme_exposed);
  });
});

describe("E4 — reactToPlayerEvent applies affinity + estrangement", () => {
  let prev, captured;
  beforeEach(() => { prev = globalThis._concordRealtimeEmit; captured = []; globalThis._concordRealtimeEmit = (n, p) => captured.push({ n, p }); });
  afterEach(() => { globalThis._concordRealtimeEmit = prev; });

  it("a kill of a loved NPC drops affinity and emits a reaction", () => {
    const db = setupDb();
    setNpc(db, "sp", null);
    marry(db, "u1", "sp", 0.9);
    db.prepare(`INSERT INTO character_opinions (npc_id, target_kind, target_id, score, kind) VALUES ('sp','npc','friend',60,'likes')`).run();
    const r = reactToPlayerEvent(db, "u1", { kind: "npc_killed", targetNpcId: "friend" });
    assert.equal(r.reactions.length, 1);
    assert.ok(Math.abs(r.reactions[0].affinity - (0.9 + SPOUSE_REACTIVITY_CONSTANTS.kill_liked)) < 1e-9);
    assert.equal(captured.filter(c => c.n === "spouse:reaction").length, 1);
  });

  it("sustained betrayal estranges the marriage", () => {
    const db = setupDb();
    setNpc(db, "sp", "iron_guild");
    marry(db, "u1", "sp", -0.2); // already strained
    const r = reactToPlayerEvent(db, "u1", { kind: "faction_betray", factionId: "iron_guild" });
    // -0.2 + (-0.14) = -0.34 < ESTRANGE_THRESHOLD (-0.3)
    assert.equal(r.reactions[0].estranged, true);
    const court = db.prepare(`SELECT status FROM player_courtship WHERE player_user_id='u1' AND partner_id='sp'`).get();
    assert.equal(court.status, "estranged");
    const mar = db.prepare(`SELECT dissolved_at FROM player_marriages WHERE player_user_id='u1' AND partner_id='sp'`).get();
    assert.ok(mar.dissolved_at != null);
  });

  it("player_death triggers a grief reaction without damaging affinity", () => {
    const db = setupDb();
    setNpc(db, "sp", null);
    marry(db, "u1", "sp", 0.8);
    const r = reactToPlayerEvent(db, "u1", { kind: "player_death" });
    assert.equal(r.reactions[0].delta, 0);
    assert.ok(Math.abs(r.reactions[0].affinity - 0.8) < 1e-9);
    assert.equal(captured.filter(c => c.n === "spouse:reaction").length, 1);
  });
});
