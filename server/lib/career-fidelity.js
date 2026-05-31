// server/lib/career-fidelity.js
//
// WAVE JOBS — the 3-fidelity dial + the ActionResolver (the genuinely-new
// keystone; no such dial exists today). Every job/sport action resolves at one
// of three fidelities, switchable at action boundaries:
//   DELEGATE (sim)   — attributes resolve the outcome, no human input, passive
//                      wage (the Sims timer / FM "Instant Result").
//   COACH (watch)    — sim outcome the player can nudge slightly.
//   PLAY (yourself)  — the player's real skill-input drives it; better pay + XP.
// The ActionResolver rule (shared with combat/craft-resolve): ATTRIBUTES set a
// FLOOR-GATED band; human input BIASES within it, never bypasses — a low-
// attribute action has a low ceiling (2K: "<30% shots can't be greened"), a
// high-attribute one has a high floor. Pure + deterministic (injected rng).

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const clamp01 = (x) => clamp(Number(x) || 0, 0, 1);

export const FIDELITIES = Object.freeze(["delegate", "coach", "play"]);

// Play pays best (you did the work); delegate is the passive floor.
export const FIDELITY_PAY_MULT = Object.freeze({ delegate: 0.7, coach: 0.85, play: 1.0 });
export const FIDELITY_XP_MULT = Object.freeze({ delegate: 0.5, coach: 0.75, play: 1.0 });

export const SKILL_WEIGHT = 0.4;  // how far human input can shift outcome (±)
export const FLOOR_FRAC = 0.4;    // attributes keep ≥40% even on bad input
export const CEIL_FRAC = 0.6;     // skill can claim ≤60% of the headroom (can't green a bad attribute)

/**
 * The ActionResolver. attribute (0..1) sets the achievable band
 * [attribute·FLOOR_FRAC, attribute + (1−attribute)·CEIL_FRAC]; skillInput (0..1)
 * biases ±SKILL_WEIGHT within it. Returns the realized outcome probability +
 * the band (so callers can show the player how much was them vs their stats).
 * @returns {{ outcome:number, floor:number, ceiling:number, attribute:number }}
 */
export function resolveAction({ attribute = 0.5, skillInput = 0.5 } = {}) {
  const a = clamp01(attribute);
  const lo = a * FLOOR_FRAC;
  const hi = a + (1 - a) * CEIL_FRAC;
  const shift = (clamp01(skillInput) - 0.5) * 2 * SKILL_WEIGHT; // −w..+w around the attribute baseline
  const outcome = clamp(a + shift, lo, hi);
  return { outcome, floor: lo, ceiling: hi, attribute: a };
}

/**
 * Resolve one work session at a fidelity → a performanceScore (0..1) the
 * career-engine turns into pay + promotion XP.
 *   delegate/coach: attribute-driven sim (+ a small coach nudge), deterministic
 *     from rng so leagues/NPC jobs tick the same with nobody watching.
 *   play: the player's real skillInput biases within the floor-gated band.
 * @returns {{ mode:string, performanceScore:number, band:{floor,ceiling} }}
 */
export function resolveSession(mode, { attribute = 0.5, skillInput = 0.5, coachNudge = 0, rng = Math.random } = {}) {
  const m = FIDELITIES.includes(mode) ? mode : "delegate";
  const a = clamp01(attribute);
  let perf;
  let band = { floor: a * FLOOR_FRAC, ceiling: a + (1 - a) * CEIL_FRAC };
  if (m === "play") {
    const r = resolveAction({ attribute: a, skillInput });
    perf = r.outcome;
    band = { floor: r.floor, ceiling: r.ceiling };
  } else {
    // sim: noisy draw centred on the attribute, kept inside the band; coach
    // adds a bounded positive nudge.
    const noise = (rng() - 0.5) * 0.2;
    perf = clamp(a + noise + (m === "coach" ? clamp01(coachNudge) * 0.15 : 0), band.floor, band.ceiling);
  }
  return { mode: m, performanceScore: clamp01(perf), band };
}

/** Pay/XP multipliers for a fidelity (play rewards doing it yourself). */
export function fidelityPayMultiplier(mode) { return FIDELITY_PAY_MULT[mode] ?? FIDELITY_PAY_MULT.delegate; }
export function fidelityXpMultiplier(mode) { return FIDELITY_XP_MULT[mode] ?? FIDELITY_XP_MULT.delegate; }
