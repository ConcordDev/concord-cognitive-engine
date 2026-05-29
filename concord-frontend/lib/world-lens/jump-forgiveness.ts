// concord-frontend/lib/world-lens/jump-forgiveness.ts
//
// B1 — the movement "forgiveness layer" platformers live or die on:
//   coyote time   — a jump pressed shortly AFTER walking off a ledge still fires
//   jump buffer   — a jump pressed shortly BEFORE landing fires on touchdown
//   variable jump — releasing the button early cuts the ascent for a short hop
// Pure decisions so they're unit-tested; PhysicsWorld owns the timers/state.

export const COYOTE_MS = 120;
export const JUMP_BUFFER_MS = 130;
/** Ascending velocity is multiplied by this on early release (shorter hop). */
export const JUMP_CUT_FACTOR = 0.45;

export interface JumpState {
  isAirborne: boolean;
  swimming: boolean;
  lastGroundedAt: number;   // wall-clock ms of last ground contact
  jumpBufferedAt: number;   // wall-clock ms of a buffered jump request (0 = none)
}

/** Can this character jump right now? Grounded, or within the coyote window. */
export function canJump(s: Pick<JumpState, "isAirborne" | "swimming" | "lastGroundedAt">, now: number, coyoteMs: number = COYOTE_MS): boolean {
  if (s.swimming) return false;
  if (!s.isAirborne) return true;
  return now - (s.lastGroundedAt || 0) <= coyoteMs;
}

/** On a fresh ground contact, should a buffered jump fire? */
export function shouldFlushBuffer(s: Pick<JumpState, "jumpBufferedAt">, now: number, bufferMs: number = JUMP_BUFFER_MS): boolean {
  return !!s.jumpBufferedAt && now - s.jumpBufferedAt <= bufferMs;
}

/** Cut an ascending jump on early release (no-op while falling). */
export function cutJump(verticalVel: number, factor: number = JUMP_CUT_FACTOR): number {
  return verticalVel > 0 ? Math.round(verticalVel * factor * 1000) / 1000 : verticalVel;
}

// B2 — accel/decel curve: ramp a value toward a target at `rate` units/sec so
// start/stop/turn ease rather than snap. Fast rate = barely-perceptible polish
// (responsive), not floaty. Pure + frame-rate-independent.
export const MOVE_ACCEL_RATE = 14; // /sec — reaches full input in ~0.07s

export function accelToward(current: number, target: number, dt: number, rate: number = MOVE_ACCEL_RATE): number {
  const step = rate * Math.max(0, dt);
  const d = target - current;
  if (Math.abs(d) <= step) return target;
  return current + Math.sign(d) * step;
}

