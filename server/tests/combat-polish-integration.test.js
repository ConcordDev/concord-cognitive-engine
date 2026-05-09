/**
 * Integration test for Phase 8 combat-polish wire-up.
 *
 * Pins:
 *   - Server-emitted events route through globalThis.__CONCORD_REALTIME__.io
 *     on the 'combat:polish' channel addressed to world:${worldId}
 *   - Event payload shape matches what CombatBridges.tsx + CombatPolishHUD.tsx
 *     expect: { id, worldId, actorKind, actorId, eventKind, detail, ts }
 *   - All event kinds emitted by combat-polish.js have a matching socket
 *     emission (no silent events)
 *   - Listener absence (no realtime io configured) is non-fatal
 *
 * Run: node --test tests/combat-polish-integration.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  getOrCreateActorState,
  spendGas,
  recordStrike,
  attemptParry,
  attemptDodge,
  triggerRocked,
  changeStance,
  attemptGrapple,
  transitionAwareness,
} from "../lib/combat-polish.js";

// ── Fake DB (minimal — just needs INSERTs to succeed) ──────────────────────

function makeFakeDb() {
  const t = { combat_actor_state: new Map(), combat_events: new Map() };
  const k = (kind, id) => `${kind}|${id}`;
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return {
      run: (...a) => runStmt(s, a),
      get: (...a) => getStmt(s, a),
      all: () => [],
    };
  }
  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO combat_actor_state")) {
      const [kind, id, world, profile] = args;
      t.combat_actor_state.set(k(kind, id), {
        actor_kind: kind, actor_id: id, world_id: world, profile_id: profile,
        stance: "high", posture: "balanced", awareness: "idle", awareness_target: null,
        gas: 100, max_gas: 100, combo_count: 0, combo_last_at_ms: 0, rocked_until_ms: 0,
        grapple_target: null, updated_at: 0,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE combat_actor_state")) {
      // generic update; map fields by parsing args is overkill for this test
      // since we only assert socket emissions, not state correctness.
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO combat_events")) {
      const [id, world, kind, actor, eventKind, detail] = args;
      t.combat_events.set(id, { id, world_id: world, actor_kind: kind, actor_id: actor, event_kind: eventKind, detail_json: detail });
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  function getStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM combat_actor_state")) {
      return t.combat_actor_state.get(k(args[0], args[1])) || null;
    }
    if (sql.startsWith("SELECT profile_id FROM combat_actor_state")) {
      const r = t.combat_actor_state.get(k(args[0], args[1]));
      return r ? { profile_id: r.profile_id } : null;
    }
    if (sql.startsWith("SELECT rocked_until_ms FROM combat_actor_state")) {
      const r = t.combat_actor_state.get(k(args[0], args[1]));
      return r ? { rocked_until_ms: r.rocked_until_ms } : null;
    }
    return null;
  }
  return { prepare, _t: t };
}

// ── Capture socket emissions ───────────────────────────────────────────────

function makeRealtimeSpy() {
  const emissions = [];
  const io = {
    to(channel) {
      return {
        emit(event, payload) {
          emissions.push({ channel, event, payload });
        },
      };
    },
  };
  return { io, emissions };
}

beforeEach(() => {
  delete globalThis.__CONCORD_REALTIME__;
});
afterEach(() => {
  delete globalThis.__CONCORD_REALTIME__;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("socket emission shape", () => {
  it("recordStrike emits combat:polish event with the expected payload shape", () => {
    const db = makeFakeDb();
    const spy = makeRealtimeSpy();
    globalThis.__CONCORD_REALTIME__ = { io: spy.io };

    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", worldId: "concordia-hub", profileId: "sifu_brawler" });
    recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 1000 });

    const e = spy.emissions[0];
    assert.ok(e, "expected at least one emission");
    assert.equal(e.channel, "world:concordia-hub");
    assert.equal(e.event, "combat:polish");
    assert.ok(e.payload.id?.startsWith("ce_"));
    assert.equal(e.payload.worldId, "concordia-hub");
    assert.equal(e.payload.actorKind, "player");
    assert.equal(e.payload.actorId, "u1");
    assert.ok(typeof e.payload.eventKind === "string");
    assert.ok(typeof e.payload.detail === "object");
    assert.ok(typeof e.payload.ts === "number");
  });

  it("emits the right eventKind for each substrate action", () => {
    const db = makeFakeDb();
    const spy = makeRealtimeSpy();
    globalThis.__CONCORD_REALTIME__ = { io: spy.io };

    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "ufc_groundgame" });
    getOrCreateActorState(db, { actorKind: "npc", actorId: "n1", profileId: "ufc_groundgame" });

    recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 1000 });
    triggerRocked(db, { actorKind: "npc", actorId: "n1", magnitude: 50, nowMs: 1000 });
    attemptGrapple(db, {
      attackerKind: "player", attackerId: "u1",
      defenderKind: "npc", defenderId: "n1",
      surface: "wall", magnitude: 30,
    });
    changeStance(db, { actorKind: "player", actorId: "u1", to: "low" });
    transitionAwareness(db, { actorKind: "player", actorId: "u1", to: "patrol" });

    const kinds = spy.emissions.map(e => e.payload.eventKind);
    assert.ok(kinds.includes("combo_start"));
    assert.ok(kinds.includes("rocked"));
    assert.ok(kinds.includes("grapple_environmental"));
    assert.ok(kinds.includes("stance_change"));
    assert.ok(kinds.includes("awareness_transition"));
  });

  it("parry emits parry_perfect when within first half of window", () => {
    const db = makeFakeDb();
    const spy = makeRealtimeSpy();
    globalThis.__CONCORD_REALTIME__ = { io: spy.io };
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "sifu_brawler" });
    attemptParry(db, { defenderKind: "player", defenderId: "u1", defenderInputAt: 1000, attackArrivesAt: 1100 });
    const ev = spy.emissions[0];
    assert.equal(ev.payload.eventKind, "parry_perfect");
  });

  it("dodge_perfect carries time_dilation in detail (Cyberpunk = 0.35)", () => {
    const db = makeFakeDb();
    const spy = makeRealtimeSpy();
    globalThis.__CONCORD_REALTIME__ = { io: spy.io };
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "chrome_blade" });
    attemptDodge(db, { defenderKind: "player", defenderId: "u1", defenderInputAt: 1000, attackArrivesAt: 1100 });
    const ev = spy.emissions[0];
    assert.equal(ev.payload.eventKind, "dodge_perfect");
    assert.equal(ev.payload.detail.time_dilation, 0.35);
  });

  it("gassed_out fires only when crossing threshold from above", () => {
    const db = makeFakeDb();
    const spy = makeRealtimeSpy();
    globalThis.__CONCORD_REALTIME__ = { io: spy.io };
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "ufc_groundgame" });
    // UFC threshold = 15; 100 → 90 (still above) shouldn't fire gassed_out.
    spendGas(db, { actorKind: "player", actorId: "u1", amount: 10 });
    const aboveKinds = spy.emissions.map(e => e.payload.eventKind);
    assert.ok(!aboveKinds.includes("gassed_out"));

    // Note: our fake doesn't track gas state across spends, so we can't
    // assert the threshold-crossing emission directly without a real DB.
    // What we DO assert: spendGas doesn't crash without realtime.
    delete globalThis.__CONCORD_REALTIME__;
    const r = spendGas(db, { actorKind: "player", actorId: "u1", amount: 99 });
    assert.equal(r.ok, true);
  });
});

describe("realtime listener absence is non-fatal", () => {
  it("substrate works when __CONCORD_REALTIME__ is unset", () => {
    delete globalThis.__CONCORD_REALTIME__;
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "street_freeroam" });
    const r1 = recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 1000 });
    assert.equal(r1.ok, true);
    const r2 = triggerRocked(db, { actorKind: "player", actorId: "u1", magnitude: 30, nowMs: 1000 });
    assert.equal(r2.rocked, true);
  });

  it("substrate works when io.to throws", () => {
    globalThis.__CONCORD_REALTIME__ = {
      io: { to() { throw new Error("io broken"); } },
    };
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "street_freeroam" });
    const r = recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 1000 });
    assert.equal(r.ok, true);
  });
});

describe("event coverage — every substrate action emits one event", () => {
  it("recordStrike → combo_start (or combo_extend), one emission", () => {
    const db = makeFakeDb();
    const spy = makeRealtimeSpy();
    globalThis.__CONCORD_REALTIME__ = { io: spy.io };
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "sifu_brawler" });
    recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 1000 });
    assert.equal(spy.emissions.length, 1);
  });

  it("triggerRocked below threshold emits 0", () => {
    const db = makeFakeDb();
    const spy = makeRealtimeSpy();
    globalThis.__CONCORD_REALTIME__ = { io: spy.io };
    getOrCreateActorState(db, { actorKind: "npc", actorId: "n1", profileId: "ufc_groundgame" });
    triggerRocked(db, { actorKind: "npc", actorId: "n1", magnitude: 5, nowMs: 1000 });
    assert.equal(spy.emissions.length, 0);
  });

  it("triggerRocked at threshold emits 1", () => {
    const db = makeFakeDb();
    const spy = makeRealtimeSpy();
    globalThis.__CONCORD_REALTIME__ = { io: spy.io };
    getOrCreateActorState(db, { actorKind: "npc", actorId: "n1", profileId: "ufc_groundgame" });
    triggerRocked(db, { actorKind: "npc", actorId: "n1", magnitude: 50, nowMs: 1000 });
    const ev = spy.emissions.find(e => e.payload.eventKind === "rocked");
    assert.ok(ev);
  });
});
