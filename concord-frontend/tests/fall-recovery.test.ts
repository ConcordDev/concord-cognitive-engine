// Invisible safety net (G1/G2). The player must never free-fall forever or
// break on a NaN: the render loop calls outOfBounds() each frame and, on true,
// snaps back to the last grounded position. This pins the pure detector.

import { describe, it, expect } from 'vitest';
import { outOfBounds, WORLD_BOUND, FALL_FLOOR_Y } from '@/lib/world-lens/coord-frame';

describe('outOfBounds — kill-volume / edge / NaN detector', () => {
  it('in-bounds grounded position is safe', () => {
    expect(outOfBounds({ x: 0, y: 40, z: 0 })).toBe(false);
    expect(outOfBounds({ x: -200, y: 40, z: 120 })).toBe(false);
  });

  it('below the fall floor triggers recovery', () => {
    expect(outOfBounds({ x: 0, y: FALL_FLOOR_Y - 1, z: 0 })).toBe(true);
    expect(outOfBounds({ x: 0, y: -9999, z: 0 })).toBe(true);
  });

  it('beyond the walkable bound (either axis) triggers recovery', () => {
    expect(outOfBounds({ x: WORLD_BOUND + 1, y: 40, z: 0 })).toBe(true);
    expect(outOfBounds({ x: 0, y: 40, z: -(WORLD_BOUND + 1) })).toBe(true);
    expect(outOfBounds({ x: 50000, y: 40, z: 0 })).toBe(true);
  });

  it('non-finite coordinates (NaN / Infinity) trigger recovery', () => {
    expect(outOfBounds({ x: NaN, y: 40, z: 0 })).toBe(true);
    expect(outOfBounds({ x: 0, y: Infinity, z: 0 })).toBe(true);
    expect(outOfBounds({ x: 0, y: 40, z: -Infinity })).toBe(true);
  });

  it('the edge itself is in-bounds; just past it is not', () => {
    expect(outOfBounds({ x: WORLD_BOUND, y: 40, z: WORLD_BOUND })).toBe(false);
    expect(outOfBounds({ x: WORLD_BOUND + 0.001, y: 40, z: 0 })).toBe(true);
  });

  it('honors custom bound/floor overrides', () => {
    expect(outOfBounds({ x: 0, y: -5, z: 0 }, 100, -10)).toBe(false);
    expect(outOfBounds({ x: 150, y: 0, z: 0 }, 100, -10)).toBe(true);
  });
});
