/**
 * SkyDome3D — feature-build follow-up pass, `astronomy` item (the T3-scale
 * "full Three.js celestial dome" this lens's own doc entry had deferred).
 *
 * Pins `altAzToVec3`, the alt/az -> 3D projection — a direct geometric
 * generalization of the existing, already-shipped 2D azimuthal sky chart's
 * verified `project()` function (same azimuth reference frame: North at
 * `az=0` maps to the same angular offset). A wrong sign or axis swap here
 * would silently misplace every star on the dome, so this math is the
 * correctness-critical part of the feature. Real Canvas/WebGL rendering
 * isn't unit-tested here — jsdom has no real GL context to render into,
 * and no existing precedent exists in this codebase for meaningfully
 * mocking a full @react-three/fiber Canvas tree — so this focuses on the
 * one part that can silently be wrong without any visual crash to notice.
 */
import { describe, it, expect } from 'vitest';
import { altAzToVec3, DOME_RADIUS } from '@/components/astronomy/SkyDome3D';

describe('altAzToVec3', () => {
  it('places the zenith (altitude 90) straight up, independent of azimuth', () => {
    for (const az of [0, 90, 180, 270]) {
      const v = altAzToVec3(90, az);
      expect(v.x).toBeCloseTo(0, 5);
      expect(v.z).toBeCloseTo(0, 5);
      expect(v.y).toBeCloseTo(DOME_RADIUS, 5);
    }
  });

  it('places every horizon point (altitude 0) at the dome radius with zero height', () => {
    for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const v = altAzToVec3(0, az);
      expect(v.y).toBeCloseTo(0, 5);
      const horizontalDist = Math.sqrt(v.x * v.x + v.z * v.z);
      expect(horizontalDist).toBeCloseTo(DOME_RADIUS, 5);
    }
  });

  it('matches the 2D SkyDome azimuth reference frame at az=90 (East, matching the 2D project() a = (az-90) offset landing at angle 0)', () => {
    // The 2D SkyDome computes `a = (az - 90) * DEG2RAD` then
    // `x = r*cos(a), y = r*sin(a)`. At az=90, a=0, so the 2D point sits
    // on the +x axis of its screen-space frame. This 3D projection reuses
    // the identical `a` formula onto the XZ plane, so az=90 must land on
    // the +x axis here too (z component at zero).
    const v = altAzToVec3(0, 90);
    expect(v.x).toBeCloseTo(DOME_RADIUS, 5);
    expect(v.z).toBeCloseTo(0, 4);
  });

  it('rejects a negative altitude by clamping to the horizon rather than projecting underground', () => {
    const below = altAzToVec3(-10, 45);
    const atHorizon = altAzToVec3(0, 45);
    expect(below.x).toBeCloseTo(atHorizon.x, 5);
    expect(below.y).toBeCloseTo(atHorizon.y, 5);
    expect(below.z).toBeCloseTo(atHorizon.z, 5);
  });

  it('respects a custom radius argument (used for the cardinal-label markers just outside the star dome)', () => {
    const v = altAzToVec3(0, 0, DOME_RADIUS + 5);
    const dist = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    expect(dist).toBeCloseTo(DOME_RADIUS + 5, 5);
  });

  it('produces a monotonically increasing height as altitude increases from 0 to 90', () => {
    const heights = [0, 15, 30, 45, 60, 75, 90].map((alt) => altAzToVec3(alt, 200).y);
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
  });
});
