/**
 * MixerPeekStrip — honest perf-budget degradation.
 *
 * The VU-meter ticker (a bare 60fps-ish `requestAnimationFrame` loop that
 * re-renders every mounted channel strip on every tick) is wired to
 * `usePerfBudget`'s REAL, measured tier for its own loop. This pins:
 *   1. `meterTickIntervalMs` — the pure tier→cadence mapping — in isolation.
 *   2. At the 'full' tier the ticker ticks every frame and shows no
 *      degradation badge (never decorative — only present when genuinely
 *      degraded).
 *   3. At 'reduced' the ticker only advances once >=80 real ms have elapsed
 *      since the last tick (throttled, not stopped), and the "reduced fx"
 *      badge is visible.
 *   4. At 'minimal' the ticker never advances again (frozen — a real,
 *      measurable cost cut, not merely slower), the "meters frozen" badge is
 *      visible, and the loop keeps calling `reportFrame` every frame so the
 *      tier can still recover once real perf improves.
 *
 * `usePerfBudget` itself is mocked here (its own real-rAF behavior is proven
 * by `tests/hooks/usePerfBudget.test.ts`); this suite forces its tier value
 * and asserts the CONSUMER (MixerPeekStrip) responds honestly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import type { PerfTier } from '@/hooks/usePerfBudget';
import type { DAWTrack } from '@/lib/daw/types';

let mockTier: PerfTier = 'full';
const reportFrameSpy = vi.fn();

vi.mock('@/hooks/usePerfBudget', () => ({
  usePerfBudget: () => ({
    budget: {
      fps: mockTier === 'full' ? 60 : mockTier === 'reduced' ? 40 : 20,
      frameMs: mockTier === 'full' ? 16.7 : mockTier === 'reduced' ? 25 : 50,
      warmedUp: true,
      overBudget: mockTier !== 'full',
      tier: mockTier,
      sampleCount: 60,
    },
    reportFrame: reportFrameSpy,
    reset: vi.fn(),
  }),
}));

import MixerPeekStrip, { meterTickIntervalMs } from '@/components/studio/MixerPeekStrip';

function track(id: string): DAWTrack {
  return {
    id,
    name: `Track ${id}`,
    type: 'audio',
    color: '#22c55e',
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    frozen: false,
    height: 60,
    instrumentId: null,
    effectChain: [],
    sendLevels: {},
    clips: [],
    automationLanes: [],
    inputSource: null,
    outputTarget: 'master',
  };
}

const tracks = [track('t1'), track('t2')];

// ---- Manual rAF driver — captures callbacks instead of auto-firing, so the
// test controls exactly which real timestamps the ticker sees. ----
let rafCallbacks: Array<(now: number) => void>;

function flushFrame(now: number) {
  const cbs = rafCallbacks;
  rafCallbacks = [];
  cbs.forEach((cb) => cb(now));
}

beforeEach(() => {
  mockTier = 'full';
  reportFrameSpy.mockClear();
  rafCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (cb: (n: number) => void) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('meterTickIntervalMs — pure tier→cadence mapping', () => {
  it('full = every frame (0), reduced = ~80ms throttle, minimal = frozen (Infinity)', () => {
    expect(meterTickIntervalMs('full')).toBe(0);
    expect(meterTickIntervalMs('reduced')).toBe(80);
    expect(meterTickIntervalMs('minimal')).toBe(Infinity);
  });
});

describe('MixerPeekStrip — perf-budget-driven degradation', () => {
  it('full tier: ticks every frame, no degradation badge shown', () => {
    mockTier = 'full';
    render(<MixerPeekStrip tracks={tracks} selectedTrackId={null} />);

    expect(screen.queryByTestId('mixer-perf-badge')).toBeNull();

    const before = Number(screen.getByTestId('mixer-tick').textContent);
    act(() => flushFrame(16));
    act(() => flushFrame(32));
    const after = Number(screen.getByTestId('mixer-tick').textContent);
    expect(after).toBeGreaterThan(before);
    expect(reportFrameSpy).toHaveBeenCalledTimes(2);
  });

  it('reduced tier: throttles ticks to real ~80ms gaps and shows the "reduced fx" badge', () => {
    mockTier = 'reduced';
    render(<MixerPeekStrip tracks={tracks} selectedTrackId={null} />);

    const badge = screen.getByTestId('mixer-perf-badge');
    expect(badge.textContent).toMatch(/reduced fx/i);

    // Frames arriving faster than the 80ms floor must NOT advance the tick.
    act(() => flushFrame(10));
    expect(screen.getByTestId('mixer-tick').textContent).toBe('0');
    act(() => flushFrame(50));
    expect(screen.getByTestId('mixer-tick').textContent).toBe('0');
    // Crossing the 80ms real gap (measured from t=0) DOES advance it.
    act(() => flushFrame(90));
    expect(screen.getByTestId('mixer-tick').textContent).toBe('1');
    // Immediately after, another sub-80ms frame is skipped again.
    act(() => flushFrame(100));
    expect(screen.getByTestId('mixer-tick').textContent).toBe('1');
    // Real measurement never stops, even while throttled.
    expect(reportFrameSpy).toHaveBeenCalledTimes(4);
  });

  it('minimal tier: freezes the ticker (never advances) and shows the "meters frozen" badge, but keeps measuring', () => {
    mockTier = 'minimal';
    render(<MixerPeekStrip tracks={tracks} selectedTrackId={null} />);

    const badge = screen.getByTestId('mixer-perf-badge');
    expect(badge.textContent).toMatch(/meters frozen/i);

    const before = screen.getByTestId('mixer-tick').textContent;
    act(() => flushFrame(1_000));
    act(() => flushFrame(50_000));
    act(() => flushFrame(999_999));
    expect(screen.getByTestId('mixer-tick').textContent).toBe(before);
    // The loop keeps running (and reporting real frames) so the tier can
    // still recover once real perf improves — it isn't torn down.
    expect(reportFrameSpy).toHaveBeenCalledTimes(3);
  });
});
