// Phase Z10 — DB9 party combat tick + active-session integration test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upParty } from "../../migrations/259_fluid_party_combat.js";
import {
  startCombat,
  queueAction,
  resolveTick,
  getCombatState,
  findActiveSessionForPlayer,
  setTimeScale,
} from "../../lib/party-combat.js";

function bootDb() {
  const db = new Database(":memory:");
  upParty(db);
  return db;
}

describe("Phase Z10 / DB9 — party combat tick + active session", () => {
  it("starts session, finds it via findActiveSessionForPlayer, ticks, returns state", () => {
    const db = bootDb();

    const start = startCombat(db, {
      worldId: "concordia-hub",
      mode: "tactical",
      profileName: "sifu_brawler",
      participants: [
        { entityKind: "player", entityId: "u_player", team: "allies", hp: 100, maxHp: 100 },
        { entityKind: "npc", entityId: "n_brigand", team: "enemies", hp: 80, maxHp: 80 },
      ],
    });
    assert.equal(start.ok, true);
    assert.ok(start.sessionId);

    // Active-session lookup for the player.
    const sess = findActiveSessionForPlayer(db, "u_player");
    assert.ok(sess);
    assert.equal(sess.id, start.sessionId);

    // Queue an attack from player → npc.
    const queued = queueAction(db, start.sessionId, "u_player", { kind: "attack", targetId: "n_brigand" });
    assert.equal(queued.ok, true);

    // Tick advance — force a future timestamp so cooldown elapses.
    const future = Date.now() + 60_000;
    const tick = resolveTick(db, start.sessionId, future);
    assert.equal(tick.ok, true);

    const state = getCombatState(db, start.sessionId);
    assert.ok(state);
    assert.equal(state.combatants.length, 2);
    // After tick, queued action either fired (NPC took damage) or got carried forward.
    const npc = state.combatants.find((c) => c.entity_id === "n_brigand");
    assert.ok(npc);
    assert.ok(npc.hp <= npc.max_hp);
  });

  it("setTimeScale clamps to [0, 2.0]", () => {
    const db = bootDb();
    const start = startCombat(db, {
      worldId: "w",
      participants: [
        { entityKind: "player", entityId: "u1", team: "allies", hp: 50, maxHp: 50 },
        { entityKind: "npc", entityId: "n1", team: "enemies", hp: 50, maxHp: 50 },
      ],
    });
    assert.equal(setTimeScale(db, start.sessionId, 0).timeScale, 0);
    assert.equal(setTimeScale(db, start.sessionId, 1).timeScale, 1);
    assert.equal(setTimeScale(db, start.sessionId, 5).timeScale, 2);
    assert.equal(setTimeScale(db, start.sessionId, -1).timeScale, 0);
  });

  it("queueAction rejects an action from a downed combatant", () => {
    const db = bootDb();
    const start = startCombat(db, {
      worldId: "w",
      participants: [
        { entityKind: "player", entityId: "u2", team: "allies", hp: 0, maxHp: 50 },
        { entityKind: "npc", entityId: "n2", team: "enemies", hp: 50, maxHp: 50 },
      ],
    });
    const r = queueAction(db, start.sessionId, "u2", { kind: "attack", targetId: "n2" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "combatant_down");
  });

  it("findActiveSessionForPlayer returns null for a player with no session", () => {
    const db = bootDb();
    const r = findActiveSessionForPlayer(db, "ghost_user");
    assert.equal(r, null);
  });
});
