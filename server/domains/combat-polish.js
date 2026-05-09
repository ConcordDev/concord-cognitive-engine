// server/domains/combat-polish.js
//
// Phase 8 — macros for the combat polish substrate.
// Read-mostly: HUD reads recent events + state; client-driven inputs
// for parry/dodge timing windows; server-side spend/recover is
// triggered by the existing combat path + heartbeat.

import {
  getOrCreateActorState,
  spendGas,
  recordStrike,
  attemptParry,
  attemptDodge,
  triggerRocked,
  isRocked,
  transitionAwareness,
  changeStance,
  attemptGrapple,
  getRecentCombatEvents,
  COMBAT_PROFILES,
} from "../lib/combat-polish.js";

export default function registerCombatPolishMacros(register) {
  register("combat_polish", "state_for_actor", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const state = getOrCreateActorState(db, {
      actorKind: input.actorKind,
      actorId: input.actorId,
      worldId: input.worldId,
      profileId: input.profileId,
    });
    return state ? { ok: true, state } : { ok: false, reason: "no_state" };
  }, { note: "fetch combat polish state for an actor (creates row if missing)" });

  register("combat_polish", "attempt_parry", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return attemptParry(db, {
      defenderKind: input.defenderKind || "player",
      defenderId: input.defenderId || ctx?.actor?.userId,
      defenderInputAt: input.defenderInputAt,
      attackArrivesAt: input.attackArrivesAt,
    });
  }, { note: "resolve a parry attempt (timing-based)" });

  register("combat_polish", "attempt_dodge", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return attemptDodge(db, {
      defenderKind: input.defenderKind || "player",
      defenderId: input.defenderId || ctx?.actor?.userId,
      defenderInputAt: input.defenderInputAt,
      attackArrivesAt: input.attackArrivesAt,
    });
  }, { note: "resolve a dodge attempt (perfect = time dilation)" });

  register("combat_polish", "change_stance", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return changeStance(db, {
      actorKind: input.actorKind || "player",
      actorId: input.actorId || ctx?.actor?.userId,
      to: input.to,
    });
  }, { note: "change combat stance (high/low/clinch/ground/aerial)" });

  register("combat_polish", "attempt_grapple", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return attemptGrapple(db, {
      attackerKind: input.attackerKind || "player",
      attackerId: input.attackerId || ctx?.actor?.userId,
      defenderKind: input.defenderKind,
      defenderId: input.defenderId,
      surface: input.surface,
      magnitude: Number(input.magnitude) || 30,
    });
  }, { note: "environmental grapple (wall/floor/fountain/hood/window/...)" });

  register("combat_polish", "recent_events", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const events = getRecentCombatEvents(db, {
      actorKind: input.actorKind || "player",
      actorId: input.actorId || ctx?.actor?.userId,
      limit: Math.min(100, Math.max(1, Number(input.limit) || 30)),
    });
    return { ok: true, events };
  }, { note: "recent combat events for the HUD" });

  register("combat_polish", "list_profiles", async (_ctx, _input = {}) => {
    const profiles = Object.entries(COMBAT_PROFILES).map(([id, p]) => ({
      id, label: p.label,
      stance_critical: p.stance_critical,
      grapple_supported: p.grapple_supported,
      aerial_default: p.aerial_default,
      gas_strike_cost: p.gas_strike_cost,
      combo_window_ms: p.combo_window_ms,
      finisher_threshold: p.finisher_threshold,
      time_dilation_on_perfect_dodge_pct: p.time_dilation_on_perfect_dodge_pct,
    }));
    return { ok: true, profiles };
  }, { note: "list available combat profiles (genres)" });
}
