// concord-frontend/components/conkay/orbital-rings-motion.ts
//
// F8 — pure motion math for `ConKayScene`'s OrbitalRings, extracted verbatim
// from the previous inline `useFrame` body so the honest gating (rings spin +
// glow IFF a real macro is in flight, never ambiently) is unit-testable without
// mounting Three.js/R3F. Mirrors `lattice-globe-motion.ts`'s F6 approach exactly.
//
// The one real input is `conkayHudStore.inFlight` — the count of ConKay macro
// runs the backend currently reports as started-but-not-completed. When it is 0
// the rings' target velocity AND glow are BOTH exactly 0: no ambient motion,
// nothing to mistake for activity. Feed the returned targets into the same
// easing idiom the component already uses (ease `vel`/`glow` toward the target).

export type OrbitalRingsMode = 'idle' | 'working';

export interface OrbitalRingsMotion {
  /** Target angular velocity (rad/s) the group eases toward this frame. */
  velocity: number;
  /** Target 0..1 glow level the rings ease toward — drives emissive brightness. */
  glowIntensity: number;
  mode: OrbitalRingsMode;
}

/**
 * Pure gating function — the honesty contract for the orbital scanner rings.
 * Preserves the exact numbers the inline code used:
 *   working (inFlight > 0): velocity 0.6 + min(inFlight,4)*0.18, glow min(1, 0.35 + inFlight*0.18)
 *   idle    (inFlight ===0): velocity 0, glow 0
 * so idle is genuinely still + dark and working scales gently with concurrent
 * real runs (clamped so a burst can't runaway-spin). Defensive against
 * non-finite/negative input (treated as idle).
 */
export function computeOrbitalRingsTarget(inFlight: number): OrbitalRingsMotion {
  const flight = Number.isFinite(inFlight) ? inFlight : 0;
  const working = flight > 0;
  const velocity = working ? 0.6 + Math.min(flight, 4) * 0.18 : 0;
  const glowIntensity = working ? Math.min(1, 0.35 + flight * 0.18) : 0;
  return { velocity, glowIntensity, mode: working ? 'working' : 'idle' };
}
