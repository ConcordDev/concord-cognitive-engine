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
