// Phase CC1 — turn-based grid combat tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  startCombat, turnOrder, executeAction, getCombatState, listCombatLog,
  DEFAULT_AP_PER_TURN, ATTACK_AP_COST, MOVE_AP_COST, DAMAGE_CAP_HARD,
} from "../lib/turn-combat.js";
import { up as upTurn } from "../migrations/251_turn_combat.js";

function freshDb() { const db = new Database(":memory:"); upTurn(db); return db; }

const TWO = [
  { entityKind: "player", entityId: "alice", team: "blue", hp: 100, maxHp: 100, x: 0, y: 0 },
  { entityKind: "player", entityId: "bob",   team: "red",  hp: 100, maxHp: 100, x: 3, y: 0 },
];

describe("Phase CC1 — turn-based combat", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("startCombat creates row + 2 combatants with initiative", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    assert.equal(r.ok, true);
    const order = turnOrder(db, r.combatId);
    assert.equal(order.length, 2);
    const ids = order.map(o => o.entity_id);
    assert.ok(ids.includes("alice") && ids.includes("bob"));
  });

  it("startCombat requires 2+ combatants + valid participant shape", () => {
    assert.equal(startCombat(db, { worldId: "tunya", participants: [TWO[0]] }).ok, false);
    assert.equal(startCombat(db, { worldId: "tunya", participants: [{ entityId: "x", team: "blue" }, TWO[1]] }).ok, false);
  });

  it("move drains AP by Chebyshev distance", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    const m = executeAction(db, r.combatId, "alice", { kind: "move", toX: 2, toY: 1 });
    assert.equal(m.ok, true);
    assert.equal(m.remainingAp, DEFAULT_AP_PER_TURN - 2);  // max(|2|, |1|) = 2 cells × 1 AP
  });

  it("attack drops target HP + ends combat at HP=0", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    // First attack — alice deals 50 to bob.
    const a = executeAction(db, r.combatId, "alice", {
      kind: "attack", targetId: "bob", damage: 50, range: 5,
    });
    assert.equal(a.ok, true);
    assert.equal(a.newHp, 50);
    // Second attack — alice ends turn (refill AP), then strikes again killing bob.
    executeAction(db, r.combatId, "alice", { kind: "end_turn" });
    const b = executeAction(db, r.combatId, "alice", {
      kind: "attack", targetId: "bob", damage: 100, range: 5,
    });
    assert.equal(b.combatEnded, true);
    assert.equal(b.winnerTeam, "blue");
  });

  it("damage caps at DAMAGE_CAP_HARD", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    const a = executeAction(db, r.combatId, "alice", {
      kind: "attack", targetId: "bob", damage: 9999, range: 5,
    });
    assert.equal(a.damage, DAMAGE_CAP_HARD);
  });

  it("friendly fire blocked", () => {
    const trio = [
      { entityId: "alice", team: "blue", hp: 100, x: 0, y: 0 },
      { entityId: "carol", team: "blue", hp: 100, x: 1, y: 0 },
      { entityId: "bob",   team: "red",  hp: 100, x: 5, y: 0 },
    ];
    const r = startCombat(db, { worldId: "tunya", participants: trio });
    const a = executeAction(db, r.combatId, "alice", {
      kind: "attack", targetId: "carol", damage: 10, range: 5,
    });
    assert.equal(a.ok, false);
    assert.equal(a.error, "friendly_target");
  });

  it("out-of-range attack rejected", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    const a = executeAction(db, r.combatId, "alice", {
      kind: "attack", targetId: "bob", damage: 10, range: 1,  // bob at (3,0), range needs >=3
    });
    assert.equal(a.ok, false);
    assert.equal(a.error, "out_of_range");
  });

  it("end_turn refills AP for all alive", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    executeAction(db, r.combatId, "alice", { kind: "move", toX: 2, toY: 1 });
    const e = executeAction(db, r.combatId, "alice", { kind: "end_turn" });
    assert.equal(e.ok, true);
    const state = getCombatState(db, r.combatId);
    const alice = state.combatants.find(c => c.entity_id === "alice");
    assert.equal(alice.ap_remaining, DEFAULT_AP_PER_TURN);
  });

  it("attack on already-ended combat rejected", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    db.prepare(`UPDATE turn_combats SET ended_at = unixepoch(), winner_team = 'blue' WHERE id = ?`).run(r.combatId);
    const a = executeAction(db, r.combatId, "alice", {
      kind: "attack", targetId: "bob", damage: 10, range: 5,
    });
    assert.equal(a.ok, false);
    assert.equal(a.error, "combat_ended");
  });

  it("log records each action", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    executeAction(db, r.combatId, "alice", { kind: "move", toX: 1, toY: 0 });
    executeAction(db, r.combatId, "alice", { kind: "attack", targetId: "bob", damage: 10, range: 5 });
    const log = listCombatLog(db, r.combatId);
    assert.equal(log.length, 2);
    assert.equal(log[0].action, "move");
    assert.equal(log[1].action, "attack");
  });
});
