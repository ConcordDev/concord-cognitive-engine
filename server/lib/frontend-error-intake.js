// server/lib/frontend-error-intake.js
//
// POST /api/repair/frontend-error intake. Route error boundaries report here.
// The body is untrusted: scrub secrets and PII before ERROR_CONTEXT.capture,
// which is what feeds repair-cortex observe(). A process-wide window cap
// keeps a render storm from filling the accumulator. Per-IP limiting is the
// route's write.frontend-error bucket. Never throws.

import { ERROR_CONTEXT, REPAIR_QUEUE } from "../emergent/repair-cortex.js";

export const FRONTEND_ERROR_WINDOW_MS = 60_000;
export const FRONTEND_ERROR_GLOBAL_MAX = 240;

const REDACTED = "[redacted]";

/** @type {number[]} */
const _hits = [];

export function _resetFrontendErrorIntakeForTest() {
  _hits.length = 0;
}

/**
 * Drop tokens, emails, home directories, and secret query values.
 * @param {unknown} value
 * @param {number} [max]
 */
export function scrubFrontendErrorText(value, max = 500) {
  const cap = Math.max(0, Number(max) || 0);
  let s = String(value ?? "");
  if (s.length > Math.max(cap * 8, 4096)) s = s.slice(0, Math.max(cap * 8, 4096));
  const rules = [
    [/Bearer\s+[A-Za-z0-9\-._~+/]{8,}=*/gi, REDACTED],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],
    [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, REDACTED],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED],
    [/((?:access_token|refresh_token|api[_-]?key|private[_-]?key|password|passwd|secret|authorization|session|cookie|jwt|token|auth)\s*[=:]\s*)[^\s&#]+/gi, `$1${REDACTED}`],
    [/\/(?:Users|home)\/[^/\s]+/g, "/[user]"],
    [/[A-Za-z]:\\Users\\[^\\\s]+/g, "[user]"],
    [/\b[a-f0-9]{64,}\b/gi, REDACTED],
  ];
  for (const [re, to] of rules) s = s.replace(re, to);
  return s.slice(0, cap);
}

function cleanLens(value) {
  const s = scrubFrontendErrorText(value, 80);
  return /^[A-Za-z0-9_.:/-]{1,80}$/.test(s) ? s : "unknown";
}

function cleanDigest(value) {
  const s = scrubFrontendErrorText(value, 64);
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : "";
}

function cleanRoute(value) {
  let s = String(value ?? "").trim();
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  if (s.includes("://")) {
    try { s = new URL(s).pathname || ""; }
    catch { s = ""; }
  }
  return scrubFrontendErrorText(s, 200);
}

function allow(now) {
  const cutoff = now - FRONTEND_ERROR_WINDOW_MS;
  let drop = 0;
  while (drop < _hits.length && _hits[drop] <= cutoff) drop += 1;
  if (drop) _hits.splice(0, drop);
  if (_hits.length >= FRONTEND_ERROR_GLOBAL_MAX) return false;
  _hits.push(now);
  return true;
}

function sanitize(body) {
  const b = body && typeof body === "object" ? body : {};
  const err = b.error && typeof b.error === "object" ? b.error : {};
  const message = scrubFrontendErrorText(err.message || b.message || "Frontend error", 500) || "Frontend error";
  const stack = scrubFrontendErrorText(err.stack || "", 1000);
  const name = scrubFrontendErrorText(err.name || "Error", 80) || "Error";
  const digest = cleanDigest(err.digest || b.digest || "");
  const componentStack = scrubFrontendErrorText(b.componentStack || "", 500);
  const lens = cleanLens(b.lens);
  const route = cleanRoute(b.route || b.url || "");
  return { message, stack, name, digest, componentStack, lens, route };
}

function summaryOf(cleaned) {
  const tail = [cleaned.digest ? `digest=${cleaned.digest}` : "", cleaned.route || ""].filter(Boolean).join(" | ");
  if (!tail) return cleaned.message.slice(0, 500);
  const room = Math.max(0, 500 - tail.length - 3);
  return `${cleaned.message.slice(0, room)} | ${tail}`;
}

/**
 * @param {object} body
 * @param {{ now?: () => number, capture?: Function, push?: Function }} [deps]
 * @returns {{ ok: boolean, limited?: boolean, errorId: string | null }}
 */
export function ingestFrontendError(body, deps = {}) {
  try {
    const now = typeof deps.now === "function" ? deps.now() : Date.now();
    if (!allow(now)) return { ok: false, limited: true, errorId: null };

    const cleaned = sanitize(body);
    const err = new Error(summaryOf(cleaned));
    err.name = cleaned.name;
    if (cleaned.stack) err.stack = cleaned.stack;

    const capture = deps.capture || ((error, context) => ERROR_CONTEXT.capture(error, context));
    const push = deps.push || ((entry) => { REPAIR_QUEUE.push(entry); });
    const entry = capture(err, {
      module: `frontend:${cleaned.lens}`,
      function: cleaned.route || cleaned.lens || "unknown",
      trigger: "frontend_render",
      params: {
        componentStack: cleaned.componentStack,
        digest: cleaned.digest,
        route: cleaned.route,
      },
    });
    try { push(entry); } catch { /* queue is best-effort */ }
    return { ok: true, errorId: entry?.id || null };
  } catch {
    return { ok: false, errorId: null };
  }
}

export default ingestFrontendError;
