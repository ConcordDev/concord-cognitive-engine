// server/lib/combat/impact-feel.js
//
// T1.4b — client combat-feel, server-authoritative.
//
// T1.4a made stagger a real, deterministic IMPACT MOMENTUM quantity
// (bone-mass × angular-velocity × lever) resolved against the recipient's
// poise budget into a graded severity (none/flinch/rocked/knockdown). But the
// client still derived its hitstop + knockback + wince from a local heuristic
// (damage > 25 ⇒ "heavy", crit, kill) in GameJuice.tsx — so a feather-light
// dagger crit shoved a target as hard as a warhammer, and a poise-breaking
// hammer blow that didn't crit produced no knockback at all. The *feel* and
// the *physics* disagreed.
//
// These pure helpers map the server's poise severity (+ the momentum that
// produced it) into the exact "feel" parameters the client applies verbatim:
// per-entity hitstop windows, a knockback impulse magnitude, and a wince
// reaction severity. The mapping lives server-side so it's deterministic,
// testable, and impossible for a client to inflate. The client bridge
// (CombatImpactFeelBridge) consumes `combat:impact` and dispatches the same
// `concordia:hit-pause` / `concordia:knockback` / `concordia:hit-reaction`
// CustomEvents the avatar update loop already honours — it no longer invents
// its own magnitudes.

/**
 * Feel table keyed by poise severity. Tuned against the existing client
 * heuristic so nothing feels weaker than before, but now graded by physics:
 *   - flinch    : a small head-snap wince, no shove (light hit landed clean).
 *   - rocked    : real stagger — meaningful hitstop on both ends + a shove.
 *   - knockdown : poise broken — long hitstop, hard shove, topple reaction.
 * A kill is always treated as at-least-knockdown so a finishing blow reads big.
 */
export const SEVERITY_FEEL = Object.freeze({
  none:      Object.freeze({ targetPauseMs: 0,   attackerPauseMs: 0,  knockback: 0,   knockMs: 0,   wince: "none"  }),
  flinch:    Object.freeze({ targetPauseMs: 55,  attackerPauseMs: 0,  knockback: 0,   knockMs: 0,   wince: "light" }),
  rocked:    Object.freeze({ targetPauseMs: 115, attackerPauseMs: 45, knockback: 4.5, knockMs: 220, wince: "heavy" }),
  knockdown: Object.freeze({ targetPauseMs: 205, attackerPauseMs: 60, knockback: 7.5, knockMs: 340, wince: "crit"  }),
});

const ORDER = ["none", "flinch", "rocked", "knockdown"];

/** The stronger of two severities (used so a kill never reads smaller). */
export function maxSeverity(a, b) {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  return ORDER[Math.max(ia < 0 ? 0 : ia, ib < 0 ? 0 : ib)];
}

/**
 * Resolve the feel parameters for a landed hit. `momentum` nudges the
 * knockback magnitude within ±~25% so a heavier weapon shoves harder for the
 * same severity tier (a warhammer rocked vs a longsword rocked still differ),
 * while staying inside a sane band so it can't be exploited.
 */
// T3.4 balance dial — global knockback multiplier. 1.0 = tuned default; lower
// for a grittier/grounded feel, higher for a more arcadey shove. Bounded so a
// bad value can't launch entities off the map.
function knockbackScale() {
  const v = Number(process.env.CONCORD_KNOCKBACK_SCALE);
  return Number.isFinite(v) && v > 0 ? Math.min(3, v) : 1;
}

export function impactFeel(severity, momentum = 0) {
  const base = SEVERITY_FEEL[severity] || SEVERITY_FEEL.none;
  const m = Number.isFinite(momentum) ? momentum : 0;
  // Momentum ~120 is a nominal sword swing; ~250 a heavy hammer. Scale 0.8–1.3.
  const scale = base.knockback > 0 ? Math.max(0.8, Math.min(1.3, 0.7 + m / 320)) : 1;
  return {
    targetPauseMs: base.targetPauseMs,
    attackerPauseMs: base.attackerPauseMs,
    knockback: Math.round(base.knockback * scale * knockbackScale() * 10) / 10,
    knockMs: base.knockMs,
    wince: base.wince,
  };
}

/**
 * Build the `combat:impact` socket payload from the server-authoritative
 * stagger result. Everything the client needs to apply the feel verbatim.
 */
export function buildImpactPayload({
  worldId = null,
  attackerId = null,
  targetId = null,
  targetKind = "npc",
  severity = "none",
  momentum = 0,
  element = "none",
  damage = 0,
  isKill = false,
  targetPosition = null,
  attackerPosition = null,
} = {}) {
  const effective = isKill ? maxSeverity(severity, "knockdown") : severity;
  const feel = impactFeel(effective, momentum);
  return {
    worldId,
    attackerId,
    targetId,
    targetKind,
    severity: effective,
    impactMomentum: Math.round((Number(momentum) || 0) * 10) / 10,
    element,
    damage: Math.round((Number(damage) || 0) * 10) / 10,
    isKill: !!isKill,
    targetPosition,
    attackerPosition,
    feel,
    ts: Date.now(),
  };
}
