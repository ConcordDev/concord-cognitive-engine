/**
 * presence-idle.js — "are there real users right now?" signal
 *
 * Sprint 60+ — dynamic subsystem activation. Most "presence" workloads
 * (city broadcasts, NPC ticks, memory pre-emptive GC, world mechanics)
 * are maintenance that only matters when real users are touching the
 * system. With no real users, that work is pure overhead — it consumes
 * CPU/memory/event-loop budget for nothing.
 *
 * Two signals feed the "idle" decision:
 *  1. Authenticated session recency (`authActivityMs`)
 *  2. HTTP/WebSocket traffic in last `trafficActivityMs`
 *
 * The system is considered IDLE when neither signal has fired in the
 * window — i.e. no auth'd user has done anything, AND no real traffic
 * has arrived. Crawlers and probes fire request traffic; we deliberately
 * distinguish them by requiring a `sessionId` cookie / bearer token
 * (i.e. an authenticated or session-bearing request) for HTTP traffic
 * to count toward "active". Anonymous probe traffic does NOT qualify.
 *
 * Subsystems that do periodic heavy work should call
 * `shouldRunHeavyMaintenance()` in their timer bodies; if it returns
 * false, they early-return with no work done. The framework also calls
 * `registerIdleGate(name, fn)` so the diagnostics endpoint can surface
 * which gates are currently active vs skipped — useful for the operator.
 *
 * @see server/server.js — `initPresenceIdle()` wiring
 */
import logger from "../logger.js";
import { LruMap } from "./lru-map.js";
import { shouldPauseHeavyBackground } from "./host-profile.js";

const DEFAULT_AUTH_IDLE_MS    = 5 * 60 * 1000;   // 5 minutes
const DEFAULT_TRAFFIC_IDLE_MS = 2 * 60 * 1000;   // 2 minutes
const DEFAULT_PROBE_IDLE_MS   = 60 * 1000;       // 1 minute of inactivity counts as idle (for traffic)

let _authActivity   = 0;          // last authenticated timestamp
let _trafficActivity = 0;         // last real (session-bearing) traffic timestamp
let _lastRequest    = 0;          // any HTTP request (incl. anonymous)
const _gates        = new LruMap(256);  // name -> fn(): bool (true = active). Bounded to prevent unbounded growth under churn.

// Configurable via env
const AUTH_IDLE_MS    = Number(process.env.CONCORD_IDLE_AUTH_MS    || DEFAULT_AUTH_IDLE_MS);
const TRAFFIC_IDLE_MS = Number(process.env.CONCORD_IDLE_TRAFFIC_MS || DEFAULT_TRAFFIC_IDLE_MS);
const PROBE_IDLE_MS   = Number(process.env.CONCORD_IDLE_PROBE_MS   || DEFAULT_PROBE_IDLE_MS);
const _disabled = process.env.CONCORD_IDLE_DISABLED === "1";

/**
 * Mark activity. Called from middleware / websocket handlers.
 * @param {{ authed?: boolean }} opts — authed means real authenticated user.
 */
export function markActivity({ authed = false } = {}) {
  const now = Date.now();
  _lastRequest = now;
  if (authed) {
    _authActivity = now;
    _trafficActivity = now;
  }
}

/**
 * Is the system IDLE (no real users recently)?
 *
 * IDLE = no auth'd user activity in AUTH_IDLE_MS
 *     AND no real (session-bearing) traffic in TRAFFIC_IDLE_MS
 *
 * Anonymous probes do NOT extend the idle window — they're treated as
 * health checks, not user traffic.
 *
 * @returns {boolean} true if no real users
 */
export function isIdle() {
  if (_disabled) return false;
  const now = Date.now();
  const authRecent   = (now - _authActivity)   < AUTH_IDLE_MS;
  const trafficRecent = (now - _trafficActivity) < TRAFFIC_IDLE_MS;
  return !(authRecent || trafficRecent);
}

/**
 * Should heavy maintenance run? Returns false during idle.
 * Convenience wrapper that subsystems call directly.
 *
 * @returns {boolean} true if work should proceed.
 */
export function shouldRunHeavyMaintenance() {
  // Low-memory hosts pause the same work idle does: city presence, feed
  // polls, embed backfill. Interactive requests are unaffected.
  if (shouldPauseHeavyBackground()) return false;
  return !isIdle();
}

/**
 * Time since last authenticated activity, in ms.
 * Useful for ops dashboards.
 *
 * @returns {number} ms since last auth activity (Infinity if never)
 */
export function timeSinceLastAuth() {
  if (_authActivity === 0) return Infinity;
  return Date.now() - _authActivity;
}

/**
 * Time since last real traffic, in ms.
 *
 * @returns {number} ms since last real traffic (Infinity if never)
 */
export function timeSinceLastTraffic() {
  if (_trafficActivity === 0) return Infinity;
  return Date.now() - _trafficActivity;
}

/**
 * Active gates — which subsystems have registered idle-conditional work.
 * Each gate exposes a function that returns true when it's running.
 *
 * @returns {Record<string, boolean>} map of gate name → currently-active
 */
export function listGates() {
  const out = {};
  for (const [name, fn] of _gates.entries()) {
    try {
      out[name] = !!fn();
    } catch (e) {
      out[name] = `error: ${e?.message || e}`;
    }
  }
  return out;
}

/**
 * Register a gate. `fn` returns true if currently active.
 * Used by subsystem to declare its idle-conditional behavior.
 *
 * @param {string} name — gate name (must be unique)
 * @param {() => boolean} fn — returns true when active
 */
export function registerIdleGate(name, fn) {
  if (_gates.has(name)) {
    logger.warn?.("presence-idle", `gate '${name}' already registered — overwriting`);
  }
  _gates.set(name, fn);
}

/**
 * Force the system into "active" mode (overriding idle detection).
 * Used by scheduled maintenance jobs that need to run regardless.
 */
export function forceActive() {
  _authActivity = Date.now();
  _trafficActivity = _authActivity;
}

export const _internals = {
  AUTH_IDLE_MS,
  TRAFFIC_IDLE_MS,
  PROBE_IDLE_MS,
  disabled: _disabled,
};


// Sprint 60+ — lag probe helpers. Each gated subsystem sets a "last
// fired" timestamp; the lag detector's structured log includes the
// subsystem that most recently touched state. This is opt-in: a subsystem
// registers a probe with registerLagProbe(name, fn) and the detector
// reads them at log time.
const _lagProbes = new LruMap(512);  // Bounded to prevent unbounded growth.

/**
 * Register a probe — `fn` returns a short string describing what
 * this subsystem was doing most recently. Called when the lag detector
 * is logging a spike so the log line carries a culprit name.
 */
export function registerLagProbe(name, fn) {
  _lagProbes.set(name, fn);
}

/**
 * Get the most recently fired probe (by timestamp). Used by the lag
 * detector at log time. Returns a short string like "city_presence_flush"
 * or "unknown".
 */
export function getLatestLagProbe() {
  let latest = { name: "unknown", ts: 0 };
  for (const [name, fn] of _lagProbes.entries()) {
    try {
      const r = fn();
      if (r && r.ts > latest.ts) latest = { name, ts: r.ts, ...r };
    } catch (_e) { /* probe must not throw */ }
  }
  return latest.name;
}

/**
 * Mark a subsystem as "just ran" so the lag detector can attribute
 * spikes to it. `name` is the subsystem name (matches registerIdleGate).
 */
export function markLagProbe(name) {
  globalThis.__lastLagProbeTs = Date.now();
  globalThis.__lastLagProbeName = name;
}

// INC-100 — real lag attribution.
//
// "Last timer that fired" is the wrong culprit: the 100ms presence timer
// fires ~50x per 5s window, so it was blamed for every stall even when it
// returned at its idle gate in microseconds (and the 30s detector stamped
// itself just before reading, so it always blamed "lag_detector"). Instead,
// instrumented subsystems record how long their synchronous work actually
// ran (recordLagWork / timeLagWork), HTTP requests record their wall span
// (recordLagHttp), and getLagCulprit() picks the longest synchronous run that
// ended inside the stall window. If nothing instrumented ran long enough to
// explain the stall, the culprit is "unattributed" and the overlapping
// requests are listed as candidates (a sync better-sqlite3 scan inside a
// request handler shows up there).
const _LAG_RING = 128;
const _lagWork = [];   // { name, ms, end }
const _lagHttp = [];   // { name, start, end }
const _push = (arr, e) => { arr.push(e); if (arr.length > _LAG_RING) arr.shift(); };

/** Record that `name` ran synchronously for `ms` (ending now). Sub-5ms runs are ignored. */
export function recordLagWork(name, ms, end = Date.now()) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 5) return;
  _push(_lagWork, { name: String(name || "unknown"), ms: Math.round(v), end });
}

/** Run `fn` synchronously and record its duration under `name`. Returns fn's result. */
export function timeLagWork(name, fn) {
  const t0 = performance.now();
  try { return fn(); } finally { recordLagWork(name, performance.now() - t0); }
}

/** Record one HTTP request's wall-clock span (start/end ms epoch). */
export function recordLagHttp(name, start, end = Date.now()) {
  if (!Number.isFinite(start) || end - start < 50) return;
  _push(_lagHttp, { name: String(name || "?").slice(0, 96), start, end });
}

/**
 * Attribute a stall of `stallMs` observed in the last `windowMs`.
 * @returns {{ culprit: string, culpritMs: number|null, candidates: string[] }}
 */
export function getLagCulprit({ windowMs = 5000, stallMs = 0, now = Date.now() } = {}) {
  const since = now - windowMs - Math.max(0, stallMs);
  let best = null;
  for (const w of _lagWork) {
    if (w.end < since) continue;
    if (!best || w.ms > best.ms) best = w;
  }
  // A run explains the stall only if it is a meaningful share of it.
  const floor = Math.max(50, Math.min(stallMs * 0.25, 1000));
  const culprit = best && best.ms >= floor ? best.name : "unattributed";
  const candidates = _lagHttp
    .filter((h) => h.end >= since)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start))
    .slice(0, 3)
    .map((h) => `${h.name} (${h.end - h.start}ms)`);
  return { culprit, culpritMs: best ? best.ms : null, candidates };
}

/** Test-only. */
export function _resetLagAttributionForTest() { _lagWork.length = 0; _lagHttp.length = 0; }


/**
 * Wrap a function so it both runs and records it as the most recent
 * "lag probe" candidate. Use this to instrument setInterval callbacks
 * globally — any subsystem using wrappedSetInterval(fn, ms) is
 * automatically tagged in lag spikes.
 */
export function wrappedSetInterval(fn, ms, name) {
  const tagged = async (...args) => {
    markLagProbe(name || "unknown");
    return fn(...args);
  };
  /* @drift-ok: intentional design — caller owns lifecycle and clears via the returned handle */
  return setInterval(tagged, ms);
}
