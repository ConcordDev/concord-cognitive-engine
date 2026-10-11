// server/lib/event-loop-pressure.js
//
// Track C (event-loop unblocking audit) — a cheap, checkable event-loop
// lag signal.
//
// Two readings, on purpose:
//   - `getCurrentLagMs()` is the latest window's MAX delay. One GC pause or
//     swap stall sets this. `isUnderPressure()` still uses it so deferrable
//     background work can back off on a spike.
//   - `getSustainedLagMs()` is the rolling mean of each window's p99 over
//     several windows (default 5 × 2s). Request admission sheds on THIS
//     value, plus a consecutive-window strike count owned by
//     request-admission.js. A single max sample must not shed traffic.
//
// Not a general-purpose backpressure framework. The histogram is its own
// instance, independent of server.js's 30s logging window.

let _histogram = null;
let _samplerHandle = null;
let _currentMaxMs = 0;
let _latestP99Ms = 0;
let _sustainedLagMs = 0;
/** @type {number[]} */
let _p99Windows = [];

const LAG_PRESSURE_THRESHOLD_MS = Number(process.env.CONCORD_EVENT_LOOP_PRESSURE_MS) || 300;
const SAMPLE_INTERVAL_MS = Number(process.env.CONCORD_EVENT_LOOP_SAMPLE_MS) || 2_000;
const WINDOW_COUNT = Math.max(1, Number(process.env.CONCORD_EVENT_LOOP_WINDOWS) || 5);

function _mean(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function _nsToMs(ns) {
  const n = Number(ns);
  return Number.isFinite(n) && n > 0 ? n / 1e6 : 0;
}

/**
 * Record one sample window. Shared by the live sampler and tests.
 * @param {{ maxMs?: number, p99Ms?: number, p95Ms?: number }} sample
 */
export function recordLagWindow(sample = {}) {
  const maxMs = Number(sample.maxMs) || 0;
  const p99Ms = Number.isFinite(Number(sample.p99Ms)) ? Number(sample.p99Ms) : maxMs;
  _currentMaxMs = maxMs;
  _latestP99Ms = p99Ms;
  _p99Windows.push(p99Ms);
  if (_p99Windows.length > WINDOW_COUNT) {
    _p99Windows.splice(0, _p99Windows.length - WINDOW_COUNT);
  }
  _sustainedLagMs = _mean(_p99Windows);
  return getLagSnapshot();
}

/**
 * Start sampling event-loop delay. Idempotent — a second call is a no-op
 * unless the first was stopped.
 */
export async function startEventLoopPressureMonitor() {
  if (_histogram) return;
  try {
    const { monitorEventLoopDelay } = await import("node:perf_hooks");
    _histogram = monitorEventLoopDelay({ resolution: 20 });
    _histogram.enable();
    _samplerHandle = setInterval(() => {
      try {
        const maxMs = _nsToMs(_histogram.max);
        const p99Ms = typeof _histogram.percentile === "function"
          ? _nsToMs(_histogram.percentile(99))
          : maxMs;
        const p95Ms = typeof _histogram.percentile === "function"
          ? _nsToMs(_histogram.percentile(95))
          : p99Ms;
        const snap = recordLagWindow({ maxMs, p99Ms, p95Ms });
        _histogram.reset();
        // Strike accounting lives in request-admission. Dynamic import avoids
        // a load cycle (that module imports getSustainedLagMs from here).
        import("./request-admission.js")
          .then((mod) => {
            mod.observeLagWindow?.({ sustainedMs: snap.sustainedMs, latestMs: snap.p99Ms });
          })
          .catch(() => {});
      } catch { /* sampler best-effort — a bad read keeps the last value */ }
    }, SAMPLE_INTERVAL_MS);
    _samplerHandle.unref?.();
  } catch {
    // perf_hooks unavailable — isUnderPressure() stays false (never sheds
    // background work) rather than throwing at a call site.
    _histogram = null;
  }
}

/** Test/shutdown helper — stops sampling and resets state. */
export function stopEventLoopPressureMonitor() {
  if (_samplerHandle) { clearInterval(_samplerHandle); _samplerHandle = null; }
  _histogram = null;
  _currentMaxMs = 0;
  _latestP99Ms = 0;
  _sustainedLagMs = 0;
  _p99Windows = [];
}

/** Latest window's max event-loop delay (ms). One spike shows up here. */
export function getCurrentLagMs() {
  return _currentMaxMs;
}

/** Latest window's p99 delay (ms). */
export function getLatestP99LagMs() {
  return _latestP99Ms;
}

/**
 * Rolling mean of window p99s. This is the admission-control signal:
 * one bad max inside an otherwise healthy window does not move it much,
 * and one bad window is averaged with its neighbours.
 */
export function getSustainedLagMs() {
  return _sustainedLagMs;
}

export function getLagSnapshot() {
  return {
    maxMs: _currentMaxMs,
    p99Ms: _latestP99Ms,
    sustainedMs: _sustainedLagMs,
    windows: _p99Windows.length,
    windowCount: WINDOW_COUNT,
  };
}

/**
 * Is the event loop currently spiked hard enough that deferrable background
 * work should skip THIS pass? This stays on the max sample so a pause backs
 * off heartbeats immediately. Request shedding uses getSustainedLagMs plus
 * the strike rule — a spike here is not, by itself, an overload.
 */
export function isUnderPressure() {
  return _currentMaxMs > LAG_PRESSURE_THRESHOLD_MS;
}

/**
 * Test-only: set the current max AND the sustained/p99 readings to `ms`
 * without a real sampler. Does not touch admission strike counters.
 */
export function _setLagMsForTest(ms) {
  const n = Number(ms) || 0;
  _currentMaxMs = n;
  _latestP99Ms = n;
  _sustainedLagMs = n;
  _p99Windows = [n];
}
