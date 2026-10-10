// server/lib/request-admission.js
//
// Front-door admission control keyed on SUSTAINED event-loop lag.
//
// The measured failure this replaced: `monitorEventLoopDelay().max` is the
// single worst moment in each 2s window. On a swapping host one GC pause
// cleared the 300ms anonymous bar (and often the 900ms authenticated bar)
// and every request — including a logged-in user's POST /api/lens/run —
// came back 503 `service_overloaded` in 1–16ms. /ready already refused to
// flap on that spike (3 consecutive probes). The shedder now uses the same
// idea:
//   - the lag value is the rolling mean of window p99s
//     (`getSustainedLagMs`, CONCORD_EVENT_LOOP_WINDOWS), not the max;
//   - shedding starts only after CONCORD_LOAD_SHED_STRIKES consecutive
//     windows whose latest p99 is over the bar (default 3, same as
//     CONCORD_READY_PRESSURE_STRIKES). A clean window resets the counter.
//
// Priority classes (an in-flight request is NEVER shed):
//   CRITICAL  — /health, /ready, /metrics, /api/health*, /api/status,
//               /api/brain/health. Never evaluated against lag.
//   PROTECTED — authenticated non-bulk traffic, auth-critical pre-session
//               routes, and the public ConKay demo. Higher lag bar.
//   INTERACTIVE — authenticated chat and lens run. Even when the protected
//               bar has been sustained, these are NOT instant-503'd. They
//               wait a short bounded queue (CONCORD_LOAD_SHED_ADMISSION_WAIT_MS).
//               If the loop recovers, they proceed. If it doesn't, the
//               response is 503 `busy_retry` with Retry-After — a clear
//               "busy, retry", not a disconnect.
//   SHEDDABLE — anonymous traffic and bulk I/O. Sheds first, once pressure
//               is sustained, with 503 service_overloaded + Retry-After.
//
// Honesty invariant: a shed request gets a REAL 503 + a REAL Retry-After.
// Never a fabricated empty success.

import { getSustainedLagMs } from "./event-loop-pressure.js";
import { isSqliteBackupRunning } from "./sqlite-online-backup.js";

export const PRIORITY = Object.freeze({
  CRITICAL: "critical",
  PROTECTED: "protected",
  SHEDDABLE: "sheddable",
});

// Mirrors server.js's `_HEALTH_PROBE_RE` exactly. Kept as a separate literal
// so this module stays unit-testable without booting the monolith.
const _CRITICAL_PATH_RE = /^\/(health|ready|metrics)(\b|\/)|^\/api\/(health|status|brain\/health)(\b|\/)/;

const _BULK_PATH_RE = /\/(bulk|export|import|download)(\b|[-/])/i;

const _AUTH_CRITICAL_PATH_RE = /^\/api\/auth\/(login|register|refresh|csrf-token)(\b|\/)/;

const _PUBLIC_DEMO_PATH_RE = /^\/api\/conkay\/demo\/(materials|beam|sweep)(\?|$|\/)/;

// Authenticated interactive work: chat and lens run. Never an instant 503.
const _INTERACTIVE_PATH_RE = /^\/api\/(?:lens\/run|chat-agent(?:\/|$|\?)|chat(?:\/|$|\?))/;

let _sheddableStrikes = 0;
let _protectedStrikes = 0;
let _interactiveWaiters = 0;

function _isKillSwitchOff(enabledOverride) {
  if (enabledOverride !== undefined) return !enabledOverride;
  return process.env.CONCORD_LOAD_SHED_ENABLED === "0";
}

function _positiveNumber(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Lag (ms) above which SHEDDABLE traffic can be shed, once strikes are met. */
export function getShedLagMs() {
  return _positiveNumber(process.env.CONCORD_LOAD_SHED_LAG_MS, 300);
}

/**
 * Lag (ms) above which PROTECTED traffic can be shed. Default 3× the
 * sheddable bar. Interactive chat/lens-run still queue instead of
 * instant-503 at this bar.
 */
export function getShedLagMsProtected() {
  return _positiveNumber(process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED, 900);
}

/** Consecutive over-bar windows required before shedding. Matches /ready's default of 3. */
export function getShedStrikesRequired() {
  return Math.max(1, Math.floor(_positiveNumber(process.env.CONCORD_LOAD_SHED_STRIKES, 3)));
}

/** Retry-After seconds sent on a shed or busy response. */
export function getRetryAfterSeconds() {
  return _positiveNumber(process.env.CONCORD_LOAD_SHED_RETRY_AFTER_S, 2);
}

/** How long an interactive request will wait for the loop to recover. */
export function getAdmissionWaitMs() {
  const n = Number(process.env.CONCORD_LOAD_SHED_ADMISSION_WAIT_MS);
  if (Number.isFinite(n) && n >= 0) return n;
  return 1500;
}

function getAdmissionPollMs() {
  return _positiveNumber(process.env.CONCORD_LOAD_SHED_ADMISSION_POLL_MS, 100);
}

function getInteractiveQueueCap() {
  return Math.max(1, Math.floor(_positiveNumber(process.env.CONCORD_LOAD_SHED_INTERACTIVE_QUEUE, 32)));
}

/**
 * One sample window landed. Strikes follow the LATEST window p99 (a clean
 * window resets, same shape as /ready). The sustained mean is what
 * decideAdmission compares to the threshold.
 *
 * @param {number|{ sustainedMs?: number, latestMs?: number }} sample
 * @param {{ shedLagMs?: number, shedLagMsProtected?: number }} [opts]
 */
export function observeLagWindow(sample, opts = {}) {
  const sustainedMs = typeof sample === "number" ? sample : Number(sample?.sustainedMs) || 0;
  const latestMs = typeof sample === "number"
    ? sample
    : Number(sample?.latestMs ?? sample?.sustainedMs) || 0;
  const shed = opts.shedLagMs ?? getShedLagMs();
  const prot = opts.shedLagMsProtected ?? getShedLagMsProtected();
  _sheddableStrikes = latestMs > shed ? _sheddableStrikes + 1 : 0;
  _protectedStrikes = latestMs > prot ? _protectedStrikes + 1 : 0;
  return {
    sustainedMs,
    latestMs,
    sheddable: _sheddableStrikes,
    protected: _protectedStrikes,
  };
}

export function getPressureStrikes() {
  return { sheddable: _sheddableStrikes, protected: _protectedStrikes };
}

export function strikesFor(priority) {
  return priority === PRIORITY.SHEDDABLE ? _sheddableStrikes : _protectedStrikes;
}

/** Test-only. */
export function _resetAdmissionForTest() {
  _sheddableStrikes = 0;
  _protectedStrikes = 0;
  _interactiveWaiters = 0;
}

/** Test-only: force both strike counters. */
export function _setStrikesForTest(n) {
  const v = Math.max(0, Number(n) || 0);
  _sheddableStrikes = v;
  _protectedStrikes = v;
}

/**
 * @param {{ path?: string, url?: string, user?: { id?: string } }} req
 * @returns {"critical"|"protected"|"sheddable"}
 */
export function classifyRequest(req) {
  const path = req?.path || req?.url || "";
  if (_CRITICAL_PATH_RE.test(path)) return PRIORITY.CRITICAL;
  if (_AUTH_CRITICAL_PATH_RE.test(path)) return PRIORITY.PROTECTED;
  if (_PUBLIC_DEMO_PATH_RE.test(path)) return PRIORITY.PROTECTED;
  const authed = !!(req?.user?.id);
  if (authed && !_BULK_PATH_RE.test(path)) return PRIORITY.PROTECTED;
  return PRIORITY.SHEDDABLE;
}

/**
 * Authenticated chat / lens run. These queue instead of instant-503.
 * Bulk-shaped paths stay sheddable even when authenticated.
 */
export function isInteractiveRequest(req) {
  if (!req?.user?.id) return false;
  const path = req?.path || req?.url || "";
  if (_BULK_PATH_RE.test(path)) return false;
  return _INTERACTIVE_PATH_RE.test(path);
}

/**
 * Admit or shed. Pure when opts supplies every input.
 *
 * Shedding requires BOTH the lag reading over the class threshold AND
 * `strikes >= strikesRequired`. Omitting strikes means "not yet sustained"
 * (0), so a bare over-threshold sample does not shed.
 *
 * @param {"critical"|"protected"|"sheddable"} priority
 * @param {number} lagMs sustained lag
 * @param {{ enabled?: boolean, shedLagMs?: number, shedLagMsProtected?: number, strikes?: number, strikesRequired?: number }} [opts]
 */
export function decideAdmission(priority, lagMs, opts = {}) {
  if (_isKillSwitchOff(opts.enabled)) return { admit: true };
  if (priority === PRIORITY.CRITICAL) return { admit: true };

  const shedLagMs = opts.shedLagMs ?? getShedLagMs();
  const shedLagMsProtected = opts.shedLagMsProtected ?? getShedLagMsProtected();
  const strikesRequired = opts.strikesRequired ?? getShedStrikesRequired();
  const strikes = Number.isFinite(Number(opts.strikes)) ? Number(opts.strikes) : 0;
  const lag = Number(lagMs) || 0;
  const sustained = strikes >= strikesRequired;

  if (priority === PRIORITY.SHEDDABLE && lag > shedLagMs && sustained) {
    return { admit: false, reason: "event_loop_lag", lagMs: lag, thresholdMs: shedLagMs, strikes, strikesRequired };
  }
  if (priority === PRIORITY.PROTECTED && lag > shedLagMsProtected && sustained) {
    return { admit: false, reason: "event_loop_lag_critical", lagMs: lag, thresholdMs: shedLagMsProtected, strikes, strikesRequired };
  }
  return { admit: true, lagMs: lag, strikes, strikesRequired };
}

function _warmingFlag() {
  const uptimeS = typeof process.uptime === "function" ? process.uptime() : null;
  return uptimeS != null && uptimeS < 120;
}

function _writeShed(res, { decision, priority, code, message, retryAfterS, queuedMs }) {
  const warming = _warmingFlag();
  res.set("Retry-After", String(retryAfterS));
  return res.status(503).json({
    ok: false,
    error: "service_overloaded",
    code: code || (warming ? "service_warming" : "service_overloaded"),
    message: message || (warming ? "Concord is warming up. Retry shortly." : "Server is busy. Retry shortly."),
    reason: decision.reason,
    priority,
    lagMs: Math.round(decision.lagMs || 0),
    thresholdMs: decision.thresholdMs,
    strikes: decision.strikes,
    strikesRequired: decision.strikesRequired,
    retryAfterS,
    warming: code === "busy_retry" ? false : warming,
    ...(queuedMs != null ? { queuedMs } : {}),
  });
}

function _sleep(ms) {
  // Ref'd on purpose. This timer is the only thing keeping an admitted-wait
  // request alive; unref'ing it lets the loop go idle and the response never
  // lands (node:test reports the promise still pending).
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function _waitForInteractiveAdmission(getLagMs, priority) {
  const waitMs = getAdmissionWaitMs();
  const pollMs = getAdmissionPollMs();
  const started = Date.now();
  const deadline = started + waitMs;
  let decision = decideAdmission(priority, getLagMs(), { strikes: strikesFor(priority) });
  if (decision.admit || waitMs === 0) {
    return { decision, queuedMs: Date.now() - started };
  }
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await _sleep(Math.min(pollMs, Math.max(1, remaining)));
    decision = decideAdmission(priority, getLagMs(), { strikes: strikesFor(priority) });
    if (decision.admit) break;
  }
  return { decision, queuedMs: Date.now() - started };
}

/**
 * @param {{ getLagMs?: () => number, onShed?: (priority: string, reason: string) => void }} [deps]
 */
export function createLoadSheddingMiddleware(deps = {}) {
  const getLagMs = deps.getLagMs || getSustainedLagMs;
  const onShed = deps.onShed || (() => {});

  return function loadSheddingMiddleware(req, res, next) {
    const priority = classifyRequest(req);
    if (priority === PRIORITY.CRITICAL) return next();
    // The post-start SQLite snapshot used to stall the loop for seconds.
    // It now runs off-thread, and while it is in flight authenticated
    // traffic and login stay admitted even if a residual spike is sustained.
    if (priority === PRIORITY.PROTECTED && isSqliteBackupRunning()) return next();

    const lagMs = getLagMs();
    const decision = decideAdmission(priority, lagMs, { strikes: strikesFor(priority) });
    if (decision.admit) return next();

    if (isInteractiveRequest(req)) {
      return _admitInteractiveOrBusy(req, res, next, getLagMs, priority, onShed);
    }

    const retryAfterS = getRetryAfterSeconds();
    try { onShed(priority, decision.reason); } catch { /* observability best-effort */ }
    return _writeShed(res, { decision, priority, retryAfterS });
  };
}

async function _admitInteractiveOrBusy(req, res, next, getLagMs, priority, onShed) {
  const retryAfterS = getRetryAfterSeconds();
  if (_interactiveWaiters >= getInteractiveQueueCap()) {
    const decision = decideAdmission(priority, getLagMs(), { strikes: strikesFor(priority) });
    try { onShed(priority, "interactive_queue_full"); } catch { /* best-effort */ }
    return _writeShed(res, {
      decision: { ...decision, reason: decision.reason || "event_loop_lag_critical" },
      priority,
      code: "busy_retry",
      message: "Server is busy. Retry shortly.",
      retryAfterS,
      queuedMs: 0,
    });
  }

  _interactiveWaiters += 1;
  try {
    const { decision, queuedMs } = await _waitForInteractiveAdmission(getLagMs, priority);
    if (decision.admit) {
      if (!res.headersSent) return next();
      return undefined;
    }
    try { onShed(priority, decision.reason || "event_loop_lag_critical"); } catch { /* best-effort */ }
    if (res.headersSent) return undefined;
    return _writeShed(res, {
      decision,
      priority,
      code: "busy_retry",
      message: "Server is busy. Retry shortly.",
      retryAfterS,
      queuedMs,
    });
  } finally {
    _interactiveWaiters -= 1;
  }
}
