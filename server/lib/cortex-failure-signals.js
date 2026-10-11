/**
 * Failure signals for the repair cortex.
 *
 * Production 500s, 403/422/429 bursts, uncaught macro throws, and
 * error/fatal logs call observe() with a route template (or macro name),
 * an error class/message, and a stack fingerprint. Observations never
 * include request bodies, cookies, query strings, or raw ids. The module
 * keeps only bounded in-memory counters — no per-request DB writes — and
 * every public function swallows its own failures.
 */

import crypto from "crypto";
import { observe } from "../emergent/repair-cortex.js";
import { recordPain, PAIN_TYPES } from "../emergent/avoidance-learning.js";
import { setErrorLogObserver } from "../logger.js";
import { LruMap } from "./lru-map.js";

const BURST_WINDOW_MS = 60_000;
/** N identical 403/422/429 responses on one route template inside the window. */
const BURST_THRESHOLD = 10;
const BURST_MAX_KEYS = 256;
const CLAIM_MAX = 2_000;
const MACRO_THROW_SEVERITY = 0.5;
const BURST_STATUSES = new Set([403, 422, 429]);

// These logs describe an HTTP status the handlers / response path already
// report. Forwarding them again would double-count the same response.
const HTTP_STATUS_LOG_EVENTS = new Set([
  "http_request",
  "request_error",
  "unhandled_route_error",
  "http_500_response",
]);

const _bursts = new LruMap(BURST_MAX_KEYS);
const _claimedIds = new LruMap(CLAIM_MAX);
const _claimedReq = new WeakSet();

let _observeImpl = observe;
let _recordPainImpl = recordPain;
let _inForward = false;
let _observeCalls = 0;

function clip(value, max = 300) {
  let s = String(value ?? "");
  s = s.replace(/[\r\n]+/g, " ");
  s = s.replace(/\b(cookie|authorization|password|passwd|token|secret)\b\s*[:=]\s*\S+/gi, "$1=[redacted]");
  s = s.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted]");
  s = s.replace(/\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)/gi, "[redacted]");
  if (s.length > max) s = s.slice(0, max);
  return s;
}

function isIdSegment(seg) {
  if (!seg || seg.startsWith(":")) return false;
  if (/^\d+$/.test(seg)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  if (/^[0-9a-f]{16,}$/i.test(seg)) return true;
  if (/^[A-Za-z]+_[A-Za-z0-9]{8,}$/.test(seg)) return true;
  if (seg.length >= 24) return true;
  return false;
}

function templatize(raw) {
  const pathOnly = String(raw || "").split("?")[0].split("#")[0];
  if (!pathOnly.startsWith("/")) return "unknown";
  return pathOnly.split("/").map((seg) => (isIdSegment(seg) ? ":id" : seg)).join("/") || "/";
}

/**
 * Express route template (`/api/members/:id`), never a raw URL.
 * Query strings are dropped. Without a matched route, id-shaped
 * segments in the path are replaced.
 */
export function routeTemplate(req) {
  if (!req || typeof req !== "object") return "unknown";
  const routePath = req.route?.path;
  if (typeof routePath === "string" && routePath) {
    const base = typeof req.baseUrl === "string" ? req.baseUrl : "";
    return templatize(`${base}${routePath.split("?")[0]}`);
  }
  if (typeof req.path === "string" && req.path) return templatize(req.path);
  return "unknown";
}

function stackFrames(err) {
  const stack = String(err?.stack || "");
  const frames = [];
  const re = /([^/\\()\s]+?:\d+:\d+)/g;
  let match;
  while ((match = re.exec(stack)) && frames.length < 4) {
    frames.push(match[1]);
  }
  return frames.join("\n");
}

/** Stable short fingerprint of error class, message, and file:line frames. */
export function errorFingerprint(err, extra = "") {
  const name = String(err?.name || "Error");
  const message = clip(err?.message || err || "", 200);
  const basis = `${name}\n${message}\n${stackFrames(err)}\n${extra}`;
  return crypto.createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

function observationError(summary, fingerprint) {
  const err = new Error(clip(summary, 400));
  err.name = "CortexSignal";
  err.stack = String(fingerprint || "");
  return err;
}

function safeObserve(err, context) {
  _observeCalls += 1;
  try {
    _observeImpl(err, context);
  } catch {
    // The cortex must never break the request that reported the failure.
  }
}

function claim(req) {
  if (req && typeof req === "object" && _claimedReq.has(req)) return false;
  const id = req && typeof req.id === "string" && req.id ? req.id : null;
  if (id && _claimedIds.has(id)) return false;
  if (req && typeof req === "object") {
    try { _claimedReq.add(req); } catch { /* frozen req */ }
  }
  if (id) _claimedIds.set(id, Date.now());
  return true;
}

function noteBurst(route, status, err) {
  const now = Date.now();
  const key = `${status} ${route}`;
  const prev = _bursts.get(key) || { hits: [], emittedAt: 0 };
  const cutoff = now - BURST_WINDOW_MS;
  const hits = prev.hits.filter((t) => t >= cutoff);
  hits.push(now);
  if (hits.length > BURST_THRESHOLD) hits.splice(0, hits.length - BURST_THRESHOLD);
  const slot = { hits, emittedAt: prev.emittedAt };
  if (hits.length >= BURST_THRESHOLD && now - slot.emittedAt >= BURST_WINDOW_MS) {
    slot.emittedAt = now;
    const fp = errorFingerprint(err, `${status}:${route}`);
    safeObserve(
      observationError(`burst ${status} x${hits.length} ${route} fp=${fp}`, fp),
      `http_burst_${status}:${route}`,
    );
  }
  _bursts.set(key, slot);
}

/**
 * One observation per 5xx response. 403/422/429 increment a per-route
 * sliding window and emit a single burst observation at the threshold.
 * A second call for the same request (handler + access log) is a no-op.
 */
export function reportHttpFailure(req, err, status) {
  try {
    const code = Number(status) || 0;
    const route = routeTemplate(req);
    if (code >= 500) {
      if (!claim(req)) return;
      const fp = errorFingerprint(err, `${code}:${route}`);
      const errorClass = err?.name || "Error";
      const message = clip(err?.message || err || "http_error");
      safeObserve(
        observationError(`${code} ${route} ${errorClass}: ${message} fp=${fp}`, fp),
        `http_${code}:${route}`,
      );
      return;
    }
    if (BURST_STATUSES.has(code)) {
      if (!claim(req)) return;
      noteBurst(route, code, err);
    }
  } catch {
    // Never break the response.
  }
}

/**
 * Uncaught macro handler failure: observe the macro, then record pain
 * with avoidance-learning's (entityId, type, severity, source, context) shape.
 * @returns {{ ok: boolean, painId?: string, severity?: number, error?: string }}
 */
export function reportMacroUncaughtThrow(macroErr, domain, name) {
  const d = String(domain || "unknown");
  const n = String(name || "unknown");
  const errorClass = macroErr?.name || "Error";
  const message = clip(macroErr?.message || macroErr || "macro_uncaught_throw");
  const fp = errorFingerprint(macroErr, `${d}.${n}`);
  try {
    safeObserve(
      observationError(`${d}.${n} ${errorClass}: ${message} fp=${fp}`, fp),
      `macro_uncaught_throw:${d}.${n}`,
    );
  } catch { /* observe already swallows */ }
  try {
    return _recordPainImpl(
      `macro:${d}.${n}`,
      PAIN_TYPES.ORGAN_DAMAGE,
      MACRO_THROW_SEVERITY,
      `${d}.${n}`,
      {
        domain: d,
        name: n,
        errorClass,
        message,
        fingerprint: fp,
      },
    );
  } catch {
    return { ok: false, error: "record_pain_failed" };
  }
}

/**
 * Body of runMacro's handler-throw catch. Preserves the public envelope.
 */
export function handleMacroHandlerThrow(macroErr, domain, name, log) {
  try { reportMacroUncaughtThrow(macroErr, domain, name); }
  catch { /* cortex must never change the macro envelope */ }
  const message = String(macroErr?.message || macroErr);
  if (typeof log === "function") {
    log("warn", "macro_uncaught_throw", { domain, name, error: message });
  }
  return {
    ok: false,
    error: "macro_uncaught_throw",
    message,
    domain,
    name,
  };
}

function templateFromLog(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.path === "string") return templatize(data.path);
  return "";
}

/**
 * Forward an error/fatal structured log to observe(). HTTP status logs are
 * skipped (reportHttpFailure owns those). Re-entrant calls from observe()
 * itself return immediately.
 */
export function noteStructuredLog(level, event, data) {
  try {
    if (level !== "error" && level !== "fatal") return;
    if (_inForward) return;
    if (HTTP_STATUS_LOG_EVENTS.has(event)) return;
    const requestId = data && typeof data.requestId === "string" ? data.requestId : null;
    if (requestId && _claimedIds.has(requestId)) return;
    _inForward = true;
    try {
      if (requestId) _claimedIds.set(requestId, Date.now());
      const route = templateFromLog(data);
      const message = clip(data?.error || data?.message || data?.reason || event);
      const fp = errorFingerprint(
        { name: "LogError", message, stack: typeof data?.stack === "string" ? data.stack : "" },
        `${level}:${event}`,
      );
      const where = route && route !== "unknown" ? ` ${route}` : "";
      safeObserve(
        observationError(`${level} ${clip(event, 80)}${where} ${message} fp=${fp}`, fp),
        `log:${level}:${clip(event, 80)}`,
      );
    } finally {
      _inForward = false;
    }
  } catch {
    _inForward = false;
  }
}

export function bindLoggerToCortex() {
  setErrorLogObserver((level, _source, message, meta) => {
    let errText = message;
    if (meta && typeof meta === "object" && typeof meta.error === "string") errText = meta.error;
    noteStructuredLog(level, message, { error: errText });
  });
}

export function resetFailureSignalsForTests() {
  _bursts.clear();
  _claimedIds.clear();
  _observeCalls = 0;
  _observeImpl = observe;
  _recordPainImpl = recordPain;
  _inForward = false;
  bindLoggerToCortex();
}

export function failureSignalStats() {
  return { burstKeys: _bursts.size, claimedIds: _claimedIds.size, observeCalls: _observeCalls };
}

/** @param {Function|null} fn */
export function _setObserveForTests(fn) {
  _observeImpl = typeof fn === "function" ? fn : observe;
}

/** @param {Function|null} fn */
export function _setRecordPainForTests(fn) {
  _recordPainImpl = typeof fn === "function" ? fn : recordPain;
}

bindLoggerToCortex();
