// server/lib/combat/executions.js
//
// F3.1 hyperarmor + F3.2 execution moves — combat expressivity.
//
//   Hyperarmor: a committed heavy attacker, mid-active-frames, shrugs off
//   flinch/rocked (their attack continues); only a knockdown still interrupts.
//   F3.2 executions:
//     - backstab   : a hit landed off-axis (flank/back, offAxis high) crits hard.
//     - deathblow  : a hit on an already-rocked/knocked target executes for a
//                    burst (posture-break payoff).
//   Both are damage multipliers the combat route applies; the stagger model
//   (combat-impact) governs whether the contact lands. Pure resolvers + thin
//   DB helpers — deterministic, no RNG.

const HYPERARMOR_DEFAULT_MS = 450; // a heavy swing's active+commit window
const BACKSTAB_OFFAXIS_MIN = 0.6;  // angleFactor band where it reads as a back hit
const BACKSTAB_MULT = 2.0;
const DEATHBLOW_MULT = 2.5;

/** Grant the attacker a hyperarmor window (called when a heavy attack commits). */
export function grantHyperarmor(db, { actorKind, actorId, durationMs = HYPERARMOR_DEFAULT_MS, nowMs } = {}) {
  if (!db || !actorKind || !actorId) return { ok: false };
  const until = (nowMs ?? Date.now()) + Math.max(0, durationMs);
  try {
    db.prepare(`UPDATE combat_actor_state SET hyperarmor_until_ms = ?, updated_at = unixepoch() WHERE actor_kind = ? AND actor_id = ?`)
      .run(until, actorKind, actorId);
    return { ok: true, until };
  } catch { return { ok: false }; }
}

/** Is this actor currently within a hyperarmor window? */
export function hasHyperarmor(db, { actorKind, actorId, nowMs } = {}) {
  if (!db || !actorKind || !actorId) return false;
  try {
    const row = db.prepare(`SELECT hyperarmor_until_ms FROM combat_actor_state WHERE actor_kind = ? AND actor_id = ?`)
      .get(actorKind, actorId);
    return !!row && (row.hyperarmor_until_ms || 0) > (nowMs ?? Date.now());
  } catch { return false; }
}

/**
 * Hyperarmor downgrade (pure): under active hyperarmor, flinch + rocked are
 * absorbed (severity 'none', absorbed:true); knockdown still lands.
 */
export function applyHyperarmorDowngrade(severity, hyperarmorActive) {
  if (!hyperarmorActive) return { severity, absorbed: false };
  if (severity === "flinch" || severity === "rocked") return { severity: "none", absorbed: true };
  return { severity, absorbed: false }; // knockdown + none pass through
}

/**
 * Resolve an execution multiplier (pure). offAxis 0..1 (back = high);
 * targetSeverity is the recipient's CURRENT stagger state before this hit.
 * Returns { kind: 'backstab'|'deathblow'|'none', multiplier }.
 * Deathblow (target already broken) wins over backstab when both apply.
 */
export function resolveExecution({ offAxis = 0, targetSeverity = "none" } = {}) {
  const broken = targetSeverity === "rocked" || targetSeverity === "knockdown";
  if (broken) return { kind: "deathblow", multiplier: DEATHBLOW_MULT };
  if ((Number(offAxis) || 0) >= BACKSTAB_OFFAXIS_MIN) return { kind: "backstab", multiplier: BACKSTAB_MULT };
  return { kind: "none", multiplier: 1 };
}

/** Current rocked/knockdown state of an actor (for deathblow detection). */
export function currentStaggerSeverity(db, { actorKind, actorId, nowMs } = {}) {
  if (!db || !actorKind || !actorId) return "none";
  try {
    const row = db.prepare(`SELECT rocked_until_ms FROM combat_actor_state WHERE actor_kind = ? AND actor_id = ?`)
      .get(actorKind, actorId);
    return row && (row.rocked_until_ms || 0) > (nowMs ?? Date.now()) ? "rocked" : "none";
  } catch { return "none"; }
}

/**
 * A3 — compute offAxis (0 = dead front, 1 = dead behind) from the target's
 * facing yaw and the attacker's position. Pure. Feeds both the backstab
 * execution (resolveExecution) and the poise-break angle factor.
 */
export function offAxisFromFacing(targetYaw, targetPos, attackerPos) {
  if (!targetPos || !attackerPos) return 0;
  const dx = attackerPos.x - targetPos.x;
  const dz = (attackerPos.z ?? 0) - (targetPos.z ?? 0);
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return 0;
  // Target facing unit vector from yaw (z-forward convention, matches the
  // renderer's sin/cos heading).
  const fx = Math.sin(Number(targetYaw) || 0);
  const fz = Math.cos(Number(targetYaw) || 0);
  const dot = (fx * dx + fz * dz) / len; // +1 attacker in front, −1 behind
  return Math.max(0, Math.min(1, (1 - dot) / 2));
}

export const EXECUTION_CONSTANTS = Object.freeze({
  HYPERARMOR_DEFAULT_MS, BACKSTAB_OFFAXIS_MIN, BACKSTAB_MULT, DEATHBLOW_MULT,
});
