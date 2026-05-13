// server/lib/actor-physique.js
//
// Concordia Phase 3 — actor physique reads + mass-based damage modulation.
//
// Sits alongside lib/bloodline-powers.js. The combat path in
// routes/worlds.js#/combat/attack consults both: bloodline modulates
// elemental potency, mass modulates physical impact. Both run AFTER
// the anti-cheat damage cap (_validateDamageCap) so the cap stays a
// tight bound on raw computed damage and the multipliers compose
// cleanly without giving clients an exploit surface.
//
// Mass multiplier:
//   ratio = attacker.mass_kg / target.mass_kg
//   multiplier = clamp(ratio, 0.7, 1.4)
//
// A 100 kg attacker hitting a 60 kg target → ratio 1.67 → clamped 1.4
// (heavy advantage). A 50 kg attacker hitting a 100 kg target →
// ratio 0.5 → clamped 0.7 (light disadvantage). Identity (same mass)
// → 1.0 (no change).
//
// `getPhysique(db, actor_kind, actor_id)` returns the row or a
// defaults stub (mass=75, height=1.75, body_type=average) when there's
// no row. This preserves pre-Phase-3 combat semantics for actors with
// no physique data.

import logger from "../logger.js";

const DEFAULT_MASS_KG   = 75.0;
const DEFAULT_HEIGHT_M  = 1.75;
const DEFAULT_BODY_TYPE = "average";

const MASS_RATIO_MIN = 0.7;
const MASS_RATIO_MAX = 1.4;

const VALID_BODY_TYPES = new Set(["slim", "average", "stocky", "tall"]);

export function getPhysique(db, actorKind, actorId) {
  if (!db || !actorKind || !actorId) {
    return defaultsRow(actorKind, actorId);
  }
  try {
    const row = db.prepare(`
      SELECT actor_kind, actor_id, mass_kg, height_m, body_type, updated_at
      FROM actor_physique WHERE actor_kind = ? AND actor_id = ?
    `).get(actorKind, actorId);
    return row || defaultsRow(actorKind, actorId);
  } catch {
    return defaultsRow(actorKind, actorId);
  }
}

function defaultsRow(actorKind, actorId) {
  return {
    actor_kind: actorKind || "player",
    actor_id: actorId || "",
    mass_kg: DEFAULT_MASS_KG,
    height_m: DEFAULT_HEIGHT_M,
    body_type: DEFAULT_BODY_TYPE,
    is_default: true,
  };
}

/**
 * Set / upsert an actor's physique. Validates ranges. Returns
 * { ok, action, ... } and logs failures via the standard logger.
 */
export function setPhysique(db, actorKind, actorId, { mass_kg, height_m, body_type } = {}) {
  if (!db || !actorKind || !actorId) return { ok: false, reason: "missing_inputs" };
  if (!["player", "npc"].includes(actorKind)) return { ok: false, reason: "bad_actor_kind" };
  const m = Number.isFinite(mass_kg) ? Number(mass_kg) : DEFAULT_MASS_KG;
  const h = Number.isFinite(height_m) ? Number(height_m) : DEFAULT_HEIGHT_M;
  const bt = body_type && VALID_BODY_TYPES.has(body_type) ? body_type : DEFAULT_BODY_TYPE;
  if (m < 20 || m > 300) return { ok: false, reason: "mass_out_of_range" };
  if (h < 0.8 || h > 2.5) return { ok: false, reason: "height_out_of_range" };
  try {
    db.prepare(`
      INSERT INTO actor_physique (actor_kind, actor_id, mass_kg, height_m, body_type)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(actor_kind, actor_id) DO UPDATE
        SET mass_kg = excluded.mass_kg,
            height_m = excluded.height_m,
            body_type = excluded.body_type,
            updated_at = unixepoch()
    `).run(actorKind, actorId, m, h, bt);
    return { ok: true, action: "set", actorKind, actorId, mass_kg: m, height_m: h, body_type: bt };
  } catch (err) {
    try { logger.warn?.("actor_physique_set_failed", { actorKind, actorId, error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: "insert_failed" };
  }
}

/**
 * Compute the mass-based combat multiplier. Clamps the raw ratio to
 * [0.7, 1.4] so the gate stays an extra-cheap-but-bounded layer on
 * top of _validateDamageCap. Returns the raw + clamped ratio so
 * callers can log the underlying physics for forensic trails.
 */
export function massMultiplier(attackerMassKg, targetMassKg) {
  const a = Number.isFinite(attackerMassKg) && attackerMassKg > 0 ? Number(attackerMassKg) : DEFAULT_MASS_KG;
  const t = Number.isFinite(targetMassKg) && targetMassKg > 0 ? Number(targetMassKg) : DEFAULT_MASS_KG;
  const raw = a / t;
  const clamped = Math.max(MASS_RATIO_MIN, Math.min(MASS_RATIO_MAX, raw));
  return { raw, multiplier: clamped, identity: a === t };
}

/** Combat-path entry point: read both physiques + compute multiplier. */
export function combatMassMultiplier(db, attacker, target) {
  if (!db || !attacker || !target) return { multiplier: 1.0, kind: "no_input" };
  const a = getPhysique(db, attacker.kind, attacker.id);
  const t = getPhysique(db, target.kind, target.id);
  const m = massMultiplier(a.mass_kg, t.mass_kg);
  return {
    multiplier: m.multiplier,
    rawRatio: m.raw,
    attackerMassKg: a.mass_kg,
    targetMassKg: t.mass_kg,
    identity: m.identity,
  };
}

export const PHYSIQUE_CONSTANTS = Object.freeze({
  DEFAULT_MASS_KG, DEFAULT_HEIGHT_M, DEFAULT_BODY_TYPE,
  MASS_RATIO_MIN, MASS_RATIO_MAX, VALID_BODY_TYPES: Array.from(VALID_BODY_TYPES),
});
