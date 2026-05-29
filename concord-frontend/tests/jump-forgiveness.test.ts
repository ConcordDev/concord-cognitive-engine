// B1 — movement forgiveness layer.
//
// Pins the pure decisions PhysicsWorld consumes:
//   - coyote time: a jump just after leaving a ledge still fires
//   - jump buffer: a press just before landing flushes on touchdown
//   - variable jump: early release cuts an ascending jump, not a fall

import { describe, it, expect } from 'vitest';
import {
  canJump, shouldFlushBuffer, cutJump, accelToward,
  COYOTE_MS, JUMP_BUFFER_MS, JUMP_CUT_FACTOR,
} from '@/lib/world-lens/jump-forgiveness';

describe('B1 — coyote time', () => {
  it('grounded can always jump', () => {
    expect(canJump({ isAirborne: false, swimming: false, lastGroundedAt: 0 }, 9999)).toBe(true);
  });
  it('airborne within the coyote window can still jump', () => {
    const now = 1000;
    expect(canJump({ isAirborne: true, swimming: false, lastGroundedAt: now - 80 }, now)).toBe(true);
    expect(canJump({ isAirborne: true, swimming: false, lastGroundedAt: now - (COYOTE_MS + 50) }, now)).toBe(false);
  });
  it('swimming cannot jump', () => {
    expect(canJump({ isAirborne: false, swimming: true, lastGroundedAt: 0 }, 9999)).toBe(false);
  });
});

describe('B1 — jump buffer', () => {
  it('a fresh buffered press flushes on landing; a stale one does not', () => {
    const now = 5000;
    expect(shouldFlushBuffer({ jumpBufferedAt: now - 50 }, now)).toBe(true);
    expect(shouldFlushBuffer({ jumpBufferedAt: now - (JUMP_BUFFER_MS + 50) }, now)).toBe(false);
    expect(shouldFlushBuffer({ jumpBufferedAt: 0 }, now)).toBe(false);
  });
});

describe('B1 — variable jump', () => {
  it('cuts an ascending jump but not a fall', () => {
    expect(cutJump(8)).toBeCloseTo(8 * JUMP_CUT_FACTOR, 3);
    expect(cutJump(-3)).toBe(-3);   // falling: unchanged
    expect(cutJump(0)).toBe(0);
  });
});

describe('B2 — accel/decel curve', () => {
  it('ramps toward the target, frame-rate independent, snaps when close', () => {
    // from 0 toward 1 at 14/s over 16ms ≈ 0.224
    const a = accelToward(0, 1, 0.016);
    expect(a).toBeCloseTo(0.224, 2);
    // within a step of the target → snaps exactly to target
    expect(accelToward(0.99, 1, 0.016)).toBe(1);
    // decelerates toward 0 the same way
    expect(accelToward(0.5, 0, 0.016)).toBeCloseTo(0.276, 2);
  });
});
