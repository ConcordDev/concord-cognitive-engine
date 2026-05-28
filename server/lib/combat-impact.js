// server/lib/combat-impact.js
//
// T1.4a — server-authoritative impact momentum + poise-stagger model.
//
// The pitch is "bone-mass × angular-velocity impact resolution," but combat
// stagger was driven by raw finalDamage vs a fixed threshold (and a dead
// `stagger_chance` config that was never rolled). This module makes impact a
// real, deterministic momentum quantity and resolves stagger as momentum vs a
// recipient's poise budget — no RNG.
//
// The same curve constants are exported so the client (impact-resolver.ts) can
// recompute identically for prediction; the server value is authoritative.
//
// Units are deliberately game-scaled (not SI) but the RELATIONSHIPS are
// physical: heavier striking mass, higher angular velocity at contact, and a
// longer lever arm all raise transferred momentum — exactly the ordering a
// player expects (a hammer rocks harder than a dagger).

// Effective striking mass (kg-ish) per weapon/strike kind. Grounded in the
// Dempster 1955 segment-mass intuition the biomechanics module already cites:
// an unarmed strike is forearm+hand mass; weapons add their head mass.
const KIND_BONE_MASS = Object.freeze({
  fist:   2.5,
  dagger: 1.2,
  sword:  1.6,
  spear:  2.0,
  axe:    3.6,
  hammer: 5.2,
  staff:  2.2,
  bow:    1.0,
  default: 2.0,
});

// Lever arm (m) — reach from the rotating joint to the contact point.
const KIND_LEVER_ARM = Object.freeze({
  fist:   0.42,
  dagger: 0.45,
  sword:  0.95,
  spear:  1.55,
  axe:    0.85,
  hammer: 0.95,
  staff:  1.40,
  bow:    0.70,
  default: 0.80,
});

// The angular arc (radians) a strike sweeps through between drive and contact.
// Combined with the strike's swing time (startup+active from frame data) this
// yields angular velocity at contact: ω = arc / swingTime.
const SWING_ARC_RAD = 2.4;

// Tier (1..5) amplitude — mastery puts more of the body behind the strike,
// raising contact angular velocity. Matches the biomechanics amplitudeFor band.
function tierAmplitude(tier) {
  const t = Math.max(1, Math.min(5, Math.round(tier || 1)));
  return 0.55 + (t - 1) * 0.15; // 0.55 .. 1.15
}

const NOMINAL_ACTOR_MASS_KG = 80;

/**
 * The dead-simple physical core (mirrored on the client). Angular momentum at
 * contact = effective mass × tangential factor (ω × lever arm).
 */
export function computeImpactMomentum({ boneMass, angularVelocity, leverArmM }) {
  const m = Number(boneMass) || 0;
  const w = Number(angularVelocity) || 0;
  const r = Number(leverArmM) || 0;
  return m * w * r;
}

/**
 * Derive the kinematic inputs for a strike from its weapon kind, mastery tier,
 * actor mass, body scale, and frame data (startup+active govern swing time).
 * Deterministic — no RNG.
 */
export function impactKinematics({ kind = "default", tier = 1, actorMassKg = NOMINAL_ACTOR_MASS_KG, bodyScale = 1, frame = null } = {}) {
  const k = String(kind || "default").toLowerCase();
  const boneMass = (KIND_BONE_MASS[k] ?? KIND_BONE_MASS.default)
    * (Number(actorMassKg) / NOMINAL_ACTOR_MASS_KG)
    * (Number(bodyScale) || 1);
  const leverArmM = (KIND_LEVER_ARM[k] ?? KIND_LEVER_ARM.default) * (Number(bodyScale) || 1);

  const startup = frame?.startup_ms ?? 220;
  const active = frame?.active_ms ?? 100;
  const swingTimeSec = Math.max(0.05, (startup + active) / 1000);
  const angularVelocity = (SWING_ARC_RAD / swingTimeSec) * tierAmplitude(tier);

  return { boneMass, angularVelocity, leverArmM };
}

/**
 * Convenience: kind + tier + frame -> momentum scalar in one call.
 */
export function momentumFor(opts) {
  return computeImpactMomentum(impactKinematics(opts));
}

// ── Poise + stagger resolution ───────────────────────────────────────────────

const BASE_POISE = 13;

// Stance contribution to poise: a planted/braced stance absorbs more; an
// advancing (committed) actor is easier to knock off balance.
const STANCE_POISE_FACTOR = Object.freeze({
  ground: 1.5,   // already grounded — very hard to "knock down" further
  clinch: 1.25,
  low:    1.2,
  high:   1.0,
  aerial: 0.7,   // airborne — easy to send flying
});
const POSTURE_POISE_FACTOR = Object.freeze({
  balanced:  1.0,
  advancing: 0.8,  // weight committed forward
  retreating: 1.1, // already giving ground, rolls with it
  downed:    0.5,
});

/**
 * A recipient's current poise budget — how much impact momentum they can take
 * before staggering. Scales with mass, stance, posture, remaining stamina
 * ("gas"), and an explicit brace/block. Pure.
 */
export function poiseBudget({ massKg = NOMINAL_ACTOR_MASS_KG, stance = "high", posture = "balanced", gasFraction = 1, bracing = false, poiseMul = 1 } = {}) {
  const mass = Math.max(20, Number(massKg) || NOMINAL_ACTOR_MASS_KG) / NOMINAL_ACTOR_MASS_KG;
  const stanceF = STANCE_POISE_FACTOR[stance] ?? 1.0;
  const postureF = POSTURE_POISE_FACTOR[posture] ?? 1.0;
  const gasF = 0.6 + 0.4 * Math.max(0, Math.min(1, gasFraction)); // tired = less poise
  const braceF = bracing ? 1.6 : 1.0;
  return BASE_POISE * mass * stanceF * postureF * gasF * braceF * (Number(poiseMul) || 1);
}

// Hit-angle multiplier — momentum applied off-centre (flank/back) or to an
// unprepared facing breaks poise harder. Caller passes a 0..1 "off-axis"
// fraction (0 = dead-on front, 1 = directly behind).
function angleFactor(offAxis = 0) {
  const a = Math.max(0, Math.min(1, Number(offAxis) || 0));
  return 1 + a * 0.6; // up to 1.6× from the back
}

/**
 * Resolve a hit into a graded stagger severity, deterministically.
 *
 *   none      — poise held
 *   flinch    — minor break (brief reaction)
 *   rocked    — staggered (the existing rocked state)
 *   knockdown — poise shattered (sent down/back)
 *
 * @returns {{ severity, momentum, poise, effective, overflowRatio }}
 */
export function resolvePoiseStagger({ momentum, poise, offAxis = 0 } = {}) {
  const eff = (Number(momentum) || 0) * angleFactor(offAxis);
  const p = Math.max(0.001, Number(poise) || 0.001);
  const ratio = (eff - p) / p; // <0 held, 0..0.5 flinch, 0.5..1.2 rocked, >1.2 knockdown
  let severity = "none";
  if (ratio >= 1.2) severity = "knockdown";
  else if (ratio >= 0.5) severity = "rocked";
  else if (ratio >= 0) severity = "flinch";
  return { severity, momentum: eff, poise: p, effective: eff, overflowRatio: ratio };
}

export const IMPACT_CONSTANTS = Object.freeze({
  KIND_BONE_MASS, KIND_LEVER_ARM, SWING_ARC_RAD, BASE_POISE,
  STANCE_POISE_FACTOR, POSTURE_POISE_FACTOR, NOMINAL_ACTOR_MASS_KG,
});
