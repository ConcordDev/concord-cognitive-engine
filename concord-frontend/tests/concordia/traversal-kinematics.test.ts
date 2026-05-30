import { describe, it, expect } from 'vitest';
import {
  freshTraversalState, beginDash, isDashing, isInvulnerable, dashVelocityAt,
  stepMomentum, momentumMagnitude, tryBeginSlide, endSlide, TRAVERSAL,
} from '@/lib/concordia/traversal-kinematics';
import { resolveActionDescriptor } from '@/lib/concordia/action-biomechanics';

describe('Part B — traversal kinematics (pure)', () => {
  it('beginDash sets a normalized burst + i-frames; isDashing/isInvulnerable gate by time', () => {
    const st = freshTraversalState();
    beginDash(st, 0, 2, 1000); // dir +z, magnitude 2 → normalized
    expect(Math.hypot(st.dashVx, st.dashVz)).toBeCloseTo(TRAVERSAL.DASH_SPEED, 5);
    expect(isDashing(st, 1000)).toBe(true);
    expect(isInvulnerable(st, 1000)).toBe(true);
    // after the i-frame window but still dashing
    expect(isInvulnerable(st, 1000 + TRAVERSAL.IFRAME_MS + 1)).toBe(false);
    expect(isDashing(st, 1000 + TRAVERSAL.IFRAME_MS + 1)).toBe(true);
    // after the dash window
    expect(isDashing(st, 1000 + TRAVERSAL.DASH_DURATION_MS + 1)).toBe(false);
  });

  it('dashVelocityAt decays linearly from full to zero across the window', () => {
    const st = freshTraversalState();
    beginDash(st, 1, 0, 0);
    const atStart = dashVelocityAt(st, 0);
    const mid = dashVelocityAt(st, TRAVERSAL.DASH_DURATION_MS / 2);
    const end = dashVelocityAt(st, TRAVERSAL.DASH_DURATION_MS);
    expect(atStart.vx).toBeCloseTo(TRAVERSAL.DASH_SPEED, 3);
    expect(mid.vx).toBeCloseTo(TRAVERSAL.DASH_SPEED / 2, 1);
    expect(end.vx).toBe(0);
  });

  it('stepMomentum eases toward input + carries (never snaps to zero in one frame)', () => {
    const st = freshTraversalState();
    st.momX = 6; // sprinting east
    // input drops to 0 (released) — momentum should DECAY, not snap.
    const r1 = stepMomentum(st, 0, 0, 1 / 60);
    expect(r1.vx).toBeGreaterThan(0);
    expect(r1.vx).toBeLessThan(6);
    // many frames later it settles to ~0
    for (let i = 0; i < 600; i++) stepMomentum(st, 0, 0, 1 / 60);
    expect(momentumMagnitude(st)).toBeLessThan(0.01);
  });

  it('stepMomentum ramps UP toward new input too (eased acceleration)', () => {
    const st = freshTraversalState();
    const r = stepMomentum(st, 8, 0, 1 / 60);
    expect(r.vx).toBeGreaterThan(0);
    expect(r.vx).toBeLessThan(8); // eased, not instant
  });

  it('slide needs minimum momentum', () => {
    const st = freshTraversalState();
    st.momX = 1; // too slow
    expect(tryBeginSlide(st)).toBe(false);
    st.momX = TRAVERSAL.SLIDE_MIN_SPEED + 1;
    expect(tryBeginSlide(st)).toBe(true);
    expect(st.sliding).toBe(true);
    endSlide(st);
    expect(st.sliding).toBe(false);
  });
});

describe('Part B — traversal verbs resolve to animatable descriptors', () => {
  it('every traversal verb has a real descriptor', () => {
    for (const v of ['dash', 'dodge', 'slide', 'climb', 'vault', 'mantle']) {
      const d = resolveActionDescriptor(v);
      expect(d).toBeTruthy();
      expect(d.archetype).toBe('locomotion_modal');
    }
  });
});
