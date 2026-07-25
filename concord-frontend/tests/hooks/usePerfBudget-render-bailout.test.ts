import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { usePerfBudget, type PerfBudgetState } from '@/hooks/usePerfBudget';

// `reportFrame` is called once per REAL frame by every consumer of this hook
// (MixerPeekStrip's meter ticker, NowPlayingBar's spectrum visualizer). Before
// the value-equality bail-out it handed React a brand-new budget object on
// every one of those calls, so a consuming lens re-rendered ~60x/second even
// when nothing about the measured budget had changed — at EVERY tier,
// including 'minimal', whose advertised cost cut is that the loop freezes.
//
// This suite pins BOTH directions of that bail-out, because only one of them
// is the win and the other is the thing that could silently break:
//   (a) identical measurements must not produce a new state (the cost cut), and
//   (b) every REAL change must still land on the very next frame, never
//       deferred — an over-eager bail-out that swallowed a tier transition
//       would be a far worse bug than the wasted renders it removed.
//
// Same honesty rule as the sibling suite: the hook is driven only through
// `reportFrame`, the exact code path a real rAF callback calls, fed
// deterministic timestamps. `autoMeasure: false` keeps a real rAF loop from
// racing the manual calls.

const SMALL_OPTS = {
  autoMeasure: false,
  fullFpsFloor: 50,
  reducedFpsFloor: 30,
  bufferSize: 4,
  warmupSamples: 4,
  hysteresisSamples: 2,
} as const;

/**
 * Render the hook while counting how many times React actually rendered it.
 * A suppressed state update shows up here as a flat count; a real one shows up
 * as an increment. Counts are only ever compared as DELTAS so this stays
 * correct regardless of how many times the harness renders on mount.
 */
function renderCounted() {
  let renders = 0;
  const seen: PerfBudgetState[] = [];
  const hook = renderHook(() => {
    renders += 1;
    const r = usePerfBudget(SMALL_OPTS);
    seen.push(r.budget);
    return r;
  });
  return {
    ...hook,
    seen,
    get renders() {
      return renders;
    },
  };
}

/** Feed `count` frames each `dt` ms after `from`; returns the final timestamp. */
function pump(
  result: { current: { reportFrame: (n: number) => void } },
  from: number,
  dt: number,
  count: number
): number {
  let t = from;
  for (let i = 0; i < count; i++) {
    t += dt;
    act(() => result.current.reportFrame(t));
  }
  return t;
}

describe('usePerfBudget — per-frame state-update bail-out', () => {
  // ── Direction (a): the actual win ────────────────────────────────────

  it('does NOT queue a new state when a frame measures exactly what the last one did (steady state)', () => {
    const h = renderCounted();

    // Seed + fill the 4-sample buffer with identical 16ms frames. Once full,
    // every subsequent identical frame yields the same rolling average, the
    // same sampleCount (buffer is at capacity), and the same tier.
    act(() => h.result.current.reportFrame(0));
    let t = pump(h.result, 0, 16, 4);

    const settled = h.result.current.budget;
    expect(settled.warmedUp).toBe(true);
    expect(settled.sampleCount).toBe(4);
    expect(settled.tier).toBe('full');

    const rendersAfterSettle = h.renders;

    // 30 more real frames, every one measuring the same 16ms.
    t = pump(h.result, t, 16, 30);

    // The win: 30 frames cost AT MOST one render, not 30. The one is React's
    // own documented behaviour — the first setState after a real update still
    // re-renders the component once before it can bail out (the eager-state
    // bailout only applies once the fiber has no pending work). Everything
    // after that is free, which the flat-tail assertion below pins exactly.
    expect(h.renders - rendersAfterSettle).toBeLessThanOrEqual(1);

    // Truly flat from here: 60 more identical frames, zero renders.
    const rendersAtSteady = h.renders;
    pump(h.result, t, 16, 60);
    expect(h.renders).toBe(rendersAtSteady);

    // And the state object is literally the same one — no new allocation
    // reached React, so `useMemo`-derived consumer values stay stable too.
    expect(h.result.current.budget).toEqual(settled);
    expect(h.result.current.budget).toBe(h.seen[h.seen.length - 1]);
  });

  it('holds the bail-out at the degraded tiers too — including the "frozen" minimal tier', () => {
    const h = renderCounted();

    // Drive a real sustained regression well below reducedFpsFloor(30):
    // 100ms frames => 10fps => 'minimal'.
    act(() => h.result.current.reportFrame(0));
    let t = pump(h.result, 0, 100, 8);
    expect(h.result.current.budget.tier).toBe('minimal');

    // Absorb React's one post-update render (see the steady-state test above),
    // then measure the genuinely-flat tail.
    t = pump(h.result, t, 100, 2);
    const rendersAtMinimal = h.renders;
    const frozen = h.result.current.budget;

    // 30 more frames at the same real cadence — the loop is still running and
    // still reporting (that part is honest: the hook keeps measuring), but
    // nothing it measures has changed, so the consumer is genuinely frozen.
    pump(h.result, t, 100, 30);

    expect(h.renders).toBe(rendersAtMinimal);
    expect(h.result.current.budget).toBe(frozen);
    expect(h.result.current.budget.tier).toBe('minimal');
  });

  it('a suppressed frame is a suppressed UPDATE, not a suppressed MEASUREMENT — real samples still accumulate underneath', () => {
    const h = renderCounted();

    // Settle at 16ms/full with a full buffer.
    act(() => h.result.current.reportFrame(0));
    let t = pump(h.result, 0, 16, 4);
    // Absorb React's one post-update render, then measure the flat tail.
    t = pump(h.result, t, 16, 2);
    const rendersAfterSettle = h.renders;

    // Frames that change nothing observable...
    t = pump(h.result, t, 16, 10);
    expect(h.renders).toBe(rendersAfterSettle);

    // ...but the rolling buffer was still really being fed the whole time: a
    // single slow frame now moves the average off the 16ms baseline exactly as
    // it would have without the bail-out, and reports on that same frame.
    t += 40;
    act(() => h.result.current.reportFrame(t));
    expect(h.renders).toBe(rendersAfterSettle + 1);
    expect(h.result.current.budget.frameMs).toBeGreaterThan(16);
  });

  // ── Direction (b): nothing real is ever swallowed or deferred ────────

  it('reports the warm-up sampleCount progression on every single frame while the buffer fills', () => {
    const h = renderCounted();

    act(() => h.result.current.reportFrame(0));
    expect(h.result.current.budget.sampleCount).toBe(0);

    // Each of these frames adds one real sample, so each is a genuine change
    // and must be visible immediately — this is the trap case where "nothing
    // changes frame to frame" is simply false.
    let t = 0;
    for (let i = 1; i <= 4; i++) {
      const before = h.renders;
      t += 16;
      act(() => h.result.current.reportFrame(t));
      expect(h.result.current.budget.sampleCount).toBe(i);
      expect(h.renders).toBe(before + 1);
    }

    // The warmedUp flip landed on the frame that completed the buffer, not later.
    expect(h.result.current.budget.warmedUp).toBe(true);
    expect(h.seen.some(b => b.sampleCount === 1)).toBe(true);
    expect(h.seen.some(b => b.sampleCount === 2)).toBe(true);
    expect(h.seen.some(b => b.sampleCount === 3)).toBe(true);
  });

  it('reports a real fps/frameMs change on the very frame it happens (no deferral)', () => {
    const h = renderCounted();

    act(() => h.result.current.reportFrame(0));
    let t = pump(h.result, 0, 16, 4);
    const settledFps = h.result.current.budget.fps;
    const settledFrameMs = h.result.current.budget.frameMs;
    const before = h.renders;

    // One 24ms frame: rolling avg 16 -> 18ms, i.e. 62.5 -> ~55.6fps. Both
    // rounded values move, so this must surface immediately.
    t += 24;
    act(() => h.result.current.reportFrame(t));

    expect(h.renders).toBe(before + 1);
    expect(h.result.current.budget.frameMs).not.toBe(settledFrameMs);
    expect(h.result.current.budget.fps).not.toBe(settledFps);
    expect(h.result.current.budget.frameMs).toBe(18);
  });

  it('commits a REAL tier transition on the exact frame the hysteresis vote lands (full -> reduced -> minimal)', () => {
    const h = renderCounted();

    let t = 0;
    act(() => h.result.current.reportFrame(t));
    t = pump(h.result, t, 16, 4);
    expect(h.result.current.budget.tier).toBe('full');

    // Sustained 25ms frames => ~40fps => the 'reduced' band. Mirrors the
    // sibling suite's arithmetic: the average crosses below 50fps on the 2nd
    // slow sample and hysteresisSamples=2 commits on the 3rd.
    t = pump(h.result, t, 25, 2);
    expect(h.result.current.budget.tier).toBe('full');

    let before = h.renders;
    t += 25;
    act(() => h.result.current.reportFrame(t));
    // The transition frame is NOT suppressed, and lands on that frame.
    expect(h.renders).toBe(before + 1);
    expect(h.result.current.budget.tier).toBe('reduced');
    expect(h.result.current.budget.overBudget).toBe(true);

    // Push further down into 'minimal' (60ms frames => <30fps).
    t = pump(h.result, t, 60, 1);
    before = h.renders;
    t += 60;
    act(() => h.result.current.reportFrame(t));
    expect(h.renders).toBe(before + 1);
    expect(h.result.current.budget.tier).toBe('minimal');

    // The consumer saw every tier, in order — none was skipped over.
    const tiers = h.seen.map(b => b.tier);
    expect(tiers.indexOf('reduced')).toBeGreaterThan(-1);
    expect(tiers.indexOf('minimal')).toBeGreaterThan(tiers.indexOf('reduced'));
  });

  it('recovers upward too — a real minimal -> full transition is reported, not held by the bail-out', () => {
    const h = renderCounted();

    let t = 0;
    act(() => h.result.current.reportFrame(t));
    t = pump(h.result, t, 100, 8);
    expect(h.result.current.budget.tier).toBe('minimal');

    // Sustained fast frames refill the 4-sample buffer and vote 'full' back in.
    t = pump(h.result, t, 16, 6);
    expect(h.result.current.budget.tier).toBe('full');
    expect(h.result.current.budget.overBudget).toBe(false);
  });

  it('reset() still propagates even from a fully-settled, bailing-out steady state', () => {
    const h = renderCounted();

    act(() => h.result.current.reportFrame(0));
    const t = pump(h.result, 0, 16, 10);
    expect(t).toBeGreaterThan(0);
    const settled = h.result.current.budget;
    expect(settled.sampleCount).toBe(4);

    const before = h.renders;
    act(() => h.result.current.reset());

    expect(h.renders).toBeGreaterThan(before);
    expect(h.result.current.budget).toEqual({
      fps: 0,
      frameMs: 0,
      warmedUp: false,
      overBudget: false,
      tier: 'full',
      sampleCount: 0,
    });
  });

  it('keeps reportFrame identity stable across suppressed and unsuppressed frames alike', () => {
    // The bail-out must not perturb the callback identity MixerPeekStrip's rAF
    // effect was hardened around (an unstable identity there previously caused
    // a synchronous unbounded render loop).
    const h = renderCounted();
    const first = h.result.current.reportFrame;

    act(() => h.result.current.reportFrame(0));
    let t = pump(h.result, 0, 16, 6); // includes suppressed frames
    expect(h.result.current.reportFrame).toBe(first);

    t += 90; // a real change
    act(() => h.result.current.reportFrame(t));
    expect(h.result.current.reportFrame).toBe(first);
    expect(h.result.current.reset).toBeTypeOf('function');
  });
});
