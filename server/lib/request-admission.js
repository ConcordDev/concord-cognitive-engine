// server/lib/request-admission.js
//
// Front-door admission control keyed on real event-loop lag (Launch
// Readiness — bare-metal single-process deploy audit, 2026-07-25).
//
// The measured problem: with `instances: 1, exec_mode: 'fork'`, ONE Node
// process serves every HTTP + WebSocket request, and better-sqlite3 is
// synchronous/in-process (no libuv threadpool escape). Under 44 concurrent
// requests the LAST one measured ~8.5s wall-clock while no single request
// took longer than 1.3s — that is queueing on one thread, not slow
// endpoints. Once the loop is genuinely saturated, every request in flight
// degrades together. This module refuses NEW low-value work at the door so
// the requests already worth serving keep their real latency instead of
// queueing behind an unbounded pile-up — shedding PRESERVES performance for
// the traffic that matters, it does not sacrifice it.
//
// Deliberately built on top of the EXISTING event-loop-lag instrumentation
// rather than a new measurement:
//   - `getCurrentLagMs()` from ./event-loop-pressure.js (already samples
//     `perf_hooks.monitorEventLoopDelay` every `CONCORD_EVENT_LOOP_SAMPLE_MS`
//     and already gates `lowPriority` heartbeat backoff in
//     emergent/heartbeat-registry.js).
//   - The 300ms default here matches `CONCORD_EVENT_LOOP_PRESSURE_MS`'s own
//     default and the `ConcordEventLoopUnderPressure` alert threshold in
//     monitoring/prometheus/alerts.yml (lag > 300ms for 2m) — the same
//     "genuinely stressed, not just a single GC pause" bar already
//     established elsewhere, not a new number invented for this module.
//
// Priority classes (front-door admission only — an in-flight request is
// NEVER shed):
//   CRITICAL  — /health, /ready, /metrics, /api/health*, /api/status,
//               /api/brain/health. NEVER evaluated against lag, ever. If
//               pm2/Cloudflare/an orchestrator's liveness probe gets shed,
//               a brownout reads as a dead box and a recoverable slowdown
//               becomes an outage — worse than doing nothing.
//   PROTECTED — an authenticated request (`req.user?.id` truthy, set by
//               authMiddleware upstream) that isn't bulk-shaped, OR one of
//               the small set of auth-critical endpoints a user hits
//               BEFORE they have a session (login/register/refresh/
//               csrf-token). Those are unauthenticated by definition — the
//               plain authed-check would otherwise put them at the same
//               tight 300ms bar as anonymous bulk traffic, which is wrong:
//               a random "signup failed" reads as "the site is broken" to
//               a new user, not as a polite ask to retry, even with a
//               correct Retry-After header. Real production symptom fixed
//               2026-08-23: live login/register 503s traced to exactly
//               this misclassification. This is the in-flight-session
//               traffic (plus its on-ramp) the whole exercise exists to
//               protect. Only sheds once lag is well past the point where
//               shedding SHEDDABLE traffic alone hasn't been enough.
//   SHEDDABLE — everything else: unauthenticated/new-session traffic, and
//               any request (authenticated or not) whose path looks like
//               bulk I/O (export/import/bulk/download) — exactly the class
//               of request an operator would rather see retry with backoff
//               than let it hold a lock/queue slot other users are waiting
//               behind. Sheds first, at the lower threshold.
//
// Honesty invariant: a shed request gets a REAL 503 + a REAL Retry-After
// computed from the actual lag reading — never a fabricated empty success.

import { getCurrentLagMs } from "./event-loop-pressure.js";

export const PRIORITY = Object.freeze({
  CRITICAL: "critical",
  PROTECTED: "protected",
  SHEDDABLE: "sheddable",
});

// Mirrors server.js's `_HEALTH_PROBE_RE` exactly. Kept as a separate literal
// (rather than importing from server.js) so this module stays unit-testable
// without booting the whole monolith — if you touch one, touch the other.
const _CRITICAL_PATH_RE = /^\/(health|ready|metrics)(\b|\/)|^\/api\/(health|status|brain\/health)(\b|\/)/;

// "Obviously bulk" traffic — export/import/bulk/download-shaped paths.
// Matches the existing route shapes (`/api/export/my-data`,
// `/api/ingest/bulk-upload`, `/api/substrate/export`, `/api/*/bulk`,
// `/api/artifact/:id/download`, etc.) without needing an exhaustive
// allowlist of every such route.
const _BULK_PATH_RE = /\/(bulk|export|import|download)(\b|[-/])/i;

// Auth-critical endpoints a user necessarily hits with NO session yet.
// Mirrors the write-auth-public-paths ratchet's own EXPECTED entries for
// these four routes (server/tests/invariants/write-auth-public-paths.test.js)
// — same set, different reason (that test pins they're allowed to run
// unauthenticated at all; this one pins they don't get shed like bulk
// traffic while doing so). csrf-token is included because it's a hard
// prerequisite fetch before login/register can even be attempted — shedding
// it blocks the flow just as effectively as shedding login itself.
const _AUTH_CRITICAL_PATH_RE = /^\/api\/auth\/(login|register|refresh|csrf-token)(\b|\/)/;

function _isKillSwitchOff(enabledOverride) {
  if (enabledOverride !== undefined) return !enabledOverride;
  return process.env.CONCORD_LOAD_SHED_ENABLED === "0";
}

/** Lag (ms) above which SHEDDABLE traffic starts getting 503'd. */
export function getShedLagMs() {
  return Number(process.env.CONCORD_LOAD_SHED_LAG_MS) || 300;
}

/**
 * Lag (ms) above which even PROTECTED (authenticated, non-bulk) traffic
 * starts getting 503'd — a materially higher bar than `getShedLagMs()`
 * (default 3x) so authenticated sessions aren't shed at the first sign of
 * pressure, only once shedding SHEDDABLE traffic alone hasn't relieved it.
 */
export function getShedLagMsProtected() {
  return Number(process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED) || 900;
}

/** Retry-After seconds sent on a shed response. */
export function getRetryAfterSeconds() {
  return Number(process.env.CONCORD_LOAD_SHED_RETRY_AFTER_S) || 2;
}

/**
 * Classify a request into a priority class. Pure function of the request
 * shape — no I/O, safe to call on every request.
 *
 * @param {{ path?: string, url?: string, user?: { id?: string } }} req
 * @returns {"critical"|"protected"|"sheddable"}
 */
export function classifyRequest(req) {
  const path = req?.path || req?.url || "";
  if (_CRITICAL_PATH_RE.test(path)) return PRIORITY.CRITICAL;
  if (_AUTH_CRITICAL_PATH_RE.test(path)) return PRIORITY.PROTECTED;
  const authed = !!(req?.user?.id);
  if (authed && !_BULK_PATH_RE.test(path)) return PRIORITY.PROTECTED;
  return PRIORITY.SHEDDABLE;
}

/**
 * Decide whether to admit a request of a given priority class at a given
 * observed lag reading. Pure function — no I/O, no env reads if opts is
 * fully supplied — so it's trivial to unit-test and mutation-verify.
 *
 * @param {"critical"|"protected"|"sheddable"} priority
 * @param {number} lagMs
 * @param {{ enabled?: boolean, shedLagMs?: number, shedLagMsProtected?: number }} [opts]
 * @returns {{ admit: boolean, reason?: string, lagMs?: number, thresholdMs?: number }}
 */
export function decideAdmission(priority, lagMs, opts = {}) {
  if (_isKillSwitchOff(opts.enabled)) return { admit: true };
  if (priority === PRIORITY.CRITICAL) return { admit: true };

  const shedLagMs = opts.shedLagMs ?? getShedLagMs();
  const shedLagMsProtected = opts.shedLagMsProtected ?? getShedLagMsProtected();
  const lag = Number(lagMs) || 0;

  if (priority === PRIORITY.SHEDDABLE && lag > shedLagMs) {
    return { admit: false, reason: "event_loop_lag", lagMs: lag, thresholdMs: shedLagMs };
  }
  if (priority === PRIORITY.PROTECTED && lag > shedLagMsProtected) {
    return { admit: false, reason: "event_loop_lag_critical", lagMs: lag, thresholdMs: shedLagMsProtected };
  }
  return { admit: true };
}

/**
 * Build the Express middleware. Mount AFTER auth (so `req.user` is
 * populated) and BEFORE route handlers — this is front-door admission
 * control only; it never touches an already-admitted, in-flight request.
 *
 * @param {{ getLagMs?: () => number, onShed?: (priority: string, reason: string) => void }} [deps]
 */
export function createLoadSheddingMiddleware(deps = {}) {
  const getLagMs = deps.getLagMs || getCurrentLagMs;
  const onShed = deps.onShed || (() => {});

  return function loadSheddingMiddleware(req, res, next) {
    const priority = classifyRequest(req);
    if (priority === PRIORITY.CRITICAL) return next();

    const lagMs = getLagMs();
    const decision = decideAdmission(priority, lagMs);
    if (decision.admit) return next();

    const retryAfterS = getRetryAfterSeconds();
    try { onShed(priority, decision.reason); } catch { /* observability best-effort */ }

    // Clarity only — does NOT change admit/shed thresholds. Post-restart lag
    // often trips the same path; clients can toast "warming up" instead of
    // treating this like a permission gate or permanent outage.
    const uptimeS = (typeof process !== "undefined" && typeof process.uptime === "function")
      ? process.uptime()
      : null;
    const warming = uptimeS != null && uptimeS < 120;

    res.set("Retry-After", String(retryAfterS));
    return res.status(503).json({
      ok: false,
      error: "service_overloaded",
      code: warming ? "service_warming" : "service_overloaded",
      reason: decision.reason,
      priority,
      lagMs: Math.round(decision.lagMs || 0),
      thresholdMs: decision.thresholdMs,
      retryAfterS,
      warming,
    });
  };
}
