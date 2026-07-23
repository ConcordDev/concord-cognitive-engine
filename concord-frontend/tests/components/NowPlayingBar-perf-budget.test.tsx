/**
 * NowPlayingBar — honest perf-budget degradation of the mini spectrum
 * visualizer.
 *
 * The visualizer's own `requestAnimationFrame` loop (getFrequencyData + N
 * canvas fills every frame) is wired to `usePerfBudget`'s REAL, measured
 * tier for that specific loop. This pins:
 *   1. `visualizerConfigForTier` — the pure tier→config mapping — in
 *      isolation.
 *   2. At 'full' the canvas mounts, draws every frame, at 24 bars, and no
 *      degradation badge is shown (never decorative).
 *   3. At 'reduced' the canvas still mounts but the draw work only runs
 *      every 2nd measured frame at a reduced bar count, and the "fx↓"
 *      badge is visible.
 *   4. At 'minimal' the canvas is dropped from the DOM entirely (not just
 *      hidden) and the "fx off" badge is visible.
 *
 * `usePerfBudget` itself is mocked (its own real-rAF correctness is proven
 * by `tests/hooks/usePerfBudget.test.ts`); this suite forces its tier value
 * and asserts the CONSUMER (NowPlayingBar) responds honestly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import type { PerfTier } from '@/hooks/usePerfBudget';
import type { MusicTrack, NowPlayingState } from '@/lib/music/types';

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

// ---- Music store — enough of the real shape for NowPlayingBar to render
// its "playing" state without crashing. ----
const track: MusicTrack = {
  id: 'trk-1',
  title: 'Test Track',
  artistId: 'art-1',
  artistName: 'Test Artist',
  albumId: null,
  albumTitle: null,
  coverArtUrl: null, // avoids needing a next/image mock
  audioUrl: '/audio/trk-1.mp3',
  previewUrl: null,
  duration: 200,
  trackNumber: null,
  genre: 'electronic',
  subGenre: null,
  tags: [],
  bpm: 120,
  key: 'C',
  loudnessLUFS: null,
  spectralCentroid: null,
  onsetDensity: null,
  waveformPeaks: [],
  tiers: [],
  playCount: 0,
  purchaseCount: 0,
  remixCount: 0,
  parentTrackId: null,
  parentArtistId: null,
  parentTitle: null,
  lineageDepth: 0,
  stems: [],
  releaseDate: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isExplicit: false,
  lyrics: null,
  credits: [],
  chromaprintHash: null,
};

const nowPlaying: NowPlayingState = {
  track,
  playbackState: 'playing',
  currentTime: 10,
  duration: 200,
  volume: 0.8,
  muted: false,
  repeat: 'off',
  shuffle: false,
};

vi.mock('@/lib/music/store', () => ({
  useMusicStore: () => ({
    nowPlaying,
    setPlaybackState: vi.fn(),
    setCurrentTime: vi.fn(),
    setDuration: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    setRepeat: vi.fn(),
    toggleShuffle: vi.fn(),
    nextTrack: () => null,
    previousTrack: () => null,
    hasNext: () => false,
    hasPrevious: () => false,
    queue: [],
    queueIndex: 0,
  }),
}));

const getFrequencyDataMock = vi.fn(() => new Uint8Array(64).fill(128));

vi.mock('@/lib/music/player', () => ({
  getPlayer: () => ({
    on: () => () => {},
    getCrossfadeSeconds: () => 0,
    hasActiveTrack: () => false,
    isCrossfading: () => false,
    crossfadeTo: vi.fn(),
    loadTrack: vi.fn().mockResolvedValue(undefined),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    getFrequencyData: getFrequencyDataMock,
  }),
}));

import { NowPlayingBar, visualizerConfigForTier } from '@/components/music/NowPlayingBar';

// ---- Manual rAF driver — captures callbacks instead of auto-firing, so the
// test controls exactly which real timestamps the visualizer loop sees. ----
let rafCallbacks: Array<(now: number) => void>;

function flushFrame(now: number) {
  const cbs = rafCallbacks;
  rafCallbacks = [];
  cbs.forEach((cb) => cb(now));
}

beforeEach(() => {
  mockTier = 'full';
  reportFrameSpy.mockClear();
  getFrequencyDataMock.mockClear();
  rafCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (cb: (n: number) => void) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  // jsdom's canvas 2D context is a stub; getContext must return a truthy,
  // fillRect/clearRect-capable object for the draw loop to proceed.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('visualizerConfigForTier — pure tier→config mapping', () => {
  it('full = 24 bars every frame, reduced = 10 bars every 2nd frame, minimal = disabled', () => {
    expect(visualizerConfigForTier('full')).toEqual({ enabled: true, barCount: 24, frameSkip: 1 });
    expect(visualizerConfigForTier('reduced')).toEqual({ enabled: true, barCount: 10, frameSkip: 2 });
    expect(visualizerConfigForTier('minimal')).toEqual({ enabled: false, barCount: 0, frameSkip: 1 });
  });
});

describe('NowPlayingBar — perf-budget-driven visualizer degradation', () => {
  it('full tier: mounts the canvas, draws every frame, no degradation badge', () => {
    mockTier = 'full';
    const { container } = render(<NowPlayingBar />);

    expect(container.querySelector('canvas')).not.toBeNull();
    expect(screen.queryByTestId('now-playing-perf-badge')).toBeNull();

    act(() => flushFrame(16));
    act(() => flushFrame(32));
    // Every frame does the expensive draw work at 'full'.
    expect(getFrequencyDataMock).toHaveBeenCalledTimes(2);
    expect(reportFrameSpy).toHaveBeenCalledTimes(2);
  });

  it('reduced tier: keeps the canvas mounted but only draws every 2nd frame, shows the "fx↓" badge', () => {
    mockTier = 'reduced';
    const { container } = render(<NowPlayingBar />);

    expect(container.querySelector('canvas')).not.toBeNull();
    const badge = screen.getByTestId('now-playing-perf-badge');
    expect(badge.textContent).toMatch(/fx↓/);

    act(() => flushFrame(16)); // frame 1 — skipped (frameSkip 2)
    act(() => flushFrame(32)); // frame 2 — drawn
    act(() => flushFrame(48)); // frame 3 — skipped
    act(() => flushFrame(64)); // frame 4 — drawn

    expect(getFrequencyDataMock).toHaveBeenCalledTimes(2);
    // Measurement still runs on every single frame, degraded or not.
    expect(reportFrameSpy).toHaveBeenCalledTimes(4);
  });

  it('minimal tier: drops the canvas from the DOM entirely and shows the "fx off" badge', () => {
    mockTier = 'minimal';
    const { container } = render(<NowPlayingBar />);

    expect(container.querySelector('canvas')).toBeNull();
    const badge = screen.getByTestId('now-playing-perf-badge');
    expect(badge.textContent).toMatch(/fx off/);

    // No draw-loop rAF is scheduled at all when the visualizer is disabled —
    // the expensive per-frame work (and its measurement loop) is genuinely
    // gone, not merely hidden behind CSS.
    expect(rafCallbacks.length).toBe(0);
    expect(getFrequencyDataMock).not.toHaveBeenCalled();
  });
});
