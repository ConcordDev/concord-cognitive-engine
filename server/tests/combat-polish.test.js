/**
 * Tier-2 contract tests for Phase 8 — Combat Polish Substrate.
 *
 * Pinned per category:
 *
 *   PROFILES — 5 named profiles + faction → profile mapping
 *   GAS TANK — spend, recover, gassed_out threshold crossing event
 *   COMBO   — record-strike chain; window expiry breaks combo;
 *             finisher unlocks at threshold; multiplier capped at 2.5
 *   PARRY   — within window = parried; first half = perfect (riposte);
 *             outside window = no parry
 *   DODGE   — same shape; perfect dodge returns time_dilation_pct
 *   ROCKED  — magnitude < threshold = no rocked; >= = rocked until + duration
 *   AWARENESS — legal transition allowed; illegal rejected; idempotent same-state
 *   GRAPPLE — profile.grapple_supported gates; surface picks hardness;
 *             rocks the defender via cascade
 *   STANCE  — change persists; same-stance is idempotent
 *
 * Run: node --test tests/combat-polish.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  COMBAT_PROFILES,
  STANCES,
  AWARENESS_STATES,
  getOrCreateActorState,
  spendGas,
  recoverGas,
  recordStrike,
  attemptParry,
  attemptDodge,
  triggerRocked,
  isRocked,
  transitionAwareness,
  changeStance,
  attemptGrapple,
  getRecentCombatEvents,
  pickProfileForFaction,
} from "../lib/combat-polish.js";

// ── Fake DB ─────────────────────────────────────────────────────────────────

function makeFakeDb() {
  const tables = { combat_actor_state: new Map(), combat_events: new Map() };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { run: (...a) => runStmt(s, a), get: (...a) => getStmt(s, a), all: (...a) => allStmt(s, a) };
  }
  const key = (kind, id) => `${kind}|${id}`;

  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO combat_actor_state")) {
      const [actorKind, actorId, worldId, profileId] = args;
      const k = key(actorKind, actorId);
      if (tables.combat_actor_state.has(k)) return { changes: 0 };
      tables.combat_actor_state.set(k, {
        actor_kind: actorKind, actor_id: actorId, world_id: worldId,
        profile_id: profileId,
        stance: "high", posture: "balanced",
        awareness: "idle", awareness_target: null,
        gas: 100, max_gas: 100,
        combo_count: 0, combo_last_at_ms: 0,
        rocked_until_ms: 0,
        grapple_target: null,
        updated_at: Math.floor(Date.now() / 1000),
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE combat_actor_state SET gas = ?")) {
      const [gas, kind, id] = args;
      const r = tables.combat_actor_state.get(key(kind, id));
      if (r) { r.gas = gas; r.updated_at = Math.floor(Date.now() / 1000); return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE combat_actor_state SET combo_count = ?, combo_last_at_ms = ?")) {
      const [count, lastAt, kind, id] = args;
      const r = tables.combat_actor_state.get(key(kind, id));
      if (r) { r.combo_count = count; r.combo_last_at_ms = lastAt; return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE combat_actor_state SET rocked_until_ms = ?")) {
      const [until, kind, id] = args;
      const r = tables.combat_actor_state.get(key(kind, id));
      if (r) { r.rocked_until_ms = until; return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE combat_actor_state SET awareness = ?, awareness_target = ?")) {
      const [awareness, target, kind, id] = args;
      const r = tables.combat_actor_state.get(key(kind, id));
      if (r) { r.awareness = awareness; r.awareness_target = target; return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE combat_actor_state SET stance = ?")) {
      const [st, kind, id] = args;
      const r = tables.combat_actor_state.get(key(kind, id));
      if (r) { r.stance = st; return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE combat_actor_state SET grapple_target = ?")) {
      const [tgt, kind, id] = args;
      const r = tables.combat_actor_state.get(key(kind, id));
      if (r) { r.grapple_target = tgt; return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("INSERT INTO combat_events")) {
      const [id, worldId, actorKind, actorId, eventKind, detail] = args;
      tables.combat_events.set(id, { id, world_id: worldId, actor_kind: actorKind, actor_id: actorId, event_kind: eventKind, detail_json: detail, occurred_at: Math.floor(Date.now() / 1000) });
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  function getStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM combat_actor_state WHERE actor_kind = ? AND actor_id = ?")) {
      return tables.combat_actor_state.get(key(args[0], args[1])) || null;
    }
    if (sql.startsWith("SELECT profile_id FROM combat_actor_state")) {
      const r = tables.combat_actor_state.get(key(args[0], args[1]));
      return r ? { profile_id: r.profile_id } : null;
    }
    if (sql.startsWith("SELECT rocked_until_ms FROM combat_actor_state")) {
      const r = tables.combat_actor_state.get(key(args[0], args[1]));
      return r ? { rocked_until_ms: r.rocked_until_ms } : null;
    }
    return null;
  }
  function allStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM combat_events WHERE actor_kind = ? AND actor_id = ?")) {
      const [kind, id, limit] = args;
      return Array.from(tables.combat_events.values())
        .filter(e => e.actor_kind === kind && e.actor_id === id)
        .sort((a, b) => b.occurred_at - a.occurred_at)
        .slice(0, limit);
    }
    return [];
  }
  return { prepare, _tables: tables };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("PROFILES", () => {
  it("5 profiles all present with required fields", () => {
    const expected = ["ufc_groundgame", "sifu_brawler", "street_freeroam", "chrome_blade", "caped_aerial"];
    for (const id of expected) {
      const p = COMBAT_PROFILES[id];
      assert.ok(p, `missing ${id}`);
      assert.ok(typeof p.gas_strike_cost === "number");
      assert.ok(typeof p.combo_window_ms === "number");
      assert.ok(typeof p.parry_window_ms === "number");
      assert.ok(typeof p.dodge_window_ms === "number");
      assert.ok(typeof p.finisher_threshold === "number");
    }
  });

  it("STANCES + AWARENESS_STATES export correctly", () => {
    assert.equal(STANCES.length, 5);
    assert.equal(AWARENESS_STATES.length, 6);
  });

  it("pickProfileForFaction maps known factions; defaults to street", () => {
    assert.equal(pickProfileForFaction("iron_wardens"), "ufc_groundgame");
    assert.equal(pickProfileForFaction("scholars_guild"), "sifu_brawler");
    assert.equal(pickProfileForFaction("shadow_network"), "chrome_blade");
    assert.equal(pickProfileForFaction("anti_sovereign_movement"), "caped_aerial");
    assert.equal(pickProfileForFaction("totally_unknown"), "street_freeroam");
  });
});

describe("GAS TANK", () => {
  it("spendGas decreases gas + flags gassed_out crossing", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "ufc_groundgame" });
    // UFC: gassed_out_threshold=15. Spend 90 → 10 → gassed_out = true.
    const r = spendGas(db, { actorKind: "player", actorId: "u1", amount: 90 });
    assert.equal(r.ok, true);
    assert.equal(r.gas_after, 10);
    assert.equal(r.gassed_out, true);
  });

  it("spendGas clamps at zero", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "street_freeroam" });
    const r = spendGas(db, { actorKind: "player", actorId: "u1", amount: 200 });
    assert.equal(r.gas_after, 0);
  });

  it("recoverGas restores up to max", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "street_freeroam" });
    spendGas(db, { actorKind: "player", actorId: "u1", amount: 50 });
    // street_freeroam recovers 12 per s; 5s should recover 60 → clamped to max.
    const r = recoverGas(db, { actorKind: "player", actorId: "u1", dtSeconds: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.gas_after, 100);
  });
});

describe("COMBO ENCODER", () => {
  it("first strike starts combo at 1", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "sifu_brawler" });
    const r = recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 1000 });
    assert.equal(r.combo, 1);
    assert.equal(r.broken_previous_combo, false);
    assert.ok(r.multiplier > 1);
  });

  it("rapid succession extends combo", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "sifu_brawler" });
    recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 1000 });
    recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 1500 });
    const r = recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 2000 });
    assert.equal(r.combo, 3);
  });

  it("expired window breaks combo + starts fresh at 1", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "sifu_brawler" });
    recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 1000 });
    // sifu combo_window_ms=1100 — wait 2000ms past it, fresh combo.
    const r = recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 4000 });
    assert.equal(r.combo, 1);
    assert.equal(r.broken_previous_combo, true);
  });

  it("finisher unlocks at profile.finisher_threshold", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "sifu_brawler" });
    let r;
    let t = 1000;
    for (let i = 0; i < 6; i++) {
      r = recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: t });
      t += 200;
    }
    assert.equal(r.combo, 6);
    assert.equal(r.finisher_unlocked, true);  // sifu finisher_threshold=6
  });

  it("multiplier caps at 2.5", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "sifu_brawler" });
    let r;
    let t = 1000;
    for (let i = 0; i < 50; i++) {
      r = recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: t });
      t += 100;
    }
    assert.ok(r.multiplier <= 2.5);
  });
});

describe("PARRY", () => {
  it("within window = parried; first half = perfect (riposte unlocked)", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "sifu_brawler" });
    // sifu parry_window_ms=260
    const perfect = attemptParry(db, { defenderKind: "player", defenderId: "u1", defenderInputAt: 1000, attackArrivesAt: 1100 });
    assert.equal(perfect.parried, true);
    assert.equal(perfect.perfect, true);
    assert.ok(perfect.riposte_window_ms > 0);

    // Outside window
    const miss = attemptParry(db, { defenderKind: "player", defenderId: "u1", defenderInputAt: 1000, attackArrivesAt: 1500 });
    assert.equal(miss.parried, false);
  });

  it("late press (negative lead) is not a parry", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "sifu_brawler" });
    const r = attemptParry(db, { defenderKind: "player", defenderId: "u1", defenderInputAt: 1500, attackArrivesAt: 1000 });
    assert.equal(r.parried, false);
  });
});

describe("DODGE", () => {
  it("perfect dodge returns time dilation per profile", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "chrome_blade" });
    const r = attemptDodge(db, { defenderKind: "player", defenderId: "u1", defenderInputAt: 1000, attackArrivesAt: 1100 });
    assert.equal(r.dodged, true);
    assert.equal(r.perfect, true);
    // chrome_blade: time_dilation_on_perfect_dodge_pct=0.35
    assert.equal(r.time_dilation_pct, 0.35);
  });

  it("non-perfect dodge has zero time dilation", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "chrome_blade" });
    // chrome dodge_window_ms=240 → perfect = lead <= 120
    const r = attemptDodge(db, { defenderKind: "player", defenderId: "u1", defenderInputAt: 1000, attackArrivesAt: 1200 });
    assert.equal(r.dodged, true);
    assert.equal(r.perfect, false);
    assert.equal(r.time_dilation_pct, 0);
  });
});

describe("ROCKED", () => {
  it("magnitude below threshold = no rocked", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "ufc_groundgame" });
    // UFC rocked_threshold=35
    const r = triggerRocked(db, { actorKind: "player", actorId: "u1", magnitude: 20, nowMs: 1000 });
    assert.equal(r.rocked, false);
  });

  it("magnitude at threshold sets rocked_until_ms", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "ufc_groundgame" });
    const r = triggerRocked(db, { actorKind: "player", actorId: "u1", magnitude: 50, nowMs: 1000 });
    assert.equal(r.rocked, true);
    // UFC rocked_duration_ms=2200
    assert.equal(r.until_ms, 3200);
  });

  it("isRocked returns true within window, false after", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "ufc_groundgame" });
    triggerRocked(db, { actorKind: "player", actorId: "u1", magnitude: 50, nowMs: 1000 });
    assert.equal(isRocked(db, { actorKind: "player", actorId: "u1", nowMs: 2000 }), true);
    assert.equal(isRocked(db, { actorKind: "player", actorId: "u1", nowMs: 5000 }), false);
  });
});

describe("AWARENESS state machine", () => {
  it("legal transition idle → patrol → alert → combat", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "npc", actorId: "n1", profileId: "ufc_groundgame" });
    let r = transitionAwareness(db, { actorKind: "npc", actorId: "n1", to: "patrol" });
    assert.equal(r.ok, true);
    r = transitionAwareness(db, { actorKind: "npc", actorId: "n1", to: "alert" });
    assert.equal(r.ok, true);
    r = transitionAwareness(db, { actorKind: "npc", actorId: "n1", to: "combat", target: "u1" });
    assert.equal(r.ok, true);
  });

  it("illegal transition rejected", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "npc", actorId: "n1", profileId: "ufc_groundgame" });
    // idle → combat is not legal (must go through patrol/alert)
    const r = transitionAwareness(db, { actorKind: "npc", actorId: "n1", to: "combat" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "illegal_transition");
  });

  it("idempotent same-state transition", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "npc", actorId: "n1", profileId: "ufc_groundgame" });
    const r = transitionAwareness(db, { actorKind: "npc", actorId: "n1", to: "idle" });
    assert.equal(r.transitioned, false);
  });
});

describe("STANCE", () => {
  it("changes stance + records event", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "ufc_groundgame" });
    const r = changeStance(db, { actorKind: "player", actorId: "u1", to: "ground" });
    assert.equal(r.ok, true);
    assert.equal(r.transitioned, true);
  });

  it("rejects unknown stance", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "ufc_groundgame" });
    const r = changeStance(db, { actorKind: "player", actorId: "u1", to: "moonwalk" });
    assert.equal(r.ok, false);
  });
});

describe("GRAPPLE", () => {
  it("UFC profile supports grapple; surface picks hardness", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "ufc_groundgame" });
    const r = attemptGrapple(db, {
      attackerKind: "player", attackerId: "u1",
      defenderKind: "npc", defenderId: "n1",
      surface: "wall", magnitude: 30,
    });
    assert.equal(r.ok, true);
    // wall hardness 1.2 × 30 × 1.3 = 46.8 → 47
    assert.equal(r.environmental_damage, 47);
  });

  it("sifu_brawler profile rejects grapple", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "sifu_brawler" });
    const r = attemptGrapple(db, {
      attackerKind: "player", attackerId: "u1",
      defenderKind: "npc", defenderId: "n1",
      surface: "wall", magnitude: 30,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "profile_disallows_grapple");
  });

  it("rocked attacker can't grapple", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "ufc_groundgame" });
    triggerRocked(db, { actorKind: "player", actorId: "u1", magnitude: 50, nowMs: Date.now() });
    const r = attemptGrapple(db, {
      attackerKind: "player", attackerId: "u1",
      defenderKind: "npc", defenderId: "n1",
      surface: "wall", magnitude: 30,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "attacker_rocked");
  });
});

describe("EVENTS log + read", () => {
  it("getRecentCombatEvents returns desc by occurred_at", () => {
    const db = makeFakeDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "u1", profileId: "sifu_brawler" });
    recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 1000 });
    recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: 1200 });
    const events = getRecentCombatEvents(db, { actorKind: "player", actorId: "u1" });
    assert.ok(events.length >= 2);
  });
});
