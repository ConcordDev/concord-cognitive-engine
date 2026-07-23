'use client';

/**
 * usePerfBudget — lens-agnostic real-frame-cost budget with honest, visible
 * degradation tiers.
 *
 * Extracted from the world-lens's perf/auto-downgrade pattern
 * (`lib/world-lens/perf-monitor.ts` + the FPS auto-downgrade effect in
 * `components/world-lens/ConcordiaScene.tsx`) so any heavy non-world lens
 * (DAW/studio meters, music visualizers, code-editor previews, ...) can
 * measure its own real frame cost and degrade honestly instead of either
 * (a) doing nothing when the tab is struggling, or (b) silently dropping
 * work with no signal to the user.
 *
 * Honest-by-construction (CLAUDE.md "How we work here" #3): every number
 * this hook produces is a rolling average of REAL `requestAnimationFrame`
 * (or caller-supplied `performance.now()`) deltas — there is no
 * `setInterval` fake-progress path and no synthetic/random jitter. The tier
 * decision is a pure function of those measured deltas plus the configured
 * thresholds; nothing here fabricates a "reduced" or "minimal" state that
 * isn't backed by an actually-measured sustained frame-time regression.
 *
 * Two ways to feed it real timings:
 *   1. `autoMeasure: true` (default) — the hook runs its own rAF loop and
 *      measures wall-clock frame-to-frame deltas. Good for a component that
 *      has no render loop of its own but still wants an ambient perf read
 *      (e.g. "is the browser tab currently under load").
 *   2. `autoMeasure: false` + call the returned `reportFrame(now)` from
 *      inside a render loop the CALLER already owns (its own rAF, or a
 *      canvas draw callback). This measures the actual cost of that
 *      specific loop instead of a second, unrelated rAF cadence, and is
 *      also how the test suite drives the hook deterministically — same
 *      `reportFrame` code path a real rAF callback would call, just fed
 *      synthetic timestamps instead of real browser frames.
 *
 * Hysteresis mirrors the world-lens convention (fps < 50 sustained for 3
 * consecutive readings before downgrading — see the ConcordiaScene
 * `concordia:perf-budget` listener) so a single stutter frame never flips
 * the tier; only a SUSTAINED regression does, and tiers only change after
 * `warmupSamples` real samples have accumulated (never judge off a
 * not-yet-settled buffer, e.g. right after mount).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────

export type PerfTier = 'full' | 'reduced' | 'minimal';

export interface PerfBudgetState {
  /** Rolling-average frames-per-second from real measured frame deltas. */
  fps: number;
  /** Rolling-average per-frame cost in milliseconds. */
  frameMs: number;
  /** True once enough real samples have accumulated to judge a tier. */
  warmedUp: boolean;
  /** True whenever `tier !== 'full'` — the honest "we are degrading" flag. */
  overBudget: boolean;
  /** Current degradation tier, chosen with hysteresis so it never flaps. */
  tier: PerfTier;
  /** How many real frame samples are currently in the rolling buffer. */
  sampleCount: number;
}

export interface UsePerfBudgetOptions {
  /** fps at/above this qualifies for 'full'. Default 50 (world-lens parity). */
  fullFpsFloor?: number;
  /** fps at/above this (but below `fullFpsFloor`) qualifies for 'reduced';
   *  below it qualifies for 'minimal'. Default 30. */
  reducedFpsFloor?: number;
  /** Rolling window size, in frame samples. Default 60. */
  bufferSize?: number;
  /** Real samples required before any tier judgement is made — avoids
   *  penalizing a not-yet-settled buffer right after mount. Defaults to
   *  `bufferSize`. */
  warmupSamples?: number;
  /** Consecutive samples that must agree on a *different* tier before the
   *  hook commits to it (hysteresis — prevents single-stutter flapping).
   *  Default 3. */
  hysteresisSamples?: number;
  /** Run an internal rAF loop that self-measures wall-clock frame cost.
   *  Set false when the caller drives `reportFrame` from its own loop.
   *  Default true. */
  autoMeasure?: boolean;
  /** Pause measurement (e.g. lens not visible / tab hidden). Default true. */
  enabled?: boolean;
}

export interface UsePerfBudgetResult {
  /** Current honest, measured budget state. */
  budget: PerfBudgetState;
  /** Feed one real timestamp (ms — `performance.now()` or an rAF argument)
   *  into the measurement. Safe to call from a caller-owned render loop
   *  instead of (or in addition to) the internal `autoMeasure` loop. */
  reportFrame: (nowMs: number) => void;
  /** Clear all buffers/hysteresis state and return to 'full' — e.g. after
   *  a lens remounts with materially different content. */
  reset: () => void;
}

const DEFAULTS = {
  fullFpsFloor: 50,
  reducedFpsFloor: 30,
  bufferSize: 60,
  hysteresisSamples: 3,
  autoMeasure: true,
  enabled: true,
} as const;

const INITIAL_STATE: PerfBudgetState = {
  fps: 0,
  frameMs: 0,
  warmedUp: false,
  overBudget: false,
  tier: 'full',
  sampleCount: 0,
};

function classifyTier(fps: number, fullFloor: number, reducedFloor: number): PerfTier {
  if (fps >= fullFloor) return 'full';
  if (fps >= reducedFloor) return 'reduced';
  return 'minimal';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function usePerfBudget(options: UsePerfBudgetOptions = {}): UsePerfBudgetResult {
  const fullFpsFloor = options.fullFpsFloor ?? DEFAULTS.fullFpsFloor;
  const reducedFpsFloor = options.reducedFpsFloor ?? DEFAULTS.reducedFpsFloor;
  const bufferSize = options.bufferSize ?? DEFAULTS.bufferSize;
  const warmupSamples = options.warmupSamples ?? bufferSize;
  const hysteresisSamples = options.hysteresisSamples ?? DEFAULTS.hysteresisSamples;
  const autoMeasure = options.autoMeasure ?? DEFAULTS.autoMeasure;
  const enabled = options.enabled ?? DEFAULTS.enabled;

  // Real measured samples only — never fabricated or randomized.
  const frameMsBufRef = useRef<number[]>([]);
  const lastTsRef = useRef<number | null>(null);

  // Committed tier + the hysteresis vote-counting state.
  const tierRef = useRef<PerfTier>('full');
  const candidateTierRef = useRef<PerfTier>('full');
  const candidateStreakRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const [budget, setBudget] = useState<PerfBudgetState>(INITIAL_STATE);

  const reportFrame = useCallback(
    (now: number) => {
      const buf = frameMsBufRef.current;
      const prevTs = lastTsRef.current;
      lastTsRef.current = now;

      if (prevTs != null) {
        const dt = now - prevTs;
        // Guard against a bad/negative/zero timestamp (e.g. clock skew,
        // duplicate rAF callback) instead of letting it corrupt the average.
        if (Number.isFinite(dt) && dt > 0) {
          buf.push(dt);
          if (buf.length > bufferSize) buf.shift();
        }
      }

      const sampleCount = buf.length;
      const warmedUp = sampleCount >= warmupSamples;
      const avgFrameMs = sampleCount > 0 ? buf.reduce((a, b) => a + b, 0) / sampleCount : 0;
      const avgFps = avgFrameMs > 0 ? 1000 / avgFrameMs : 0;

      if (warmedUp) {
        const desired = classifyTier(avgFps, fullFpsFloor, reducedFpsFloor);
        if (desired === candidateTierRef.current) {
          candidateStreakRef.current += 1;
        } else {
          candidateTierRef.current = desired;
          candidateStreakRef.current = 1;
        }
        if (
          candidateStreakRef.current >= hysteresisSamples &&
          desired !== tierRef.current
        ) {
          tierRef.current = desired;
          candidateStreakRef.current = 0;
        }
      }

      const tier = tierRef.current;
      setBudget({
        fps: round1(avgFps),
        frameMs: round1(avgFrameMs),
        warmedUp,
        overBudget: tier !== 'full',
        tier,
        sampleCount,
      });
    },
    [bufferSize, warmupSamples, fullFpsFloor, reducedFpsFloor, hysteresisSamples]
  );

  const reset = useCallback(() => {
    frameMsBufRef.current = [];
    lastTsRef.current = null;
    tierRef.current = 'full';
    candidateTierRef.current = 'full';
    candidateStreakRef.current = 0;
    setBudget(INITIAL_STATE);
  }, []);

  useEffect(() => {
    if (!autoMeasure || !enabled) return undefined;
    if (typeof window === 'undefined') return undefined;

    let cancelled = false;
    const loop = (now: number) => {
      if (cancelled) return;
      reportFrame(now);
      rafRef.current = window.requestAnimationFrame(loop);
    };
    rafRef.current = window.requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [autoMeasure, enabled, reportFrame]);

  return useMemo(() => ({ budget, reportFrame, reset }), [budget, reportFrame, reset]);
}
