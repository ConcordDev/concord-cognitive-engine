// server/lib/combat-polish.js
//
// Phase 8 — Combat Polish Substrate.
//
// The layer ABOVE physics that makes combat feel like the games
// people love. Five named profiles distill what each genre does well:
//
//   ufc_groundgame    — high gas costs, slow recovery, long combo windows,
//                       takedowns + clinch, stance critical.
//   sifu_brawler      — medium gas, generous parry windows, perfect dodge
//                       triggers slight time dilation, combo finishers.
//   street_freeroam   — GTA-style: low gas, fast recovery, environmental
//                       damage common, rocked → ragdoll.
//   chrome_blade      — Cyberpunk: low gas, sandevistan-style time dilation
//                       on activation, mantis-blade combo bias.
//   caped_aerial      — Spider-Man / Arkham: aerial stance is normal,
//                       grapple-traversal-into-finisher, mass-vary.
//
// Profiles are data, not code. The user can author new profiles in
// content/world/combat-profiles.json.

import crypto from "node:crypto";
import logger from "../logger.js";

// ── Combat profiles (the genre dial) ────────────────────────────────────────

export const COMBAT_PROFILES = Object.freeze({
  // UFC — slow, brutal, gas-bound. Gas IS the mechanic.
  ufc_groundgame: {
    label: "UFC Ground Game",
    gas_strike_cost: 6,
    gas_strike_miss_cost: 9,           // missed strikes drain MORE
    gas_recovery_per_s: 4,             // slow gas back
    gassed_out_threshold: 15,          // below this, strikes are weak
    combo_window_ms: 1400,             // long — chained punches/kicks
    combo_decay_after_ms: 2000,
    parry_window_ms: 220,              // tight
    dodge_window_ms: 280,
    perfect_timing_bonus_pct: 0.4,
    rocked_threshold: 35,
    rocked_duration_ms: 2200,
    stagger_chance: 0.18,
    finisher_threshold: 8,             // 8-hit combo unlocks finisher
    time_dilation_on_perfect_dodge_pct: 0,
    stance_critical: true,
    grapple_supported: true,
    aerial_default: false,
  },

  // Sifu / Spider-Man brawler — flow over force, parry-rich.
  sifu_brawler: {
    label: "Sifu / Brawler",
    gas_strike_cost: 3,
    gas_strike_miss_cost: 5,
    gas_recovery_per_s: 8,
    gassed_out_threshold: 10,
    combo_window_ms: 1100,
    combo_decay_after_ms: 1600,
    parry_window_ms: 260,              // generous — rewards timing
    dodge_window_ms: 320,
    perfect_timing_bonus_pct: 0.5,
    rocked_threshold: 28,
    rocked_duration_ms: 1400,
    stagger_chance: 0.25,
    finisher_threshold: 6,
    time_dilation_on_perfect_dodge_pct: 0.15,  // ~150ms slow-mo
    stance_critical: false,
    grapple_supported: false,
    aerial_default: false,
  },

  // GTA street fights — low-skill ceiling, environmental, ragdoll-heavy.
  street_freeroam: {
    label: "Street / Free-roam",
    gas_strike_cost: 2,
    gas_strike_miss_cost: 3,
    gas_recovery_per_s: 12,            // fast back
    gassed_out_threshold: 5,
    combo_window_ms: 700,              // short — brawls don't flow
    combo_decay_after_ms: 1000,
    parry_window_ms: 180,
    dodge_window_ms: 220,
    perfect_timing_bonus_pct: 0.2,
    rocked_threshold: 20,
    rocked_duration_ms: 1800,          // long — they stay down
    stagger_chance: 0.35,              // brawls stagger a lot
    finisher_threshold: 4,
    time_dilation_on_perfect_dodge_pct: 0,
    stance_critical: false,
    grapple_supported: true,
    aerial_default: false,
  },

  // Cyberpunk chrome — sandevistan dilation + mantis-blade combos.
  chrome_blade: {
    label: "Chrome / Cyberware",
    gas_strike_cost: 2,
    gas_strike_miss_cost: 4,
    gas_recovery_per_s: 10,
    gassed_out_threshold: 8,
    combo_window_ms: 900,
    combo_decay_after_ms: 1300,
    parry_window_ms: 200,
    dodge_window_ms: 240,
    perfect_timing_bonus_pct: 0.6,     // crit-y
    rocked_threshold: 25,
    rocked_duration_ms: 1200,
    stagger_chance: 0.30,
    finisher_threshold: 5,
    time_dilation_on_perfect_dodge_pct: 0.35,  // sandevistan — strong slow-mo
    stance_critical: false,
    grapple_supported: false,
    aerial_default: false,
  },

  // Caped aerial — Spider-Man / Arkham: gravity-light, traversal-into-combat.
  caped_aerial: {
    label: "Caped Aerial",
    gas_strike_cost: 2.5,
    gas_strike_miss_cost: 4,
    gas_recovery_per_s: 9,
    gassed_out_threshold: 12,
    combo_window_ms: 1300,
    combo_decay_after_ms: 1800,
    parry_window_ms: 240,
    dodge_window_ms: 300,
    perfect_timing_bonus_pct: 0.45,
    rocked_threshold: 30,
    rocked_duration_ms: 1500,
    stagger_chance: 0.28,
    finisher_threshold: 6,
    time_dilation_on_perfect_dodge_pct: 0.2,
    stance_critical: false,
    grapple_supported: true,            // grapple-traversal-into-finisher
    aerial_default: true,               // aerial stance is normal
  },
});

export const STANCES = ["high", "low", "clinch", "ground", "aerial"];
export const POSTURES = ["balanced", "advancing", "retreating", "downed"];
export const AWARENESS_STATES = ["idle", "patrol", "alert", "combat", "panic", "routed"];

// Awareness state machine: from → set of legal to-states. Hot-loop reads.
const AWARENESS_TRANSITIONS = Object.freeze({
  idle:    new Set(["patrol", "alert"]),
  patrol:  new Set(["idle", "alert"]),
  alert:   new Set(["combat", "patrol", "panic"]),
  combat:  new Set(["alert", "panic", "routed"]),
  panic:   new Set(["routed", "alert"]),
  routed:  new Set(["idle"]),
});

// ── State accessor ──────────────────────────────────────────────────────────

/**
 * Ensure the actor has a combat_actor_state row. Idempotent. Returns the
 * row.
 */
export function getOrCreateActorState(db, { actorKind, actorId, worldId, profileId }) {
  if (!db || !actorKind || !actorId) return null;
  try {
    let row = db.prepare(`
      SELECT * FROM combat_actor_state WHERE actor_kind = ? AND actor_id = ?
    `).get(actorKind, actorId);
    if (row) return row;

    const profile = profileId && COMBAT_PROFILES[profileId] ? profileId : "street_freeroam";
    db.prepare(`
      INSERT INTO combat_actor_state
        (actor_kind, actor_id, world_id, profile_id, stance, posture, awareness, gas, max_gas, combo_count, combo_last_at_ms, rocked_until_ms, updated_at)
      VALUES (?, ?, ?, ?, 'high', 'balanced', 'idle', 100, 100, 0, 0, 0, unixepoch())
    `).run(actorKind, actorId, worldId || "concordia-hub", profile);
    return db.prepare(`SELECT * FROM combat_actor_state WHERE actor_kind = ? AND actor_id = ?`).get(actorKind, actorId);
  } catch (err) {
    try { logger.warn?.("combat-polish", "ensure_state_failed", { actorId, error: err?.message }); } catch { /* ignore */ }
    return null;
  }
}

export function profileFor(db, { actorKind, actorId }) {
  const row = db.prepare(`SELECT profile_id FROM combat_actor_state WHERE actor_kind = ? AND actor_id = ?`).get(actorKind, actorId);
  const id = row?.profile_id || "street_freeroam";
  return COMBAT_PROFILES[id] || COMBAT_PROFILES.street_freeroam;
}

// ── Gas tank ────────────────────────────────────────────────────────────────

/**
 * Spend gas. Returns { ok, gas_after, gassed_out } where gassed_out is
 * true iff the actor is now below the profile's gassed_out_threshold
 * (their next strike will be weak, telegraphed in the HUD).
 */
export function spendGas(db, { actorKind, actorId, amount }) {
  if (!db || !actorKind || !actorId || !(amount >= 0)) return { ok: false, reason: "missing_inputs" };
  const state = getOrCreateActorState(db, { actorKind, actorId });
  if (!state) return { ok: false, reason: "no_state" };
  const profile = COMBAT_PROFILES[state.profile_id] || COMBAT_PROFILES.street_freeroam;

  const gasAfter = Math.max(0, state.gas - amount);
  const gassedOut = gasAfter < profile.gassed_out_threshold;

  try {
    db.prepare(`UPDATE combat_actor_state SET gas = ?, updated_at = unixepoch() WHERE actor_kind = ? AND actor_id = ?`)
      .run(gasAfter, actorKind, actorId);
  } catch { return { ok: false, reason: "update_failed" }; }

  if (gassedOut && state.gas >= profile.gassed_out_threshold) {
    // Just crossed the threshold — emit a gassed_out event.
    insertEvent(db, state.world_id, actorKind, actorId, "gassed_out", { gas_before: state.gas, gas_after: gasAfter });
  }

  return { ok: true, gas_after: gasAfter, gassed_out: gassedOut };
}

/**
 * Recover gas over elapsed seconds. Caller passes dt; the heartbeat
 * computes dt from updated_at automatically.
 */
export function recoverGas(db, { actorKind, actorId, dtSeconds }) {
  if (!db || !actorKind || !actorId || !(dtSeconds > 0)) return { ok: false, reason: "missing_inputs" };
  const state = db.prepare(`SELECT * FROM combat_actor_state WHERE actor_kind = ? AND actor_id = ?`).get(actorKind, actorId);
  if (!state) return { ok: false, reason: "no_state" };
  if (state.awareness === "combat") {
    // In active combat, recovery is halved.
    dtSeconds *= 0.5;
  }
  const profile = COMBAT_PROFILES[state.profile_id] || COMBAT_PROFILES.street_freeroam;
  const gain = profile.gas_recovery_per_s * dtSeconds;
  const gasAfter = Math.min(state.max_gas, state.gas + gain);
  if (gasAfter === state.gas) return { ok: true, gas_after: gasAfter };
  try {
    db.prepare(`UPDATE combat_actor_state SET gas = ?, updated_at = unixepoch() WHERE actor_kind = ? AND actor_id = ?`)
      .run(gasAfter, actorKind, actorId);
  } catch { return { ok: false, reason: "update_failed" }; }
  return { ok: true, gas_after: gasAfter, gained: gain };
}

// ── Combo encoder ───────────────────────────────────────────────────────────

/**
 * Record a successful strike and update combo state. Returns
 *   { combo, finisher_unlocked, multiplier, broken_previous_combo }
 *
 * - combo: integer current combo length
 * - finisher_unlocked: true if combo just hit profile.finisher_threshold
 * - multiplier: damage multiplier from combo (1.0 + 0.04 × combo, capped 2.5)
 * - broken_previous_combo: true if the prior chain expired before this strike
 */
export function recordStrike(db, { actorKind, actorId, nowMs }) {
  if (!db || !actorKind || !actorId) return { ok: false, reason: "missing_inputs" };
  const state = getOrCreateActorState(db, { actorKind, actorId });
  if (!state) return { ok: false, reason: "no_state" };
  const profile = COMBAT_PROFILES[state.profile_id] || COMBAT_PROFILES.street_freeroam;
  const t = nowMs ?? Date.now();

  const elapsed = t - (state.combo_last_at_ms || 0);
  let combo = state.combo_count;
  let broken = false;

  if (combo > 0 && elapsed > profile.combo_window_ms) {
    // Window expired — count this as a fresh start, log the break.
    insertEvent(db, state.world_id, actorKind, actorId, "combo_break", { previous: combo, elapsed_ms: elapsed });
    broken = true;
    combo = 0;
  }

  combo = Math.min(999, combo + 1);
  const finisherUnlocked = (combo === profile.finisher_threshold);
  const multiplier = Math.min(2.5, 1 + 0.04 * combo);

  try {
    db.prepare(`
      UPDATE combat_actor_state
      SET combo_count = ?, combo_last_at_ms = ?, updated_at = unixepoch()
      WHERE actor_kind = ? AND actor_id = ?
    `).run(combo, t, actorKind, actorId);
  } catch { return { ok: false, reason: "update_failed" }; }

  if (combo === 1) {
    insertEvent(db, state.world_id, actorKind, actorId, "combo_start", { combo, multiplier });
  } else {
    insertEvent(db, state.world_id, actorKind, actorId, "combo_extend", { combo, multiplier });
  }
  if (finisherUnlocked) {
    insertEvent(db, state.world_id, actorKind, actorId, "combo_finish", { combo, multiplier });
  }

  return { ok: true, combo, finisher_unlocked: finisherUnlocked, multiplier, broken_previous_combo: broken };
}

// ── Parry / Dodge ───────────────────────────────────────────────────────────

/**
 * Resolve a defensive parry attempt. defenderInputAt is when the defender
 * pressed parry; attackArrivesAt is when the strike will land. If the
 * defender pressed within the parry window before the strike, it's a
 * parry; if within HALF the window, it's a perfect parry (which opens
 * a riposte window).
 *
 * Returns { parried, perfect, riposte_window_ms } or { parried: false }.
 */
export function attemptParry(db, { defenderKind, defenderId, defenderInputAt, attackArrivesAt }) {
  if (!db) return { parried: false };
  const state = getOrCreateActorState(db, { actorKind: defenderKind, actorId: defenderId });
  if (!state) return { parried: false };
  const profile = COMBAT_PROFILES[state.profile_id] || COMBAT_PROFILES.street_freeroam;

  const lead = attackArrivesAt - defenderInputAt;
  if (lead < 0 || lead > profile.parry_window_ms) {
    return { parried: false, lead_ms: lead };
  }
  const perfect = lead <= profile.parry_window_ms / 2;
  insertEvent(db, state.world_id, defenderKind, defenderId, perfect ? "parry_perfect" : "parry", { lead_ms: lead });

  // Perfect parry gives a riposte window equal to half the combo window.
  const ripostWindow = perfect ? Math.round(profile.combo_window_ms / 2) : 0;
  return { parried: true, perfect, riposte_window_ms: ripostWindow, lead_ms: lead };
}

/**
 * Dodge attempt. Same shape as parry. Perfect dodge can trigger time
 * dilation per the profile.
 */
export function attemptDodge(db, { defenderKind, defenderId, defenderInputAt, attackArrivesAt }) {
  if (!db) return { dodged: false };
  const state = getOrCreateActorState(db, { actorKind: defenderKind, actorId: defenderId });
  if (!state) return { dodged: false };
  const profile = COMBAT_PROFILES[state.profile_id] || COMBAT_PROFILES.street_freeroam;

  const lead = attackArrivesAt - defenderInputAt;
  if (lead < 0 || lead > profile.dodge_window_ms) {
    return { dodged: false, lead_ms: lead };
  }
  const perfect = lead <= profile.dodge_window_ms / 2;
  const timeDilation = perfect ? profile.time_dilation_on_perfect_dodge_pct : 0;
  insertEvent(db, state.world_id, defenderKind, defenderId, perfect ? "dodge_perfect" : "dodge", { lead_ms: lead, time_dilation: timeDilation });
  return { dodged: true, perfect, time_dilation_pct: timeDilation, lead_ms: lead };
}

// ── Rocked / staggered ──────────────────────────────────────────────────────

/**
 * Trigger a rocked state if the magnitude crosses the profile's
 * rocked_threshold. Rocked actors can't strike for rocked_duration_ms
 * — caller checks isRocked() before allowing a strike.
 */
export function triggerRocked(db, { actorKind, actorId, magnitude, nowMs }) {
  if (!db || !(magnitude >= 0)) return { rocked: false };
  const state = getOrCreateActorState(db, { actorKind, actorId });
  if (!state) return { rocked: false };
  const profile = COMBAT_PROFILES[state.profile_id] || COMBAT_PROFILES.street_freeroam;

  if (magnitude < profile.rocked_threshold) return { rocked: false, magnitude };

  const t = nowMs ?? Date.now();
  const until = t + profile.rocked_duration_ms;
  try {
    db.prepare(`UPDATE combat_actor_state SET rocked_until_ms = ?, updated_at = unixepoch() WHERE actor_kind = ? AND actor_id = ?`)
      .run(until, actorKind, actorId);
  } catch { return { rocked: false, reason: "update_failed" }; }

  insertEvent(db, state.world_id, actorKind, actorId, "rocked", { magnitude, until });
  return { rocked: true, until_ms: until, duration_ms: profile.rocked_duration_ms };
}

export function isRocked(db, { actorKind, actorId, nowMs }) {
  if (!db) return false;
  const row = db.prepare(`SELECT rocked_until_ms FROM combat_actor_state WHERE actor_kind = ? AND actor_id = ?`).get(actorKind, actorId);
  if (!row) return false;
  return (row.rocked_until_ms || 0) > (nowMs ?? Date.now());
}

// ── Awareness state machine ─────────────────────────────────────────────────

/**
 * Transition awareness state. Rejects illegal transitions per the
 * AWARENESS_TRANSITIONS map. Idempotent on repeated same-state calls.
 *
 * Returns { ok, transitioned, from, to } or { ok: false, reason }.
 */
export function transitionAwareness(db, { actorKind, actorId, to, target }) {
  if (!db || !to) return { ok: false, reason: "missing_inputs" };
  if (!AWARENESS_STATES.includes(to)) return { ok: false, reason: "bad_state" };
  const state = getOrCreateActorState(db, { actorKind, actorId });
  if (!state) return { ok: false, reason: "no_state" };
  const from = state.awareness;
  if (from === to) return { ok: true, transitioned: false, from, to };

  const legal = AWARENESS_TRANSITIONS[from] || new Set();
  if (!legal.has(to)) {
    return { ok: false, reason: "illegal_transition", from, to };
  }

  try {
    db.prepare(`UPDATE combat_actor_state SET awareness = ?, awareness_target = ?, updated_at = unixepoch() WHERE actor_kind = ? AND actor_id = ?`)
      .run(to, target || null, actorKind, actorId);
  } catch { return { ok: false, reason: "update_failed" }; }

  insertEvent(db, state.world_id, actorKind, actorId, "awareness_transition", { from, to, target: target || null });
  return { ok: true, transitioned: true, from, to };
}

// ── Stance + grapple ────────────────────────────────────────────────────────

export function changeStance(db, { actorKind, actorId, to }) {
  if (!db || !STANCES.includes(to)) return { ok: false, reason: "bad_stance" };
  const state = getOrCreateActorState(db, { actorKind, actorId });
  if (!state) return { ok: false, reason: "no_state" };
  if (state.stance === to) return { ok: true, transitioned: false };
  try {
    db.prepare(`UPDATE combat_actor_state SET stance = ?, updated_at = unixepoch() WHERE actor_kind = ? AND actor_id = ?`)
      .run(to, actorKind, actorId);
  } catch { return { ok: false, reason: "update_failed" }; }
  insertEvent(db, state.world_id, actorKind, actorId, "stance_change", { from: state.stance, to });
  return { ok: true, transitioned: true };
}

/**
 * Attempt a grapple. The "surface" arg names what the attacker is
 * planning to slam the defender into — wall, floor, fountain, hood,
 * railing. The combat profile must support grapples.
 *
 * Returns { ok, environmental_damage, narrative } or { ok: false }.
 */
export function attemptGrapple(db, { attackerKind, attackerId, defenderKind, defenderId, surface, magnitude }) {
  if (!db) return { ok: false, reason: "no_db" };
  const attackerState = getOrCreateActorState(db, { actorKind: attackerKind, actorId: attackerId });
  if (!attackerState) return { ok: false, reason: "no_state" };
  const profile = COMBAT_PROFILES[attackerState.profile_id] || COMBAT_PROFILES.street_freeroam;
  if (!profile.grapple_supported) {
    return { ok: false, reason: "profile_disallows_grapple", profile_id: attackerState.profile_id };
  }

  if (isRocked(db, { actorKind: attackerKind, actorId: attackerId })) {
    return { ok: false, reason: "attacker_rocked" };
  }

  // Environmental damage scales with magnitude + surface hardness.
  const SURFACE_HARDNESS = { wall: 1.2, floor: 1.0, fountain: 0.7, hood: 0.9, railing: 1.1, window: 0.5, door: 0.6 };
  const hardness = SURFACE_HARDNESS[surface] || 1.0;
  const envDamage = Math.round(magnitude * hardness * 1.3);

  try {
    db.prepare(`UPDATE combat_actor_state SET grapple_target = ?, updated_at = unixepoch() WHERE actor_kind = ? AND actor_id = ?`)
      .run(defenderId, attackerKind, attackerId);
  } catch { /* ignore */ }

  insertEvent(db, attackerState.world_id, attackerKind, attackerId, "grapple_environmental", {
    target_kind: defenderKind, target_id: defenderId, surface, env_damage: envDamage,
  });

  // Trigger a rocked state on the defender from the slam.
  triggerRocked(db, { actorKind: defenderKind, actorId: defenderId, magnitude: envDamage });

  const narrative = `Slammed into ${surface} for ${envDamage} damage.`;
  return { ok: true, environmental_damage: envDamage, narrative };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function insertEvent(db, worldId, actorKind, actorId, eventKind, detail) {
  try {
    db.prepare(`
      INSERT INTO combat_events (id, world_id, actor_kind, actor_id, event_kind, detail_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    `).run(`ce_${crypto.randomUUID()}`, worldId, actorKind, actorId, eventKind, JSON.stringify(detail || {}));
  } catch (err) {
    try { logger.debug?.("combat-polish", "event_insert_failed", { eventKind, error: err?.message }); } catch { /* ignore */ }
  }
}

/** UI read — recent events for an actor (HUD). */
export function getRecentCombatEvents(db, { actorKind, actorId, limit = 30 }) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT * FROM combat_events
      WHERE actor_kind = ? AND actor_id = ?
      ORDER BY occurred_at DESC LIMIT ?
    `).all(actorKind, actorId, limit);
  } catch { return []; }
}

/** Resolve combat profile for a player or NPC by faction default mapping. */
export function pickProfileForFaction(factionId) {
  const map = {
    iron_wardens:        "ufc_groundgame",
    pinewood_coalition:  "ufc_groundgame",
    scholars_guild:      "sifu_brawler",
    verdant_veil_remnant: "sifu_brawler",
    merchant_collective: "street_freeroam",
    shadow_network:      "chrome_blade",
    anti_corporate_resistance: "chrome_blade",
    iron_rose_syndicate:       "street_freeroam",
    anti_sovereign_movement:   "caped_aerial",
  };
  return map[factionId] || "street_freeroam";
}

export const _internal = {
  AWARENESS_TRANSITIONS,
  insertEvent,
};
