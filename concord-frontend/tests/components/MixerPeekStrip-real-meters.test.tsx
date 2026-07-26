/**
 * MixerPeekStrip — meters read REAL per-channel RMS, or a real zero.
 *
 * This pins CLAUDE.md's zero-demo-content invariant for the mixer VU meters.
 * They used to be driven by `fakeLevel(volume)` — a `Date.now()`-plus-sine
 * synthesis that animated whether or not any audio existed, which reads to a
 * user as signal presence. They now sample the live `MixerEngine`'s
 * per-channel `AnalyserNode`s via `getAllTrackLevels()`.
 *
 * Two directions are asserted, and the second is the load-bearing one:
 *   1. With an engine reporting known RMS values, the meters reflect exactly
 *      those values (and track them as they change).
 *   2. With NO engine — or an engine that has no channel for a track, or one
 *      whose audio graph throws — the meters read a genuine ZERO and stay
 *      there across wildly different timestamps. Silence looks like silence:
 *      there is no synthesized motion left to fall back to.
 *
 * `usePerfBudget` is mocked at the 'full' tier so the sampler ticks every
 * frame; its own honest degradation behavior is pinned separately by
 * `tests/components/MixerPeekStrip-perf-budget.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import React from 'react';
import type { DAWTrack } from '@/lib/daw/types';

// The real hook memoizes its result (`useCallback`/`useMemo`), so `reportFrame`
// keeps ONE identity across renders. The mock is a module-level spy to stay
// faithful to that contract — a mock that minted a fresh function per render
// would misrepresent the hook.
const reportFrameSpy = vi.fn();
// Flipped on by the render-loop-safety test below to deliberately emulate a
// perf hook whose callback identity DOES churn every render.
let unstableReportFrame = false;

vi.mock('@/hooks/usePerfBudget', () => ({
  usePerfBudget: () => ({
    budget: { fps: 60, frameMs: 16.7, warmedUp: true, overBudget: false, tier: 'full', sampleCount: 60 },
    reportFrame: unstableReportFrame ? vi.fn() : reportFrameSpy,
    reset: vi.fn(),
  }),
}));

// Stand-in for the live MixerEngine. `null` = no engine at all.
let mockMixer: { getAllTrackLevels: () => Record<string, number> } | null = null;

vi.mock('@/lib/daw/engine', () => ({
  getActiveMixer: () => mockMixer,
}));

import MixerPeekStrip from '@/components/studio/MixerPeekStrip';

function track(id: string, patch: Partial<DAWTrack> = {}): DAWTrack {
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
    ...patch,
  };
}

const tracks = [track('t1'), track('t2')];

// ---- Manual rAF driver (same shape as the perf-budget suite) ----
let rafCallbacks: Array<(now: number) => void>;

function flushFrame(now: number) {
  const cbs = rafCallbacks;
  rafCallbacks = [];
  cbs.forEach((cb) => cb(now));
}

function meterLevel(trackId: string): number {
  return Number(screen.getByTestId(`mixer-meter-${trackId}`).getAttribute('data-level'));
}

function meterMeasuring(trackId: string): string | null {
  return screen.getByTestId(`mixer-meter-${trackId}`).getAttribute('data-measuring');
}

/** Count of lit segments — what a user actually perceives as level. */
function litSegments(trackId: string): number {
  const meter = screen.getByTestId(`mixer-meter-${trackId}`);
  return Array.from(meter.children).filter(
    (seg) => !(seg as HTMLElement).className.includes('bg-zinc-700/40'),
  ).length;
}

beforeEach(() => {
  mockMixer = null;
  rafCallbacks = [];
  unstableReportFrame = false;
  reportFrameSpy.mockClear();
  vi.stubGlobal('requestAnimationFrame', (cb: (n: number) => void) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MixerPeekStrip — real per-channel RMS', () => {
  it('reflects the engine\'s reported RMS per track, and tracks it as it changes', () => {
    const levels: Record<string, number> = { t1: 0.5, t2: 0.125 };
    mockMixer = { getAllTrackLevels: () => ({ ...levels }) };

    render(<MixerPeekStrip tracks={tracks} selectedTrackId={null} />);
    act(() => flushFrame(16));

    expect(meterLevel('t1')).toBeCloseTo(0.5, 4);
    expect(meterLevel('t2')).toBeCloseTo(0.125, 4);
    expect(meterMeasuring('t1')).toBe('true');
    // 8 segments → 0.5 lights 4, 0.125 lights 1.
    expect(litSegments('t1')).toBe(4);
    expect(litSegments('t2')).toBe(1);

    // Change the source; the meter must follow the source, not a clock.
    levels.t1 = 1;
    levels.t2 = 0;
    act(() => flushFrame(32));
    expect(meterLevel('t1')).toBeCloseTo(1, 4);
    expect(litSegments('t1')).toBe(8);
    expect(meterLevel('t2')).toBe(0);
    expect(litSegments('t2')).toBe(0);
  });

  it('labels the source as live only when an engine actually answered', () => {
    mockMixer = { getAllTrackLevels: () => ({ t1: 0.2, t2: 0.2 }) };
    render(<MixerPeekStrip tracks={tracks} selectedTrackId={null} />);
    act(() => flushFrame(16));

    const label = screen.getByTestId('mixer-meter-source');
    expect(label.getAttribute('data-engine-live')).toBe('true');
    expect(label.textContent).toMatch(/live levels/i);
    expect(label.textContent).not.toMatch(/sim/i);
  });

  it('renders real measured levels in the expanded channel-strip view too', () => {
    mockMixer = { getAllTrackLevels: () => ({ t1: 0.75, t2: 0 }) };
    render(<MixerPeekStrip tracks={tracks} selectedTrackId={null} expanded />);
    act(() => flushFrame(16));

    expect(meterLevel('t1')).toBeCloseTo(0.75, 4);
    expect(litSegments('t1')).toBe(6);
    expect(meterLevel('t2')).toBe(0);
    expect(litSegments('t2')).toBe(0);
  });
});

describe('MixerPeekStrip — honest idle (anti-fabrication)', () => {
  it('reads a real ZERO and never animates when there is NO engine', () => {
    mockMixer = null;
    render(<MixerPeekStrip tracks={tracks} selectedTrackId={null} />);

    // Before any frame at all.
    expect(meterLevel('t1')).toBe(0);
    expect(meterMeasuring('t1')).toBe('false');

    // Wildly separated timestamps — a time-driven synthesis (the old
    // `Date.now()`-plus-sine `fakeLevel`) would move here. A real meter
    // cannot: there is no signal to measure.
    for (const t of [16, 400, 800, 1_600, 12_345, 987_654]) {
      act(() => flushFrame(t));
      expect(meterLevel('t1')).toBe(0);
      expect(meterLevel('t2')).toBe(0);
      expect(litSegments('t1')).toBe(0);
      expect(litSegments('t2')).toBe(0);
    }

    // ...and the strip says so out loud rather than implying live audio.
    const label = screen.getByTestId('mixer-meter-source');
    expect(label.getAttribute('data-engine-live')).toBe('false');
    expect(label.textContent).toMatch(/idle/i);
  });

  it('holds volume-independent zero: a loud fader with no signal still reads zero', () => {
    // The old fake derived the meter from `volume`, so a track at full fader
    // looked hot even in dead silence. Real RMS is independent of the fader
    // position when nothing is playing.
    mockMixer = null;
    render(
      <MixerPeekStrip
        tracks={[track('t1', { volume: 1 }), track('t2', { volume: 0.05 })]}
        selectedTrackId={null}
      />,
    );
    act(() => flushFrame(16));

    expect(meterLevel('t1')).toBe(0);
    expect(meterLevel('t2')).toBe(0);
    expect(litSegments('t1')).toBe(0);
  });

  it('reads zero for a track the engine has no channel for', () => {
    // Engine is live, but t2 was never added as a mixer channel.
    mockMixer = { getAllTrackLevels: () => ({ t1: 0.625 }) };
    render(<MixerPeekStrip tracks={tracks} selectedTrackId={null} />);
    act(() => flushFrame(16));

    expect(meterLevel('t1')).toBeCloseTo(0.625, 4);
    expect(meterMeasuring('t1')).toBe('true');
    expect(meterLevel('t2')).toBe(0);
    expect(meterMeasuring('t2')).toBe('false');
    expect(litSegments('t2')).toBe(0);
  });

  it('falls back to zero (not to motion) when the audio graph throws', () => {
    mockMixer = {
      getAllTrackLevels: () => {
        throw new Error('audio context closed');
      },
    };
    render(<MixerPeekStrip tracks={tracks} selectedTrackId={null} />);

    act(() => flushFrame(16));
    act(() => flushFrame(90_000));

    expect(meterLevel('t1')).toBe(0);
    expect(meterMeasuring('t1')).toBe('false');
    expect(screen.getByTestId('mixer-meter-source').getAttribute('data-engine-live')).toBe('false');
  });

  it('samples the live analysers every frame, but only re-renders on a real change', () => {
    // The bail-out that keeps an unchanged reading from queueing React work is
    // a cost cut ONLY — it must never hold or smooth a stale value. A mixer
    // sitting in real silence reads the same true zeros frame after frame;
    // the instant a channel's measured RMS moves, the meter moves with it.
    const levels: Record<string, number> = { t1: 0, t2: 0 };
    let reads = 0;
    mockMixer = {
      getAllTrackLevels: () => {
        reads += 1;
        return { ...levels };
      },
    };
    render(<MixerPeekStrip tracks={tracks} selectedTrackId={null} />);

    const readsAfterMount = reads;
    for (const t of [16, 32, 48, 64]) act(() => flushFrame(t));
    // Every frame really did hit the analysers...
    expect(reads).toBeGreaterThan(readsAfterMount + 3);
    // ...and every frame honestly reported the measured zero.
    expect(meterLevel('t1')).toBe(0);

    levels.t1 = 0.375;
    act(() => flushFrame(80));
    expect(meterLevel('t1')).toBeCloseTo(0.375, 4);
    expect(litSegments('t1')).toBe(3);
  });

  it('goes back to a real idle zero when a live engine disappears mid-session', () => {
    mockMixer = { getAllTrackLevels: () => ({ t1: 0.875, t2: 0.875 }) };
    render(<MixerPeekStrip tracks={tracks} selectedTrackId={null} />);
    act(() => flushFrame(16));
    expect(meterLevel('t1')).toBeCloseTo(0.875, 4);

    // Engine disposed (getActiveMixer() → null).
    mockMixer = null;
    act(() => flushFrame(32));

    expect(meterLevel('t1')).toBe(0);
    expect(meterMeasuring('t1')).toBe('false');
    expect(screen.getByTestId('mixer-meter-source').textContent).toMatch(/idle/i);
  });
});

describe('MixerPeekStrip — meter loop is render-loop safe', () => {
  it('owns exactly one rAF subscription even when the perf hook churns its callback identity', () => {
    // Regression, found by this suite: the sampler effect listed `reportFrame`
    // — a callback identity owned by usePerfBudget — in its deps while its
    // body performed a state update. Given a hook whose identity changes per
    // render, that pair is a synchronous, unbounded render loop (React says
    // "Maximum update depth exceeded" and keeps going), which locks the tab
    // and orphans one rAF registration per pass. usePerfBudget is memo-stable
    // today; this pins that the meter loop does not depend on it staying so.
    unstableReportFrame = true;
    const levels: Record<string, number> = { t1: 0.5, t2: 0.25 };
    mockMixer = { getAllTrackLevels: () => ({ ...levels }) };

    render(<MixerPeekStrip tracks={tracks} selectedTrackId={null} />);
    // One loop, not one per render.
    expect(rafCallbacks.length).toBe(1);

    act(() => flushFrame(16));
    expect(rafCallbacks.length).toBe(1);

    // ...and it is still reading and reporting real levels while doing so.
    expect(meterLevel('t1')).toBeCloseTo(0.5, 4);
    levels.t1 = 0.75;
    act(() => flushFrame(32));
    expect(rafCallbacks.length).toBe(1);
    expect(meterLevel('t1')).toBeCloseTo(0.75, 4);
    expect(meterMeasuring('t1')).toBe('true');
  });
});
