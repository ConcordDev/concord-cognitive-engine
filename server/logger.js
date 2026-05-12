/**
 * Centralized Logging for Concord Cognitive Engine
 *
 * All logs from all sources streamed to one buffer.
 * Filterable by brain, severity, lens, and time.
 * Supports SSE streaming for live tailing.
 */

const LOG_BUFFER_MAX = 10000;
const logBuffer = [];

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

// ── PII / secret scrub (Sprint 29 — privacy review finding) ─────────────────
//
// Sensitive field names + value shapes are recursively redacted before the
// entry reaches the buffer or stdout. The aim is defence-in-depth: callers
// already shouldn't pass these, but a callsite that forgets won't
// publish the secret to docker logs / log shipper.
//
// Patterns intentionally cover:
//   - Auth: password, password_hash, jwt, token, bearer, authorization, session
//   - Money: stripe_secret, stripe_key
//   - API keys we route: sk-, sk-ant-, AIza-, xai-
//   - Common secret keys: api_key, apiKey, secret, credentials
const SENSITIVE_KEY_RE = /^(password|password_hash|passwd|pwd|jwt|jwtToken|token|bearer|auth|authorization|session|sessionId|cookie|stripe_secret|stripe_key|apiKey|api_key|secret|credentials|private_key|privateKey|refresh_token|access_token|refreshToken|accessToken)$/i;
const SENSITIVE_VALUE_RE = /^(sk-ant-[a-z0-9_-]{8,}|sk-[a-z0-9_-]{20,}|AIza[a-z0-9_-]{20,}|xai-[a-z0-9_-]{20,}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)$/i;
const REDACTED = "[REDACTED]";
const MAX_REDACT_DEPTH = 6;

function scrub(value, depth = 0) {
  if (depth > MAX_REDACT_DEPTH) return REDACTED;
  if (value == null) return value;
  if (typeof value === "string") {
    return SENSITIVE_VALUE_RE.test(value) ? REDACTED : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1));
  const out = {};
  for (const k of Object.keys(value)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = REDACTED;
    } else {
      out[k] = scrub(value[k], depth + 1);
    }
  }
  return out;
}

/**
 * Log a structured entry.
 * @param {"error"|"warn"|"info"|"debug"} level
 * @param {string} source - e.g. 'conscious', 'subconscious', 'utility', 'server', 'frontend', 'heartbeat'
 * @param {string} message
 * @param {object} [meta={}]
 */
// Sprint 18.6 — log-injection defense (CodeQL js/log-injection).
// User-controlled `message` flows to stdout via console.{log,warn,error}.
// A crafted message containing CRLF can inject fake log entries that
// downstream parsers (Datadog, Honeycomb, the Concord log viewer) treat
// as legitimate. Sanitize before write: escape \r and \n, replace other
// ASCII control chars with ?, cap length at 4KB.
const LOG_MESSAGE_MAX_LEN = 4096;
function sanitizeLogMessage(input) {
  if (input == null) return "";
  let s = typeof input === "string" ? input : String(input);
  if (s.length > LOG_MESSAGE_MAX_LEN) s = s.slice(0, LOG_MESSAGE_MAX_LEN) + "…";
  // Replace ASCII control chars (except tab) with literal escape sequences
  // so a downstream log parser sees a single line, not 5 fake entries.
  return s
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "?"); // eslint-disable-line no-control-regex
}

function log(level, source, message, meta = {}) {
  const safeMeta = scrub(meta);
  const safeMessage = sanitizeLogMessage(message);
  const safeSource = sanitizeLogMessage(source);
  const safeLevel = sanitizeLogMessage(level);
  const entry = {
    timestamp: new Date().toISOString(),
    level: safeLevel,
    source: safeSource,
    message: safeMessage,
    meta: safeMeta,
    lens: safeMeta?.lens || null,
  };

  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();

  // Sanitized message reaches stdout / docker / log shipper — no CRLF
  // injection vector regardless of caller hygiene.
  const prefix = `[${safeSource}] [${safeLevel.toUpperCase()}]`;
  if (safeLevel === 'error') console.error(`${prefix} ${safeMessage}`);
  else if (safeLevel === 'warn') console.warn(`${prefix} ${safeMessage}`);
  else console.log(`${prefix} ${safeMessage}`);
}

/**
 * Query the log buffer with filters.
 * @param {object} filters
 * @param {"error"|"warn"|"info"|"debug"} [filters.level]
 * @param {string} [filters.source]
 * @param {string} [filters.lens]
 * @param {string} [filters.since] - ISO date string
 * @param {string} [filters.search] - Free text search
 * @param {number} [filters.limit=100]
 * @returns {object[]}
 */
function query(filters = {}) {
  let results = [...logBuffer];

  if (filters.level) {
    const maxLevel = LEVELS[filters.level] ?? 3;
    results = results.filter(e => LEVELS[e.level] <= maxLevel);
  }
  if (filters.source) {
    results = results.filter(e => e.source === filters.source);
  }
  if (filters.lens) {
    results = results.filter(e => e.lens === filters.lens);
  }
  if (filters.since) {
    const since = new Date(filters.since);
    results = results.filter(e => new Date(e.timestamp) >= since);
  }
  if (filters.search) {
    const term = filters.search.toLowerCase();
    results = results.filter(e => e.message.toLowerCase().includes(term));
  }

  return results.slice(-(filters.limit || 100));
}

/**
 * Get the raw buffer for SSE streaming.
 * @returns {object[]}
 */
function getBuffer() {
  return logBuffer;
}

export default {
  log,
  query,
  getBuffer,
  error: (source, msg, meta) => log('error', source, msg, meta),
  warn: (source, msg, meta) => log('warn', source, msg, meta),
  info: (source, msg, meta) => log('info', source, msg, meta),
  debug: (source, msg, meta) => log('debug', source, msg, meta),
};

export { log, query, getBuffer, LEVELS };
