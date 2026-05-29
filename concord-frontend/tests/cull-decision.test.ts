// G1 — culling decision (pure, headless).
import { describe, it, expect } from 'vitest';
import { distanceSq, decideVisible } from '@/lib/world-lens/cull';

describe('distanceSq', () => {
  it('computes squared euclidean distance', () => {
    expect(distanceSq({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 })).toBe(25);
  });
});

describe('decideVisible', () => {
  it('culls anything outside the frustum regardless of distance', () => {
    expect(decideVisible(false, 0, 1000)).toBe(false);
  });
  it('renders in-frustum within range', () => {
    expect(decideVisible(true, 100 * 100, 1000)).toBe(true);
  });
  it('culls in-frustum beyond the hard render distance', () => {
    expect(decideVisible(true, 1500 * 1500, 1000)).toBe(false);
  });
  it('maxDistance <= 0 disables the distance cull', () => {
    expect(decideVisible(true, 9e9, 0)).toBe(true);
  });
});
