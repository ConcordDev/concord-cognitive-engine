// Phase CC1 REWORK — fluid party combat (real-time-with-pause) tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  startCombat, setTimeScale, queueAction, resolveTick,
  getCombatState, listActionLog, DEFAULT_COOLDOWN_MS, DAMAGE_CAP_HARD,
  PARTY_ABILITY_CATALOG,
} from "../lib/party-combat.js";
import { up as upParty } from "../migrations/259_fluid_party_combat.js";

function freshDb() { const db = new Database(":memory:"); upParty(db); return db; }

const TWO = [
  { entityId: "alice", team: "blue", hp: 100, maxHp: 100, x: 0, z: 0 },
  { entityId: "bob",   team: "red",  hp: 100, maxHp: 100, x: 2, z: 0 },
];

describe("Phase CC1 (rework) — fluid party combat", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("startCombat seeds combatants with next_action_at_ms = now (off cooldown)", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    assert.equal(r.ok, true);
    const state = getCombatState(db, r.sessionId);
    assert.equal(state.combatants.length, 2);
    // All combatants start with cooldown elapsed (off cooldown).
    const now = Date.now();
    for (const c of state.combatants) {
      assert.ok(c.next_action_at_ms <= now + 50);
    }
  });

  it("setTimeScale 0 → resolveTick reports paused, no action fired", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    setTimeScale(db, r.sessionId, 0);
    queueAction(db, r.sessionId, "alice", {
      kind: "attack",
      payload: { kind: "attack", targetId: "bob", damage: 50, range: 5 },
    });
    const t = resolveTick(db, r.sessionId);
    assert.equal(t.paused, true);
    // bob still at full hp.
    const bob = getCombatState(db, r.sessionId).combatants.find(c => c.entity_id === "bob");
    assert.equal(bob.hp, 100);
  });

  it("queued attack resolves on next tick when off cooldown", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    queueAction(db, r.sessionId, "alice", {
      kind: "attack",
      payload: { kind: "attack", targetId: "bob", damage: 30, range: 5 },
    });
    const t = resolveTick(db, r.sessionId, Date.now());
    assert.ok(t.resolutions.some(x => x.damage === 30 && x.target === "bob"));
    const bob = getCombatState(db, r.sessionId).combatants.find(c => c.entity_id === "bob");
    assert.equal(bob.hp, 70);
  });

  it("cooldown blocks immediate re-fire of the same combatant", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    const nowA = Date.now();
    queueAction(db, r.sessionId, "alice", {
      kind: "attack",
      payload: { kind: "attack", targetId: "bob", damage: 20, range: 5 },
    });
    resolveTick(db, r.sessionId, nowA);
    // Queue another action immediately; cooldown hasn't elapsed.
    queueAction(db, r.sessionId, "alice", {
      kind: "attack",
      payload: { kind: "attack", targetId: "bob", damage: 20, range: 5 },
    });
    const t2 = resolveTick(db, r.sessionId, nowA + 100);
    assert.equal(t2.resolutions.length, 0, "alice still on cooldown");
    // After cooldown elapses, action fires.
    const t3 = resolveTick(db, r.sessionId, nowA + DEFAULT_COOLDOWN_MS + 50);
    assert.equal(t3.resolutions.length, 1);
  });

  it("attack at HP=0 ends combat with winner team", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    queueAction(db, r.sessionId, "alice", {
      kind: "attack",
      payload: { kind: "attack", targetId: "bob", damage: 200, range: 5 },
    });
    const t = resolveTick(db, r.sessionId, Date.now());
    assert.equal(t.ended, true);
    assert.equal(t.winnerTeam, "blue");
  });

  it("damage clamps to DAMAGE_CAP_HARD", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    queueAction(db, r.sessionId, "alice", {
      kind: "attack",
      payload: { kind: "attack", targetId: "bob", damage: 9999, range: 5 },
    });
    resolveTick(db, r.sessionId, Date.now());
    const log = listActionLog(db, r.sessionId);
    assert.equal(log[0].damage, DAMAGE_CAP_HARD);
  });

  it("out-of-range attack returns error in resolution but doesn't end combat", () => {
    const farTwo = [
      { entityId: "alice", team: "blue", hp: 100, maxHp: 100, x: 0, z: 0 },
      { entityId: "bob",   team: "red",  hp: 100, maxHp: 100, x: 50, z: 0 },
    ];
    const r = startCombat(db, { worldId: "tunya", participants: farTwo });
    queueAction(db, r.sessionId, "alice", {
      kind: "attack",
      payload: { kind: "attack", targetId: "bob", damage: 30, range: 2 },
    });
    const t = resolveTick(db, r.sessionId, Date.now());
    assert.equal(t.resolutions[0].error, "out_of_range");
  });

  it("AoE ability hits multiple enemies", () => {
    const four = [
      { entityId: "alice", team: "blue", hp: 100, maxHp: 100, x: 0, z: 0 },
      { entityId: "bob",   team: "red",  hp: 100, maxHp: 100, x: 2, z: 0 },
      { entityId: "carol", team: "red",  hp: 100, maxHp: 100, x: 3, z: 0 },
    ];
    const r = startCombat(db, { worldId: "tunya", participants: four });
    queueAction(db, r.sessionId, "alice", {
      kind: "ability",
      payload: { kind: "ability", targetIds: ["bob", "carol"], damage: 25 },
    });
    const t = resolveTick(db, r.sessionId, Date.now());
    assert.equal(t.resolutions[0].hits.length, 2);
  });

  it("move action updates position without damage", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    queueAction(db, r.sessionId, "alice", {
      kind: "move",
      payload: { kind: "move", x: 5, z: 5 },
    });
    resolveTick(db, r.sessionId, Date.now());
    const state = getCombatState(db, r.sessionId);
    const alice = state.combatants.find(c => c.entity_id === "alice");
    assert.equal(alice.position_x, 5);
  });

  it("queue is idempotent on (session, entity) — latest wins", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO });
    queueAction(db, r.sessionId, "alice", {
      kind: "attack",
      payload: { kind: "attack", targetId: "bob", damage: 10, range: 5 },
    });
    queueAction(db, r.sessionId, "alice", {
      kind: "attack",
      payload: { kind: "attack", targetId: "bob", damage: 50, range: 5 },
    });
    const t = resolveTick(db, r.sessionId, Date.now());
    assert.equal(t.resolutions[0].damage, 50);
  });

  it("startCombat requires at least 2 combatants", () => {
    const r = startCombat(db, { worldId: "tunya", participants: [TWO[0]] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "need_two_combatants");
  });

  // ── Security regression: ability damage is server-catalog-authoritative ──
  // (Wave 4 backlog, runmodes-endgame-social-capability-map.md §2.8) —
  // a client used to be able to supply an arbitrary `damage` on an `ability`
  // action, bounded only by the blunt 500 hard cap. These tests pin that
  // the applied damage now comes ONLY from PARTY_ABILITY_CATALOG, keyed by
  // the actor's profile, regardless of what the client claims.

  it("ability damage ignores an absurd client-supplied value (999999)", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO, profileName: "sifu_brawler" });
    queueAction(db, r.sessionId, "alice", {
      kind: "ability",
      payload: { kind: "ability", targetIds: ["bob"], damage: 999999, cooldownMs: 1 },
    });
    const t = resolveTick(db, r.sessionId, Date.now());
    const hit = t.resolutions[0].hits[0];
    const expected = PARTY_ABILITY_CATALOG.sifu_brawler.damage;
    assert.equal(hit.damage, expected, "damage must come from the catalog, not the client");
    assert.ok(hit.damage < 999999);
    assert.ok(hit.damage <= DAMAGE_CAP_HARD);
    const bob = getCombatState(db, r.sessionId).combatants.find(c => c.entity_id === "bob");
    assert.equal(bob.hp, 100 - expected);
  });

  it("ability cooldown ignores a client-supplied near-zero cooldownMs", () => {
    const r = startCombat(db, { worldId: "tunya", participants: TWO, profileName: "sifu_brawler" });
    const now = Date.now();
    queueAction(db, r.sessionId, "alice", {
      kind: "ability",
      payload: { kind: "ability", targetIds: ["bob"], damage: 999999, cooldownMs: 1 },
    });
    resolveTick(db, r.sessionId, now);
    const alice = getCombatState(db, r.sessionId).combatants.find(c => c.entity_id === "alice");
    // Actor's next_action_at_ms must reflect the catalog cooldown, not the
    // attacker-claimed 1ms — otherwise a modified client can rapid-fire
    // max-damage abilities and bypass the intended cadence entirely.
    assert.equal(alice.next_action_at_ms, now + PARTY_ABILITY_CATALOG.sifu_brawler.cooldownMs);
  });

  it("unknown profile falls back to the generic default ability, never client values", () => {
    const weird = [
      { entityId: "alice", team: "blue", hp: 100, maxHp: 100, x: 0, z: 0, profileName: "totally_not_a_real_profile" },
      { entityId: "bob",   team: "red",  hp: 100, maxHp: 100, x: 2, z: 0 },
    ];
    const r = startCombat(db, { worldId: "tunya", participants: weird });
    queueAction(db, r.sessionId, "alice", {
      kind: "ability",
      payload: { kind: "ability", targetIds: ["bob"], damage: 123456 },
    });
    const t = resolveTick(db, r.sessionId, Date.now());
    assert.equal(t.resolutions[0].hits[0].damage, PARTY_ABILITY_CATALOG.default.damage);
  });
});
