// server/lib/world-sovereignty.js
//
// Living Society — Phase 13: world-creation as the highest-stakes verb.
//
// Power is earned in-world, never granted by authorship. Founding a world
// grants ZERO power; the world is a polity (raidable, contestable) and its
// founder a target. This module enforces:
//   - two tiers (open moons / operator-greenlit canon),
//   - a founding-grace window (a safe heart you grow at your own risk),
//   - conquerable-but-never-deletable (control transfers; the authored
//     substrate is sacred — topple, never `rm`),
//   - conditional god-tier forces (conditions over constants — reuse the
//     env-coupled buff substrate).

import crypto from "node:crypto";

const GRACE_WINDOW_S = Number(process.env.CONCORD_FOUNDING_GRACE_S) || 7 * 86400; // 7 days

const VALID_TIERS = new Set(["open", "canon"]);

/** Stamp a world's tier. Canon requires an operator sanction (no self-promote). */
export function setWorldTier(db, worldId, tier, { sanctionedBy = null, isOperator = false } = {}) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  const t = VALID_TIERS.has(tier) ? tier : "open";
  if (t === "canon" && !isOperator) return { ok: false, reason: "canon_requires_operator" };
  try {
    db.prepare(`UPDATE worlds SET tier = ?, sanctioned_by = ? WHERE id = ?`).run(t, t === "canon" ? sanctionedBy : null, worldId);
    return { ok: true, tier: t };
  } catch (e) { return { ok: false, reason: "persist_failed", error: e?.message }; }
}

/** Grant a founder a founding-grace window (a protected startup heart). */
export function grantFoundingGrace(db, worldId, founderId, { windowS = GRACE_WINDOW_S, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  try {
    db.prepare(`UPDATE worlds SET founder_grace_until = ?, created_by = COALESCE(created_by, ?) WHERE id = ?`)
      .run(now + windowS, founderId, worldId);
    return { ok: true, graceUntil: now + windowS };
  } catch (e) { return { ok: false, reason: "persist_failed", error: e?.message }; }
}

export function isUnderGrace(db, worldId, now = Math.floor(Date.now() / 1000)) {
  try {
    const w = db.prepare(`SELECT founder_grace_until FROM worlds WHERE id = ?`).get(worldId);
    return !!(w?.founder_grace_until && w.founder_grace_until > now);
  } catch { return false; }
}

/**
 * Conquer a world: control transfers to the conqueror (current_ruler), the
 * historical founder (created_by) is NEVER overwritten, and the authored
 * substrate is untouched. Refused during the founder's grace window and for the
 * unconquerable hub (Concordant Law).
 */
export function conquerWorld(db, worldId, { conquerorId, conquerorKind = "player", now = Math.floor(Date.now() / 1000) } = {}) {
  if (!db || !worldId || !conquerorId) return { ok: false, reason: "missing_inputs" };
  if (worldId === "concordia-hub") return { ok: false, reason: "concordant_law_refusal" }; // none may conquer the hub
  if (isUnderGrace(db, worldId, now)) return { ok: false, reason: "founder_grace" };
  let w = null;
  try { w = db.prepare(`SELECT id, created_by, current_ruler_id FROM worlds WHERE id = ?`).get(worldId); } catch { w = null; }
  if (!w) return { ok: false, reason: "no_world" };
  try {
    db.prepare(`UPDATE worlds SET current_ruler_id = ?, current_ruler_kind = ?, conquered_at = ? WHERE id = ?`)
      .run(conquerorId, conquerorKind, now, worldId);
  } catch (e) { return { ok: false, reason: "persist_failed", error: e?.message }; }
  return { ok: true, worldId, newRuler: conquerorId, historicalFounder: w.created_by, note: "control transferred; substrate untouched; founder preserved" };
}

/**
 * The authored-substrate SANCTITY invariant: a world with authored content OR
 * any visits may NEVER be hard-deleted by a gameplay path. Returns whether a
 * hard delete is permitted (almost always false for a live world).
 */
export function canHardDeleteWorld(db, worldId) {
  if (worldId === "concordia-hub") return { ok: true, allowed: false, reason: "hub_is_eternal" };
  let authored = 0, visits = 0, npcs = 0;
  try { authored = db.prepare(`SELECT authored FROM worlds WHERE id = ?`).get(worldId)?.authored ?? 0; } catch { /* col absent */ }
  try { visits = db.prepare(`SELECT COUNT(*) AS n FROM world_visits WHERE world_id = ?`).get(worldId)?.n ?? 0; } catch { /* table absent */ }
  try { npcs = db.prepare(`SELECT COUNT(*) AS n FROM world_npcs WHERE world_id = ?`).get(worldId)?.n ?? 0; } catch { /* table absent */ }
  const allowed = !authored && visits === 0 && npcs === 0;
  return { ok: true, allowed, reason: allowed ? "empty_unauthored" : "authored_or_visited", authored: !!authored, visits, npcs };
}

/**
 * A conditional god-tier force (canon-tier only): power as a CONDITION over a
 * constant. Returns a buff descriptor the combat/effect path applies via
 * user_active_effects — daylight-amplified, ramp-the-longer-they-fight, regen.
 * No flat global number to balance or arms-race.
 */
export function conditionalGodTierForce(kind, { illumination = null, fightDurationS = 0 } = {}) {
  switch (kind) {
    case "daylight_avatar": {
      // Strong at noon, ordinary at night — energy follows sunlight (reuses the
      // sight_os.illumination channel).
      const lux = Number(illumination) || 0;
      const mult = 1 + Math.min(1.0, lux / 80000); // up to 2x in full sun
      return { effect_id: "daylight_avatar", magnitude: Math.round(mult * 1000) / 1000, conditional: "illumination", durationMs: 60000 };
    }
    case "war_ramp": {
      // The longer the fight, the stronger — a duration ramp, capped.
      const mult = 1 + Math.min(0.6, fightDurationS / 600); // +60% at 10 min
      return { effect_id: "war_ramp", magnitude: Math.round(mult * 1000) / 1000, conditional: "fight_duration", durationMs: 30000 };
    }
    case "eternal_regen":
      return { effect_id: "eternal_regen", magnitude: 0.02, kind: "heal_over_time", conditional: "always", durationMs: 120000 };
    default:
      return null;
  }
}

export const SOVEREIGNTY_CONSTANTS = Object.freeze({ GRACE_WINDOW_S, VALID_TIERS: [...VALID_TIERS] });
