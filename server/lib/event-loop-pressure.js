// server/lib/event-loop-pressure.js
//
// Track C (event-loop unblocking audit) — turns the existing PURELY
// OBSERVATIONAL event-loop-lag monitor (server.js's `event_loop_lag_spike`
// structured-log block, built on the same `perf_hooks.monitorEventLoopDelay`
// primitive) into an actual, cheap, checkable signal a caller can act on.
//
// This is deliberately its own small histogram instance, not a reuse of
// server.js's logging-only one — that one resets on its own 30s cadence for
// log-window framing, which would make it a noisy, coupled dependency for a
// caller that wants "how bad is it RIGHT NOW." This module resamples on a
// short, independent cadence instead.
//
// Not a general-purpose backpressure framework — a narrow, load-bearing
// primitive: `isUnderPressure()` answers one question ("should genuinely
// deferrable background work back off this tick?") for the one caller that
// needs it (`tickAllRegistered`'s `lowPriority` skip in
// emergent/heartbeat-registry.js). Extending it to gate request-handling
// routes or macro execution is a bigger, separate decision — not made here.

let _histogram = null;
let _samplerHandle = null;
let _currentMaxMs = 0;

const LAG_PRESSURE_THRESHOLD_MS = Number(process.env.CONCORD_EVENT_LOOP_PRESSURE_MS) || 300;
const SAMPLE_INTERVAL_MS = Number(process.env.CONCORD_EVENT_LOOP_SAMPLE_MS) || 2_000;

/**
 * Start sampling event-loop delay. Idempotent — safe to call more than once
 * (e.g. once from server.js at boot, once from a test harness); a second
 * call is a no-op unless the first was stopped.
 */
export async function startEventLoopPressureMonitor() {
  if (_histogram) return; // already running
  try {
    const { monitorEventLoopDelay } = await import("node:perf_hooks");
    _histogram = monitorEventLoopDelay({ resolution: 20 });
    _histogram.enable();
    _samplerHandle = setInterval(() => {
      try {
        _currentMaxMs = Number.isFinite(_histogram.max) ? _histogram.max / 1e6 : 0;
        _histogram.reset();
      } catch { /* sampler best-effort — a bad read just keeps the last value */ }
    }, SAMPLE_INTERVAL_MS);
    _samplerHandle.unref?.();
  } catch {
    // perf_hooks unavailable — isUnderPressure() degrades to always-false
    // (never sheds load) rather than throwing anywhere a caller checks it.
    _histogram = null;
  }
}

/** Test/shutdown helper — stops sampling and resets state. */
export function stopEventLoopPressureMonitor() {
  if (_samplerHandle) { clearInterval(_samplerHandle); _samplerHandle = null; }
  _histogram = null;
  _currentMaxMs = 0;
}

/** Current max observed event-loop delay (ms) over the last sample window. */
export function getCurrentLagMs() {
  return _currentMaxMs;
}

/**
 * Is the event loop currently under enough pressure that genuinely
 * deferrable background work should back off THIS pass? Threshold is
 * intentionally well below the 1000ms "is the site frozen?" log-alert
 * threshold in server.js — this is meant to trip BEFORE things get that
 * bad, since its whole purpose is prevention, not post-mortem logging.
 */
export function isUnderPressure() {
  return _currentMaxMs > LAG_PRESSURE_THRESHOLD_MS;
}

/** Test-only: directly set the current reading without a real sampler. */
export function _setLagMsForTest(ms) {
  _currentMaxMs = ms;
}
