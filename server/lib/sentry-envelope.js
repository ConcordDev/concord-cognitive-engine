// server/lib/sentry-envelope.js
// Pure helpers for the Debug lens's Sentry-compatible ingest (Q1 slice):
// envelope parsing, Sentry event → issue mapping, X-Sentry-Auth parsing,
// and a per-key fixed-window rate limiter. No state, no I/O — the route
// (server/routes/debug-ingest.js) and the domain core
// (server/domains/debug.js) compose these; tests drive them directly.
//
// Envelope format (Sentry protocol): newline-delimited JSON —
//   {"event_id":"…","sent_at":"…"}\n
//   {"type":"event","length":123}\n
//   {…event payload…}\n
//   {"type":"session",…}\n
//   {…}\n
// Only "event" items are ingested; other item types are acknowledged
// and dropped by the caller (stated product behaviour, not a silent gap).

const clean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);

/**
 * Parse an envelope body (Buffer or string) into header + items.
 * Returns { ok: true, header, items: [{ type, itemHeader, payload }] }
 * where payload is the parsed JSON when it parses, else the raw string;
 * or { ok: false, error } naming the defect (the endpoint's 400 body).
 */
export function parseEnvelope(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ""), "utf8");
  if (buf.length === 0) return { ok: false, error: "envelope is empty" };
  let pos = 0;
  const readLine = () => {
    const idx = buf.indexOf(0x0a, pos);
    if (idx === -1) {
      const line = buf.subarray(pos);
      pos = buf.length;
      return line;
    }
    const line = buf.subarray(pos, idx);
    pos = idx + 1;
    return line;
  };
  let header;
  try {
    header = JSON.parse(readLine().toString("utf8"));
  } catch {
    return { ok: false, error: "envelope header is not valid JSON" };
  }
  const items = [];
  while (pos < buf.length) {
    // Tolerate a trailing newline / blank lines between items.
    if (buf[pos] === 0x0a) { pos += 1; continue; }
    let itemHeader;
    try {
      itemHeader = JSON.parse(readLine().toString("utf8"));
    } catch {
      return { ok: false, error: "envelope item header is not valid JSON" };
    }
    if (!itemHeader || typeof itemHeader.type !== "string") {
      return { ok: false, error: "envelope item header has no type" };
    }
    let payloadBuf;
    if (Number.isFinite(itemHeader.length)) {
      const len = Math.max(0, Math.floor(itemHeader.length));
      if (pos + len > buf.length) return { ok: false, error: "envelope item is truncated" };
      payloadBuf = buf.subarray(pos, pos + len);
      pos += len;
      if (buf[pos] === 0x0a) pos += 1; // item-terminating newline
    } else {
      payloadBuf = readLine();
    }
    let payload = payloadBuf.toString("utf8");
    try { payload = JSON.parse(payload); } catch { /* keep raw string */ }
    items.push({ type: itemHeader.type, itemHeader, payload });
  }
  return { ok: true, header, items };
}

const ISSUE_LEVELS = ["error", "warning", "fatal", "info"];
const CRUMB_LEVELS = ["debug", "info", "warning", "error"];

// Sentry frames arrive oldest-first; the crashing frame is last, and an
// in_app frame is the culprit when one exists.
function pickCulpritFrame(frames) {
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i] && frames[i].in_app === true) return frames[i];
  }
  return frames.length ? frames[frames.length - 1] : null;
}

function frameLocation(f) {
  const file = clean(f?.filename || f?.abs_path || "", 200);
  const line = Number.isFinite(f?.lineno) ? `:${f.lineno}` : "";
  const col = Number.isFinite(f?.colno) ? `:${f.colno}` : "";
  return file ? `${file}${line}${col}` : "";
}

function renderStack(type, message, frames) {
  const lines = [`${type}: ${message}`];
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i] || {};
    const fn = clean(f.function || f.module || "", 120) || "<anonymous>";
    const loc = frameLocation(f);
    lines.push(loc ? `  at ${fn} (${loc})` : `  at ${fn}`);
  }
  return lines.join("\n").slice(0, 4000);
}

// Clamp an event's claimed occurrence time to a sane window: a client
// clock may be wrong, but an issue's timeline must not be.
function clampOccurredAt(ts, now = Date.now()) {
  let t = NaN;
  if (typeof ts === "number" && Number.isFinite(ts)) t = ts * 1000; // Sentry: epoch seconds
  else if (typeof ts === "string") t = new Date(ts).getTime();
  if (Number.isNaN(t)) return new Date(now).toISOString();
  if (t > now + 5 * 60_000) t = now;
  if (t < now - 30 * 24 * 3600_000) t = now;
  return new Date(t).toISOString();
}

/**
 * Map a Sentry event payload to the issue fields the Debug domain's
 * ingest core consumes. Returns { ok: true, fields } or
 * { ok: false, error } — the error cases are the endpoint's 400s.
 */
export function mapEventToIssue(event, now = Date.now()) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return { ok: false, error: "event payload is not an object" };
  }
  if (!event.event_id || typeof event.event_id !== "string") {
    return { ok: false, error: "event has no event_id" };
  }
  const values = Array.isArray(event.exception?.values) ? event.exception.values : [];
  const exc = values.length ? values[values.length - 1] : null;
  let type = clean(exc?.type, 80);
  let message = clean(exc?.value, 600);
  if (!message) {
    const msg = event.message;
    if (typeof msg === "string") message = clean(msg, 600);
    else if (msg && typeof msg === "object") message = clean(msg.formatted || msg.message, 600);
    if (!message && event.logentry) {
      message = clean(event.logentry.formatted || event.logentry.message, 600);
    }
  }
  if (!message) {
    return { ok: false, error: "event carries neither an exception nor a message" };
  }
  if (!type) type = clean(event.logger, 80) || "Error";
  const frames = Array.isArray(exc?.stacktrace?.frames) ? exc.stacktrace.frames : [];
  const culpritFrame = frames.length ? pickCulpritFrame(frames) : null;
  const culprit = culpritFrame
    ? [clean(culpritFrame.function || culpritFrame.module, 120), frameLocation(culpritFrame)]
        .filter(Boolean).join(" · ") || null
    : null;
  const rawLevel = typeof event.level === "string" ? event.level.toLowerCase() : "error";
  const level = ISSUE_LEVELS.includes(rawLevel) ? rawLevel : rawLevel === "debug" ? "info" : "error";
  const rawCrumbs = Array.isArray(event.breadcrumbs)
    ? event.breadcrumbs
    : Array.isArray(event.breadcrumbs?.values)
      ? event.breadcrumbs.values
      : [];
  const breadcrumbs = rawCrumbs.slice(0, 30).map((b) => {
    const c = b && typeof b === "object" ? b : {};
    let at = "";
    if (typeof c.timestamp === "number") at = new Date(c.timestamp * 1000).toISOString();
    else if (typeof c.timestamp === "string") at = clean(c.timestamp, 40);
    return {
      at: at || new Date(now).toISOString(),
      category: clean(c.category, 40) || "log",
      message: clean(c.message, 300),
      level: CRUMB_LEVELS.includes(c.level) ? c.level : "info",
    };
  });
  return {
    ok: true,
    fields: {
      eventId: event.event_id,
      type,
      message,
      culprit,
      level,
      stack: frames.length ? renderStack(type, message, frames) : null,
      release: clean(event.release, 60) || null,
      environment: clean(event.environment, 40) || null,
      breadcrumbs,
      occurredAt: clampOccurredAt(event.timestamp, now),
    },
  };
}

/**
 * Extract the key from an X-Sentry-Auth header value:
 *   "Sentry sentry_version=7, sentry_key=cdi_…, sentry_client=…"
 * Returns the key string or null.
 */
export function parseSentryAuthHeader(value) {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/sentry_key=([A-Za-z0-9_\-]+)/);
  return m ? m[1] : null;
}

/**
 * Fixed-window per-key rate limiter (abuse control, not a meter).
 * check(keyId, nowMs) → { allowed, retryAfterSec }.
 */
export function createRateLimiter({ limit = 600, windowMs = 60_000 } = {}) {
  const windows = new Map(); // keyId -> { start, count }
  return {
    check(keyId, now = Date.now()) {
      let w = windows.get(keyId);
      if (!w || now - w.start >= windowMs) {
        w = { start: now, count: 0 };
        windows.set(keyId, w);
      }
      w.count += 1;
      if (w.count > limit) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((w.start + windowMs - now) / 1000)) };
      }
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}
