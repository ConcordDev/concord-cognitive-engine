/**
 * VU meter and tuner maths, pure so they can be tested and so the needles are
 * a function of the measured signal only.
 *
 * Alignment: 0 VU = −18 dBFS RMS (the common broadcast/DAW calibration).
 * Scale: a VU face is linear in voltage, so the needle position is
 * proportional to 10^(VU/20) between −20 VU and +3 VU, across a 96° sweep.
 * Ballistics: a VU needle reaches 99% of a step in 300 ms, which is a time
 * constant of 300 / ln(100) ≈ 65 ms.
 */

export const VU_REF_DBFS = -18;
export const VU_MIN = -20;
export const VU_MAX = 3;
export const VU_SWEEP_DEG = 96;
export const VU_TAU_SEC = 0.3 / Math.log(100);

export function dbfsToVu(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return VU_MIN;
  return Math.max(VU_MIN, Math.min(VU_MAX, dbfs - VU_REF_DBFS));
}

/** Needle angle in degrees, −48 (pinned left) … +48 (pinned right). */
export function vuAngle(vu: number): number {
  const v = Math.max(VU_MIN, Math.min(VU_MAX, Number.isFinite(vu) ? vu : VU_MIN));
  const lo = Math.pow(10, VU_MIN / 20);
  const hi = Math.pow(10, VU_MAX / 20);
  const p = (Math.pow(10, v / 20) - lo) / (hi - lo);
  return -VU_SWEEP_DEG / 2 + p * VU_SWEEP_DEG;
}

/** One ballistic step toward `target` after `dtSec` of real time. */
export function vuStep(prev: number, target: number, dtSec: number): number {
  const dt = Math.max(0, Math.min(1, Number.isFinite(dtSec) ? dtSec : 0));
  const k = 1 - Math.exp(-dt / VU_TAU_SEC);
  return prev + (target - prev) * k;
}

/** Tuner needle: ±50 cents maps onto ±45°. In tune when within ±5 cents. */
export const TUNER_LOCK_CENTS = 5;
export function tunerAngle(cents: number): number {
  const c = Math.max(-50, Math.min(50, Number.isFinite(cents) ? cents : 0));
  return (c / 50) * 45;
}
