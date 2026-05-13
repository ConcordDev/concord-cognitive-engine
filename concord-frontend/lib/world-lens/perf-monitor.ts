/**
 * Phase AA — performance monitor + budget plumbing.
 *
 * Wraps Stats.js into a small floating widget that shows FPS / frame
 * time / draw calls / triangles. Exposes a getter for budget checks
 * (Playwright perf.spec.ts reads via window.__CONCORD_PERF__).
 *
 * Mounted in dev mode + when the URL has ?perf=1.
 *
 * Per-tier budget caps (see docs/PERFORMANCE_BUDGET.md):
 *   - high: 60fps, ≤16ms frame, ≤500 draw calls, ≤2M triangles
 *   - low:  30fps, ≤33ms frame, ≤200 draw calls, ≤500K triangles
 */

import Stats from 'stats.js';

export interface PerfSample {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
}

export interface PerfBudget {
  tier: 'high' | 'low';
  fpsFloor: number;
  frameMsCeiling: number;
  drawCallCeiling: number;
  triangleCeiling: number;
}

export const PERF_BUDGETS: Record<'high' | 'low', PerfBudget> = {
  high: { tier: 'high', fpsFloor: 60, frameMsCeiling: 16, drawCallCeiling: 500, triangleCeiling: 2_000_000 },
  low:  { tier: 'low',  fpsFloor: 30, frameMsCeiling: 33, drawCallCeiling: 200, triangleCeiling:   500_000 },
};

interface PerfMonitorState {
  stats: Stats | null;
  renderer: { info: { render: { calls: number; triangles: number } } } | null;
  fpsBuf: number[];
  frameMsBuf: number[];
}

const _state: PerfMonitorState = {
  stats: null,
  renderer: null,
  fpsBuf: [],
  frameMsBuf: [],
};

/** Mount the Stats.js DOM widget. Idempotent — second call is a no-op. */
export function mountPerfMonitor(opts: { dev?: boolean } = {}): void {
  if (typeof window === 'undefined' || _state.stats) return;
  const enabled = opts.dev || new URLSearchParams(window.location.search).has('perf');
  if (!enabled) return;
  const stats = new Stats();
  stats.showPanel(0); // 0 = FPS, 1 = frame ms, 2 = MB
  stats.dom.style.position = 'fixed';
  stats.dom.style.top      = '8px';
  stats.dom.style.left     = '8px';
  stats.dom.style.zIndex   = '999';
  document.body.appendChild(stats.dom);
  _state.stats = stats;
  // Expose snapshot getter for tests + budget checks.
  (window as { __CONCORD_PERF__?: { sample: () => PerfSample } }).__CONCORD_PERF__ = { sample };
}

/** Hook for the imperative renderer to feed Three.js info each frame. */
export function attachRenderer(renderer: { info: { render: { calls: number; triangles: number } } }): void {
  _state.renderer = renderer;
}

let lastTs = 0;

/** Call inside the per-frame loop. */
export function tickPerfMonitor(): void {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const dt = lastTs ? now - lastTs : 16;
  lastTs = now;
  _state.frameMsBuf.push(dt);
  if (_state.frameMsBuf.length > 120) _state.frameMsBuf.shift();
  _state.fpsBuf.push(1000 / Math.max(0.1, dt));
  if (_state.fpsBuf.length > 120) _state.fpsBuf.shift();
  if (_state.stats) { _state.stats.begin(); _state.stats.end(); }
}

export function sample(): PerfSample {
  const fpsAvg    = _state.fpsBuf.length    ? _state.fpsBuf.reduce((a, b) => a + b, 0) / _state.fpsBuf.length        : 0;
  const frameMsAvg = _state.frameMsBuf.length ? _state.frameMsBuf.reduce((a, b) => a + b, 0) / _state.frameMsBuf.length : 0;
  const drawCalls = _state.renderer?.info?.render?.calls     ?? 0;
  const triangles = _state.renderer?.info?.render?.triangles ?? 0;
  return { fps: fpsAvg, frameMs: frameMsAvg, drawCalls, triangles };
}

export interface BudgetCheck {
  tier: 'high' | 'low';
  pass: boolean;
  breached: Array<{ metric: keyof PerfSample; value: number; threshold: number }>;
}

export function checkBudget(tier: 'high' | 'low'): BudgetCheck {
  const s = sample();
  const b = PERF_BUDGETS[tier];
  const breached: BudgetCheck['breached'] = [];
  if (s.fps        < b.fpsFloor)         breached.push({ metric: 'fps',       value: s.fps,       threshold: b.fpsFloor });
  if (s.frameMs    > b.frameMsCeiling)   breached.push({ metric: 'frameMs',   value: s.frameMs,   threshold: b.frameMsCeiling });
  if (s.drawCalls  > b.drawCallCeiling)  breached.push({ metric: 'drawCalls', value: s.drawCalls, threshold: b.drawCallCeiling });
  if (s.triangles  > b.triangleCeiling)  breached.push({ metric: 'triangles', value: s.triangles, threshold: b.triangleCeiling });
  return { tier, pass: breached.length === 0, breached };
}
