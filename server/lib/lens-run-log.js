// One structured line per non-ok (or slow) POST /api/lens/run outcome, so a walker or member failure names the
// domain and action. The access log only has the path, and most lens failures are HTTP 200 + ok:false
// (unknown_macro, brain_catchall_timeout, handler refusals), invisible there.
//
// Privacy by construction: every field is a short token or a number. Nothing from the request input, nothing
// from the result payload, and free-text error messages are NEVER logged (they can carry emails, names or
// user input): only a constant-looking code/reason is kept, anything else collapses to "error_text".
// Repeats of the same (user, domain, action, status, code) are rate-limited so one polling page cannot spam
// the log; the next emitted line carries `suppressed`.

const TOKEN_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A short identifier-looking value, or `fallback`. */
export function safeToken(v, fallback = null) {
  if (typeof v !== "string") return fallback;
  return TOKEN_RE.test(v) ? v : fallback;
}

/** The first of code / reason / error that is a constant-looking token; free text becomes a constant. */
export function lensErrorCode({ error, reason, code } = {}) {
  for (const v of [code, reason, error]) {
    const t = safeToken(v);
    if (t) return t;
  }
  if (typeof error === "string" && error.toLowerCase().startsWith("forbidden")) return "forbidden";
  return error || reason ? "error_text" : null;
}

/**
 * @param {{ log: (level: string, event: string, data: object) => void, windowMs?: number, maxKeys?: number,
 *           slowMs?: number, now?: () => number }} opts
 */
export function createLensRunLogger({ log, windowMs = 30_000, maxKeys = 500, slowMs = 2000, now = Date.now } = {}) {
  const seen = new Map(); // key -> { at, suppressed }

  /** @returns {boolean} true when a line was written */
  function record(e = {}) {
    const httpStatus = Number(e.httpStatus) || 0;
    const durationMs = Math.max(0, Math.round(Number(e.durationMs) || 0));
    const failed = e.ok === false || httpStatus >= 400;
    const slow = durationMs > slowMs;
    if (!failed && !slow) return false;

    const domain = safeToken(e.domain, e.domain ? "invalid" : null);
    const action = safeToken(e.action, e.action ? "invalid" : null);
    const error = failed ? lensErrorCode(e) : null;
    const userId = safeToken(e.userId, "anon");

    const key = `${userId}|${domain}|${action}|${httpStatus}|${error}|${failed ? "f" : "s"}`;
    const t = now();
    const prev = seen.get(key);
    if (prev && t - prev.at < windowMs) {
      prev.suppressed++;
      return false;
    }
    const suppressed = prev?.suppressed || 0;
    seen.delete(key); // re-insert so Map order is by last emit
    seen.set(key, { at: t, suppressed: 0 });
    while (seen.size > maxKeys) seen.delete(seen.keys().next().value);

    const line = {
      domain,
      action,
      httpStatus,
      ok: !failed,
      error,
      via: safeToken(e.via, null),
      durationMs,
      requestId: safeToken(e.requestId, null),
      userId,
    };
    if (suppressed) line.suppressed = suppressed;
    try { log(failed ? "warn" : "info", "lens_run_result", line); } catch { /* logging must never break a request */ }
    return true;
  }

  return { record };
}
