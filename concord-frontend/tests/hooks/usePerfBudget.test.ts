import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { usePerfBudget } from '@/hooks/usePerfBudget';

// This suite drives the hook exclusively through `reportFrame`, which is the
// EXACT same code path a real `requestAnimationFrame` callback would call
// (see `autoMeasure`'s internal loop in the hook) — just fed synthetic,
// hand-computed timestamps instead of real browser frames, per CLAUDE.md's
// "honest by construction" rule: the hook's inputs are still real rAF-shaped
// timings, only injected deterministically for the test. `autoMeasure:
// false` is passed so no real rAF loop races the manual `reportFrame` calls.

// Small buffer/hysteresis/warmup so the sustained-regression arithmetic below
// is easy to verify by hand and the test runs instantly.
const SMALL_OPTS = {
  autoMeasure: false,
  fullFpsFloor: 50,
  reducedFpsFloor: 30,
  bufferSize: 4,
  warmupSamples: 4,
  hysteresisSamples: 2,
} as const;

describe('usePerfBudget', () => {
  it('stays "full" and !overBudget while every frame is fast (16ms / ~62.5fps)', () => {
    const { result } = renderHook(() => usePerfBudget(SMALL_OPTS));

    // Seed timestamp (no delta computed from the very first call).
    act(() => result.current.reportFrame(0));
    expect(result.current.budget.warmedUp).toBe(false);

    let t = 0;
    for (let i = 0; i < 10; i++) {
      t += 16;
      act(() => result.current.reportFrame(t));
    }

    expect(result.current.budget.warmedUp).toBe(true);
    expect(result.current.budget.tier).toBe('full');
    expect(result.current.budget.overBudget).toBe(false);
    expect(result.current.budget.fps).toBeGreaterThan(50);
  });

  it('never judges a tier before warmupSamples real samples exist', () => {
    const { result } = renderHook(() => usePerfBudget(SMALL_OPTS));

    act(() => result.current.reportFrame(0));
    // Feed 3 catastrophic frames (100ms each) — one less than warmupSamples(4).
    let t = 0;
    for (let i = 0; i < 3; i++) {
      t += 100;
      act(() => result.current.reportFrame(t));
    }

    // Buffer has 3 samples, warmupSamples is 4 — must not have judged yet.
    expect(result.current.budget.sampleCount).toBe(3);
    expect(result.current.budget.warmedUp).toBe(false);
    expect(result.current.budget.tier).toBe('full');
    expect(result.current.budget.overBudget).toBe(false);
  });

  it('degrades full -> reduced -> minimal only once the regression is SUSTAINED across consecutive real samples (hysteresis), at the configured fps floors', () => {
    const { result } = renderHook(() => usePerfBudget(SMALL_OPTS));

    let t = 0;
    // Seed + warm up on fast (16ms) frames — buffer settles at [16,16,16,16].
    act(() => result.current.reportFrame(t));
    for (let i = 0; i < 4; i++) {
      t += 16;
      act(() => result.current.reportFrame(t));
    }
    expect(result.current.budget.tier).toBe('full');
    expect(result.current.budget.warmedUp).toBe(true);

    // Drive a REAL sustained regression into the 'reduced' band
    // (fps between reducedFpsFloor=30 and fullFpsFloor=50 => dt ~25ms).
    // The rolling average crosses below 50fps on the 2nd slow sample, and
    // with hysteresisSamples=2 the tier commits to 'reduced' on the 3rd.
    for (let i = 0; i < 2; i++) {
      t += 25;
      act(() => result.current.reportFrame(t));
    }
    expect(result.current.budget.tier).toBe('full'); // not committed yet (1st agreeing sample)
    t += 25;
    act(() => result.current.reportFrame(t));
    expect(result.current.budget.tier).toBe('reduced'); // committed (2nd agreeing sample)
    expect(result.current.budget.overBudget).toBe(true);
    expect(result.current.budget.fps).toBeLessThan(50);
    expect(result.current.budget.fps).toBeGreaterThanOrEqual(30);

    // Drive the regression further, sustained into the 'minimal' band
    // (fps below reducedFpsFloor=30 => dt ~60ms).
    for (let i = 0; i < 2; i++) {
      t += 60;
      act(() => result.current.reportFrame(t));
    }
    expect(result.current.budget.tier).toBe('minimal');
    expect(result.current.budget.overBudget).toBe(true);
    expect(result.current.budget.fps).toBeLessThan(30);
  });

  it('absorbs a single real stutter frame via the rolling average without flipping tier, at realistic (default) buffer sizing', () => {
    // Default options: bufferSize 60 / warmupSamples 60 / hysteresisSamples 3
    // / floors 50-30 — the production defaults, not the tiny test buffer
    // above. One 200ms frame among 59 real 16ms frames only nudges the
    // rolling average to ~52.4fps, which is still >= fullFpsFloor(50), so a
    // single bad frame never even reaches the 'reduced' classification, let
    // alone commits to it.
    const { result } = renderHook(() => usePerfBudget({ autoMeasure: false }));

    let t = 0;
    act(() => result.current.reportFrame(t));
    for (let i = 0; i < 64; i++) {
      t += 16;
      act(() => result.current.reportFrame(t));
    }
    expect(result.current.budget.warmedUp).toBe(true);
    expect(result.current.budget.tier).toBe('full');

    // One real stutter frame (e.g. a GC pause or a heavy synchronous task).
    t += 200;
    act(() => result.current.reportFrame(t));
    expect(result.current.budget.tier).toBe('full');
    expect(result.current.budget.overBudget).toBe(false);

    // Back to normal — average keeps recovering.
    t += 16;
    act(() => result.current.reportFrame(t));
    expect(result.current.budget.tier).toBe('full');
  });

  it('reset() clears the buffer, hysteresis state, and returns to "full"', () => {
    const { result } = renderHook(() => usePerfBudget(SMALL_OPTS));

    let t = 0;
    act(() => result.current.reportFrame(t));
    for (let i = 0; i < 10; i++) {
      t += 80; // sustained slow frames -> should reach a degraded tier
      act(() => result.current.reportFrame(t));
    }
    expect(result.current.budget.tier).not.toBe('full');

    act(() => result.current.reset());

    expect(result.current.budget).toEqual({
      fps: 0,
      frameMs: 0,
      warmedUp: false,
      overBudget: false,
      tier: 'full',
      sampleCount: 0,
    });
  });

  it('ignores a non-positive/invalid delta instead of corrupting the average (defensive, real-clock guard)', () => {
    const { result } = renderHook(() => usePerfBudget(SMALL_OPTS));

    act(() => result.current.reportFrame(100));
    // A duplicate/out-of-order timestamp — dt would be 0 or negative.
    act(() => result.current.reportFrame(100));
    act(() => result.current.reportFrame(95));

    // Neither bad sample should have entered the buffer.
    expect(result.current.budget.sampleCount).toBe(0);
  });
});
