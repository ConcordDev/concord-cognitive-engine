// concord-frontend/components/conkay/lattice-globe-motion.ts
//
// F6 — pure motion math for the lattice globe (K4: honest activity
// visualization). Deliberately framework-free (no three/@react-three/fiber
// imports) so the honesty contract — motion is a function of REAL store
// signals, never fabricated — can be unit-tested without mounting WebGL.
//
// Mirrors ConKayScene's `OrbitalRings` idiom exactly: the caller reads
// `inFlight` + `runDtuRefs.length` via `useConkayHudStore.getState()` inside
// `useFrame` (never a React selector — see OrbitalRings' comment for why),
// and hands the raw numbers to `computeLatticeGlobeMotion` each frame. This
// module contains none of that plumbing on purpose — it only computes "given
// these real facts, what should the globe look like."

export type LatticeGlobeMode = 'idle' | 'working';

export interface LatticeGlobeMotion {
  /** Radians/sec the globe spins at this frame. */
  rotationSpeed: number;
  /** 0..1 wireframe glow/opacity level. */
  glowIntensity: number;
  mode: LatticeGlobeMode;
}

/** Slow — deliberately far calmer than any working-state pulse in the scene. */
const IDLE_BREATH_HZ = 0.6;

export interface LatticeGlobeMotionInput {
  /** Real count of ConKay macro runs currently in flight (conkayHudStore.inFlight). */
  inFlight: number;
  /** Real count of DTU refs the current/most-recent run actually cited (conkayHudStore.runDtuRefs.length). */
  dtuRefCount: number;
  /**
   * Oscillator phase (radians), e.g. `clock.elapsedTime * IDLE_BREATH_HZ` from
   * `useFrame`. Only used in the idle branch. Defaults to 0 for callers (e.g.
   * simple contract tests) that don't care about the breath phase.
   */
  idleBreathPhase?: number;
}

/**
 * Pure gating function — the load-bearing honesty contract for the globe.
 * Given only real signals, returns what the globe should render this frame.
 *
 * Working (inFlight > 0): rotation speed scales with concurrent real runs,
 * clamped via `Math.min(inFlight, 4)` — the exact clamp OrbitalRings uses for
 * `targetVel` — so a burst of concurrent macros can't spin the globe away
 * indefinitely. Glow scales with inFlight AND with the real DTU-ref count of
 * the live run (more cited provenance → a brighter lattice), capped at 1 via
 * an outer `Math.min`, mirroring OrbitalRings' `targetGlow` clamp exactly.
 *
 * Idle (inFlight === 0): a slow sinusoidal "breath" — an order of magnitude
 * slower/dimmer than any working value above — so the globe reads as alive
 * at rest without ever being mistaken for real work. A nonzero dtuRefCount
 * (real citations the last completed run used) nudges the idle baseline up a
 * little; it is still a real signal, never invented, and never approaches
 * working brightness.
 */
export function computeLatticeGlobeMotion({
  inFlight,
  dtuRefCount,
  idleBreathPhase = 0,
}: LatticeGlobeMotionInput): LatticeGlobeMotion {
  const working = inFlight > 0;
  const clampedFlight = Math.min(Math.max(inFlight, 0), 4);
  const clampedRefs = Math.min(Math.max(dtuRefCount, 0), 10);

  if (working) {
    const rotationSpeed = 0.5 + clampedFlight * 0.22;
    const glowIntensity = Math.min(1, 0.4 + inFlight * 0.15 + clampedRefs * 0.015);
    return { rotationSpeed, glowIntensity, mode: 'working' };
  }

  const breath = 0.5 + 0.5 * Math.sin(idleBreathPhase); // 0..1
  const rotationSpeed = 0.03 + breath * 0.02; // ~0.03–0.05 rad/s — a crawl
  const glowIntensity = Math.min(0.3, 0.08 + clampedRefs * 0.01 + breath * 0.06);
  return { rotationSpeed, glowIntensity, mode: 'idle' };
}
