// World Lens plan Phase 4 ("Camera") — Cinematic camera mode.
//
// This is the pure geometry half of the fix (see
// tests/world-lens-cinematic-camera-mode.test.ts for the ConcordiaScene.tsx/
// page.tsx wiring, which is too Three.js/DOM-heavy for jsdom and follows the
// established source-pinning pattern instead). computeShotFraming/applyEasing
// are plain functions with no THREE.js or DOM dependency, so this file is a
// REAL behavioral test, not a source pin.

import { describe, it, expect } from 'vitest';
import { computeShotFraming, applyEasing, EASING_FNS } from '@/lib/world-lens/cinematic-shot-geometry';

const SUBJECT_FACING_NORTH = { x: 0, y: 0, z: 0, yaw: 0 }; // forward = (0, 0, -1)
const CAMERA_BEHIND = { x: 0, y: 2, z: 8 };

describe('computeShotFraming', () => {
  it('close_on frames tight and looks at the subject\'s head (eye height above feet)', () => {
    const f = computeShotFraming('close_on', SUBJECT_FACING_NORTH, CAMERA_BEHIND);
    const dist = Math.hypot(f.position.x - SUBJECT_FACING_NORTH.x, f.position.z - SUBJECT_FACING_NORTH.z);
    expect(dist).toBeCloseTo(2.2, 5);
    expect(f.lookAt).toEqual({ x: 0, y: 1.6, z: 0 });
    expect(f.tiltRad).toBe(0);
  });

  it('pull_back frames much farther and higher than close_on', () => {
    const close = computeShotFraming('close_on', SUBJECT_FACING_NORTH, CAMERA_BEHIND);
    const wide = computeShotFraming('pull_back', SUBJECT_FACING_NORTH, CAMERA_BEHIND);
    const closeDist = Math.hypot(close.position.x, close.position.z);
    const wideDist = Math.hypot(wide.position.x, wide.position.z);
    expect(wideDist).toBeGreaterThan(closeDist * 3);
    expect(wide.position.y).toBeGreaterThan(close.position.y);
  });

  it('dolly_in pushes toward the subject along the CURRENT camera approach line, not a fixed angle', () => {
    const fromBehind = computeShotFraming('dolly_in', SUBJECT_FACING_NORTH, { x: 0, y: 2, z: 8 });
    const fromSide = computeShotFraming('dolly_in', SUBJECT_FACING_NORTH, { x: 8, y: 2, z: 0 });
    // Both push closer than their respective starting distance, but along
    // genuinely different directions (approach line is preserved).
    expect(fromBehind.position.z).toBeGreaterThan(0); // still on the +Z side (behind)
    expect(fromSide.position.x).toBeGreaterThan(0);   // still on the +X side
    expect(Math.abs(fromBehind.position.x)).toBeLessThan(0.01); // no lateral drift
    expect(Math.abs(fromSide.position.z)).toBeLessThan(0.01);
  });

  it('dolly_out pulls farther away than dolly_in, same approach line', () => {
    const inShot = computeShotFraming('dolly_in', SUBJECT_FACING_NORTH, CAMERA_BEHIND);
    const outShot = computeShotFraming('dolly_out', SUBJECT_FACING_NORTH, CAMERA_BEHIND);
    const inDist = Math.hypot(inShot.position.x, inShot.position.z);
    const outDist = Math.hypot(outShot.position.x, outShot.position.z);
    expect(outDist).toBeGreaterThan(inDist);
  });

  it('crane_pull is higher than crane_drop (rises vs. descends)', () => {
    const pull = computeShotFraming('crane_pull', SUBJECT_FACING_NORTH, CAMERA_BEHIND);
    const drop = computeShotFraming('crane_drop', SUBJECT_FACING_NORTH, CAMERA_BEHIND);
    expect(pull.position.y).toBeGreaterThan(drop.position.y);
  });

  it('dutch_tilt applies a non-zero roll while every other template stays level', () => {
    const tilt = computeShotFraming('dutch_tilt', SUBJECT_FACING_NORTH, CAMERA_BEHIND);
    expect(tilt.tiltRad).not.toBe(0);
    for (const id of ['close_on', 'pull_back', 'dolly_in', 'dolly_out', 'crane_pull', 'crane_drop', 'whip_pan', 'match_cut', 'over_shoulder', 'reverse_over_shoulder']) {
      expect(computeShotFraming(id, SUBJECT_FACING_NORTH, CAMERA_BEHIND).tiltRad).toBe(0);
    }
  });

  it('over_shoulder looks past the subject in their facing direction, not straight at them', () => {
    const f = computeShotFraming('over_shoulder', SUBJECT_FACING_NORTH, CAMERA_BEHIND);
    // yaw=0 → forward is -Z, so the look-at point should be well in front
    // (negative Z) of the subject, not centered on them.
    expect(f.lookAt.z).toBeLessThan(-3);
  });

  it('reverse_over_shoulder looks back AT the subject (the shot/reverse-shot counterpart)', () => {
    const f = computeShotFraming('reverse_over_shoulder', SUBJECT_FACING_NORTH, CAMERA_BEHIND);
    expect(f.lookAt).toEqual({ x: 0, y: 1.6, z: 0 });
  });

  it('an unknown template falls back to a safe generic medium shot instead of throwing', () => {
    expect(() => computeShotFraming('not_a_real_template', SUBJECT_FACING_NORTH, CAMERA_BEHIND)).not.toThrow();
    const f = computeShotFraming('not_a_real_template', SUBJECT_FACING_NORTH, CAMERA_BEHIND);
    expect(Number.isFinite(f.position.x)).toBe(true);
    expect(Number.isFinite(f.lookAt.x)).toBe(true);
  });

  it('framing tracks a moving/rotated subject, not a hardcoded origin', () => {
    const movedSubject = { x: 50, y: 3, z: -20, yaw: Math.PI / 2 };
    const f = computeShotFraming('close_on', movedSubject, CAMERA_BEHIND);
    expect(f.lookAt).toEqual({ x: 50, y: 3 + 1.6, z: -20 });
    const dist = Math.hypot(f.position.x - 50, f.position.z - (-20));
    expect(dist).toBeCloseTo(2.2, 5);
  });
});

describe('applyEasing', () => {
  it('clamps t to [0,1] regardless of the input range', () => {
    expect(applyEasing('linear', -5)).toBe(0);
    expect(applyEasing('linear', 5)).toBe(1);
  });

  it('linear is the identity function within [0,1]', () => {
    expect(applyEasing('linear', 0.37)).toBeCloseTo(0.37, 10);
  });

  it('every named easing starts at 0 and ends at 1', () => {
    for (const name of Object.keys(EASING_FNS)) {
      expect(applyEasing(name, 0)).toBeCloseTo(0, 10);
      expect(applyEasing(name, 1)).toBeCloseTo(1, 10);
    }
  });

  it('falls back to linear for an unknown or missing easing name', () => {
    expect(applyEasing(undefined, 0.5)).toBe(0.5);
    expect(applyEasing('not_a_real_easing', 0.5)).toBe(0.5);
  });

  it('ease_in_quad starts slower than linear (accelerates into the motion)', () => {
    expect(applyEasing('ease_in_quad', 0.3)).toBeLessThan(0.3);
  });

  it('ease_out_quad starts faster than linear (decelerates into the motion)', () => {
    expect(applyEasing('ease_out_quad', 0.3)).toBeGreaterThan(0.3);
  });
});
