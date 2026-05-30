// concord-frontend/lib/concordia/traversal-kinematics.ts
//
// Part B (B1/B2) — PURE kinematics for the traversal verb set + momentum
// preservation, so the math is unit-testable without Rapier. physics-world holds
// the state and calls these; AvatarSystem3D drives the input.
//
// Principles (Crimson Desert / Prototype / inFamous): a dash is a short
// directional velocity burst with brief i-frames; a slide preserves sprint
// momentum into a low crouch; momentum decays rather than snapping to zero so
// transitions (sprint→dodge→attack) feel connected ("never stop moving").

export interface TraversalState {
  /** Dash burst velocity (m/s) at onset; decays to 0 over the dash window. */
  dashVx: number;
  dashVz: number;
  dashStartedAt: number; // wall-clock ms
  dashExpiresAt: number; // wall-clock ms (0 = no dash)
  /** Wall-clock ms until invulnerability frames end (0 = vulnerable). */
  iframeUntil: number;
  /** Slide active (crouch while moving fast). */
  sliding: boolean;
  /** Persistent horizontal momentum (m/s) carried across state transitions. */
  momX: number;
  momZ: number;
}

export const TRAVERSAL = Object.freeze({
  DASH_SPEED: 12,        // m/s burst
  DASH_DURATION_MS: 260, // dash lasts this long
  IFRAME_MS: 180,        // i-frames from dash onset (dodge window)
  MOMENTUM_DECAY: 3.5,   // per-second exponential-ish decay rate
  SLIDE_MIN_SPEED: 4.0,  // need at least this much momentum to start a slide
});

export function freshTraversalState(): TraversalState {
  return { dashVx: 0, dashVz: 0, dashStartedAt: 0, dashExpiresAt: 0, iframeUntil: 0, sliding: false, momX: 0, momZ: 0 };
}

/** Begin a dash in a (normalized-ish) direction. Mutates + returns the state. */
export function beginDash(
  st: TraversalState,
  dirX: number,
  dirZ: number,
  now: number,
  speed: number = TRAVERSAL.DASH_SPEED,
): TraversalState {
  const len = Math.hypot(dirX, dirZ) || 1;
  st.dashVx = (dirX / len) * speed;
  st.dashVz = (dirZ / len) * speed;
  st.dashStartedAt = now;
  st.dashExpiresAt = now + TRAVERSAL.DASH_DURATION_MS;
  st.iframeUntil = now + TRAVERSAL.IFRAME_MS;
  return st;
}

/** True while a dash is active (used to gate re-dash + drive the clip). */
export function isDashing(st: TraversalState, now: number): boolean {
  return st.dashExpiresAt > now;
}

/** True during the dodge i-frame window (combat damage should be ignored). */
export function isInvulnerable(st: TraversalState, now: number): boolean {
  return st.iframeUntil > now;
}

/**
 * Current dash velocity contribution (m/s), linearly decaying to 0 across the
 * dash window. Returns {vx,vz}=0 when no dash is active.
 */
export function dashVelocityAt(st: TraversalState, now: number): { vx: number; vz: number } {
  if (st.dashExpiresAt <= now || st.dashExpiresAt <= st.dashStartedAt) return { vx: 0, vz: 0 };
  const frac = (st.dashExpiresAt - now) / (st.dashExpiresAt - st.dashStartedAt); // 1→0
  return { vx: st.dashVx * frac, vz: st.dashVz * frac };
}

/**
 * Carry + decay horizontal momentum. `inputVx/Vz` is the player's intended
 * locomotion this frame; momentum eases toward it (so it never snaps) and
 * decays toward zero when there's no input. Returns the blended {vx,vz} to move
 * by AND updates st.momX/momZ. This is the "never stop moving" core.
 */
export function stepMomentum(
  st: TraversalState,
  inputVx: number,
  inputVz: number,
  dt: number,
  decay: number = TRAVERSAL.MOMENTUM_DECAY,
): { vx: number; vz: number } {
  const k = Math.max(0, Math.min(1, decay * dt)); // ease factor
  // Ease current momentum toward the input (preserves carry, no hard reset).
  st.momX += (inputVx - st.momX) * k;
  st.momZ += (inputVz - st.momZ) * k;
  // Snap tiny residuals to zero so we don't drift forever.
  if (Math.abs(st.momX) < 1e-3) st.momX = 0;
  if (Math.abs(st.momZ) < 1e-3) st.momZ = 0;
  return { vx: st.momX, vz: st.momZ };
}

/** Current horizontal momentum magnitude (m/s) — used for context-sensitive verbs. */
export function momentumMagnitude(st: TraversalState): number {
  return Math.hypot(st.momX, st.momZ);
}

/** Begin a slide if moving fast enough; returns true if it started. */
export function tryBeginSlide(st: TraversalState): boolean {
  if (momentumMagnitude(st) < TRAVERSAL.SLIDE_MIN_SPEED) return false;
  st.sliding = true;
  return true;
}

export function endSlide(st: TraversalState): void {
  st.sliding = false;
}
