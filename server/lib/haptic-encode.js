// server/lib/haptic-encode.js
//
// Haptic encoding (#44) — turns a REAL combat impact (the server-authoritative
// momentum from lib/combat-impact.js + the poise-severity feel from
// lib/combat/impact-feel.js) into a controller rumble pattern: a Web Gamepad
// dual-rumble effect ({duration, strongMagnitude, weakMagnitude}, the exact
// shape navigator.getGamepads()[i].vibrationActuator.playEffect('dual-rumble',…)
// takes) plus a sampled ADSR envelope for finer actuators. Pure deterministic
// math over real combat quantities. The device PLAY is the client's real
// Gamepad API call — this module only encodes; it never fakes a device.

import { impactFeel } from "./combat/impact-feel.js";
import { momentumFor } from "./combat-impact.js";

const MOMENTUM_FULL = 260; // ≈ a heavy hammer blow → peak rumble

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round = (v) => Math.round(v * 1000) / 1000;

// Severity floors so even a light flinch is felt, and a knockdown saturates.
const SEVERITY_FLOOR = { none: 0, flinch: 0.2, rocked: 0.5, knockdown: 0.8 };

/**
 * Encode a haptic pattern from an impact.
 * @param {object} opts { severity, momentum }
 * @returns {{durationMs, strongMagnitude, weakMagnitude, peak, envelope:[{t, amp}]}}
 */
export function waveformFromImpact({ severity = "flinch", momentum = 0 } = {}) {
  const feel = impactFeel(severity, momentum);
  // Real timing: the felt event lasts the hitstop + the knockback window.
  const durationMs = Math.max(40, feel.targetPauseMs + feel.knockMs);
  // Peak amplitude: momentum-driven, floored by severity so the tier is always felt.
  const momentumAmp = clamp01(Number(momentum) / MOMENTUM_FULL);
  const peak = round(clamp01(Math.max(SEVERITY_FLOOR[severity] ?? 0, momentumAmp)));
  // Dual-rumble: strong = low-frequency (the thud), weak = high-frequency (the snap).
  const strongMagnitude = peak;
  const weakMagnitude = round(peak * 0.6);
  return { durationMs, strongMagnitude, weakMagnitude, peak, envelope: adsr(peak) };
}

/** Convenience: encode straight from strike inputs (kind/tier/frame → momentum). */
export function waveformFor({ severity = "rocked", ...kinematics } = {}) {
  const momentum = momentumFor(kinematics);
  return { ...waveformFromImpact({ severity, momentum }), momentum: round(momentum) };
}

/**
 * Sampled attack/decay envelope (amplitude over normalized time). The attack
 * apex is an explicit sample so the envelope genuinely reaches the peak; the
 * rest is a linear decay to rest. Fast attack, longer decay — a strike's shape.
 */
function adsr(peak) {
  const attackFrac = 0.18;
  const ts = [0, attackFrac, 0.35, 0.5, 0.65, 0.8, 0.92, 1];
  return ts.map((t) => {
    const amp = t <= attackFrac ? peak * (t / attackFrac) : peak * (1 - (t - attackFrac) / (1 - attackFrac));
    return { t: round(t), amp: round(Math.max(0, amp)) };
  });
}

export default { waveformFromImpact, waveformFor };
