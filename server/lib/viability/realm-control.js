// server/lib/viability/realm-control.js
//
// Wave 5 #19 — civilization-as-control: a realm is a system held inside its
// viable set by FEEDBACK. Legitimacy (0..100) is the measured state; tax_rate
// is the actuator. A PID controller (the shipped N5 core) drives legitimacy
// toward a stable setpoint by easing taxes when the people are restless and
// raising them when the ruler can afford to — a self-governing ruler that
// doesn't let legitimacy crater into rebellion. Pure controller + a thin
// transparent plant (the populace responds to the tax burden). Behind
// CONCORD_REALM_CONTROL; off == today.

import { pidStep } from "../control/pid.js";

export function realmControlEnabled() {
  return process.env.CONCORD_REALM_CONTROL !== "0";
}

export const LEGITIMACY_SETPOINT = 60;          // the viable target
export const REALM_GAINS = { kp: 0.003, ki: 0.0008, kd: 0.0015 };
export const TAX_MIN = 0.0;
export const TAX_MAX = 0.5;
export const MAX_TAX_STEP = 0.03;               // bounded actuation per tick
export const LEGIT_RELAX_RATE = 0.25;           // how fast the populace moves toward its tax-set mood

const clampNum = (x, lo, hi) => Math.max(lo, Math.min(hi, Number(x) || 0));

/** The legitimacy the populace settles at under a given tax burden (heavier tax
 *  → lower contentment). tax 0 → ~100, 0.25 → ~60 (the setpoint), 0.5 → ~20. */
export function legitimacyTargetFor(tax) {
  return clampNum(100 - 160 * clampNum(tax, TAX_MIN, TAX_MAX), 0, 100);
}

/**
 * One control step for a realm. error = setpoint − legitimacy. When legitimacy
 * is BELOW the setpoint the controller eases tax (Δtax < 0) to win the people
 * back; ABOVE, it can raise tax (Δtax > 0). Bounded to ±MAX_TAX_STEP.
 *
 * @returns {{ newTax:number, deltaTax:number, integral:number, prevError:number, error:number }}
 */
export function recommendTax(realm, prior = {}, gains = REALM_GAINS) {
  const legitimacy = clampNum(realm.legitimacy, 0, 100);
  const tax = clampNum(realm.tax_rate, TAX_MIN, TAX_MAX);
  const { output, integral, prevError, error } = pidStep(gains, LEGITIMACY_SETPOINT, legitimacy, prior, 1, { iMin: -200, iMax: 200 });
  // error > 0 (legitimacy below target) → ease tax → Δtax < 0. So Δtax = −output.
  const deltaTax = Math.max(-MAX_TAX_STEP, Math.min(MAX_TAX_STEP, -output));
  const newTax = clampNum(tax + deltaTax, TAX_MIN, TAX_MAX);
  return { newTax, deltaTax, integral, prevError, error };
}

/**
 * The plant: legitimacy relaxes (first-order) toward the tax-set target. This
 * closes the loop — easing tax (the controller's correction when legitimacy is
 * low) raises the target, so legitimacy climbs back toward the setpoint.
 * Returns the next legitimacy (clamped 0..100).
 */
export function legitimacyResponse(legitimacy, newTax, rate = LEGIT_RELAX_RATE) {
  const cur = clampNum(legitimacy, 0, 100);
  const target = legitimacyTargetFor(newTax);
  return clampNum(cur + clampNum(rate, 0, 1) * (target - cur), 0, 100);
}
