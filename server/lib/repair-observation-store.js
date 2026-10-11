// Durable per-signature counts for repair-cortex observe().
//
// The in-memory accumulator is wiped on every deploy restart, so a signature
// the process had already seen looked new again and the first sighting never
// reached the log. This store keeps first_seen / last_seen / count / a scrubbed
// sample in SQLite. The hot path only mutates memory. Rows flush in one
// transaction on an interval and on shutdown — never one write per occurrence.
// A database error here is swallowed; observe() must keep running.

import crypto from "node:crypto";
import logger from "../logger.js";

const DEFAULT_FLUSH_MS = 30_000;
const DEFAULT_MAX_ROWS = 2000;
const MESSAGE_MAX = 240;
const SOURCE_MAX = 120;
const ROUTE_MAX = 200;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g;
const BEARER_RE = /bearer\s+[A-Za-z0-9._~+/-]{8,}/gi;
const SECRET_ASSIGN_RE = /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|session|jwt)\b\s*[:=]\s*\S+/gi;
const SK_RE = /\b(?:sk|pk|rk)_[A-Za-z0-9]{8,}\b/g;
const SK_DASH_RE = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
const HEX_RE = /\b[0-9a-f]{16,}\b/gi;
const NUM_RE = /\b\d+\b/g;

/** @type {Map<string, ObservationRow>} */
const _rows = new Map();
/** Signatures already announced at warn this process. Survives in-memory eviction. */
const _warned = new Set();
let _db = null;
let _timer = null;
const _stats = { batches: 0, statements: 0 };

/**
 * @typedef {object} ObservationRow
 * @property {string} signature
 * @property {string} source
 * @property {string} route
 * @property {string} errorClass
 * @property {string} messageNorm
 * @property {string} firstSeen
 * @property {string} lastSeen
 * @property {number} count
 * @property {object} sample
 * @property {boolean} dirty
 */

function maxRows() {
  const n = Number(process.env.CONCORD_REPAIR_OBS_MAX_ROWS);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return DEFAULT_MAX_ROWS;
}

function resolveFlushMs(explicit) {
  if (explicit === 0) return 0;
  const fromOpt = Number(explicit);
  if (Number.isFinite(fromOpt) && fromOpt >= 50) return fromOpt;
  const fromEnv = Number(process.env.CONCORD_REPAIR_OBS_FLUSH_MS);
  if (fromEnv === 0) return 0;
  if (Number.isFinite(fromEnv) && fromEnv >= 50) return fromEnv;
  return DEFAULT_FLUSH_MS;
}

function withoutControls(raw) {
  let out = "";
  const s = String(raw ?? "");
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += (code < 32 || code === 127) ? " " : s[i];
  }
  return out;
}

function scrubText(raw, max) {
  let s = withoutControls(raw);
  s = s.replace(EMAIL_RE, ":email");
  s = s.replace(JWT_RE, ":secret");
  s = s.replace(BEARER_RE, ":secret");
  s = s.replace(SECRET_ASSIGN_RE, "$1=:secret");
  s = s.replace(SK_DASH_RE, ":secret");
  s = s.replace(SK_RE, ":secret");
  s = s.replace(UUID_RE, ":id");
  s = s.replace(IP_RE, ":ip");
  s = s.replace(HEX_RE, ":id");
  s = s.replace(NUM_RE, ":n");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

function normalizeRoute(raw) {
  if (raw == null || raw === "") return "";
  let s = withoutControls(raw).split("?")[0].split("#")[0];
  s = s.replace(EMAIL_RE, ":email");
  s = s.replace(JWT_RE, ":secret");
  s = s.replace(UUID_RE, ":id");
  s = s.replace(IP_RE, ":ip");
  s = s.replace(HEX_RE, ":id");
  s = s.replace(/\/\d+(?=\/|$)/g, "/:n");
  s = s.replace(NUM_RE, ":n");
  return s.slice(0, ROUTE_MAX);
}

function errorClassOf(error) {
  let name = "Error";
  if (error && typeof error === "object") {
    const raw = error.name || error.constructor?.name;
    if (typeof raw === "string" && raw) name = raw;
  }
  const clean = name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 64);
  return clean || "Error";
}

function contextParts(error, context) {
  let source = "unknown";
  let route = "";
  let macro = "";
  if (typeof context === "string") {
    source = context.trim() || "unknown";
  } else if (context && typeof context === "object") {
    const src = context.source ?? context.module ?? context.context;
    if (src != null && String(src).trim()) source = String(src).trim();
    route = String(context.route || context.path || context.template || "");
    if (context.macro != null) macro = String(context.macro);
    else if (context.domain && (context.name || context.action)) {
      macro = `${context.domain}.${context.name || context.action}`;
    }
  }
  if (!route && error && typeof error === "object") {
    if (error.route || error.path) route = String(error.route || error.path);
    if (!macro && error.macro) macro = String(error.macro);
  }
  const routeKey = normalizeRoute(route || macro);
  const sourceKey = scrubText(source, SOURCE_MAX) || "unknown";
  const errorClass = errorClassOf(error);
  const messageNorm = scrubText(error?.message ?? error, MESSAGE_MAX);
  const fingerprint = ["v1", sourceKey, routeKey, errorClass, messageNorm].join("\0");
  const signature = crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 32);
  const sample = {
    source: sourceKey,
    route: routeKey || null,
    errorClass,
    message: messageNorm,
  };
  return { signature, source: sourceKey, route: routeKey, errorClass, messageNorm, sample };
}

/** Stable fingerprint. Exported so tests can address a row without parsing logs. */
export function observationFingerprint(error, context) {
  try { return contextParts(error, context); }
  catch { return null; }
}

function tableReady(db) {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get("repair_observation_signatures");
    return !!row;
  } catch {
    return false;
  }
}

function warnFirstSeen(row) {
  if (_warned.has(row.signature)) return;
  _warned.add(row.signature);
  try {
    logger.warn(
      "repair-cortex",
      `error_signature_first_seen signature=${row.signature} firstSeen=${row.firstSeen} source=${row.source} route=${row.route || "-"} class=${row.errorClass}`,
      {
        event: "error_signature_first_seen",
        signature: row.signature,
        firstSeen: row.firstSeen,
        source: row.source,
        route: row.route || null,
        errorClass: row.errorClass,
        message: row.messageNorm,
      },
    );
  } catch { /* logging must not break observe() */ }
}

function rememberLoaded(row) {
  _warned.add(row.signature);
}

/**
 * Record one observation in memory. Logs once when the signature has never
 * been seen in this process and was not loaded from the database.
 * Never writes SQLite. Never throws.
 */
export function noteObservation(error, context) {
  try {
    const parts = contextParts(error, context);
    const now = new Date().toISOString();
    const existing = _rows.get(parts.signature);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = now;
      existing.sample = parts.sample;
      existing.source = parts.source;
      existing.route = parts.route;
      existing.errorClass = parts.errorClass;
      existing.messageNorm = parts.messageNorm;
      existing.dirty = true;
      coalesceIfOverflow();
      return { signature: parts.signature, isNew: false, count: existing.count, firstSeen: existing.firstSeen };
    }
    const row = {
      signature: parts.signature,
      source: parts.source,
      route: parts.route,
      errorClass: parts.errorClass,
      messageNorm: parts.messageNorm,
      firstSeen: now,
      lastSeen: now,
      count: 1,
      sample: parts.sample,
      dirty: true,
    };
    _rows.set(row.signature, row);
    warnFirstSeen(row);
    coalesceIfOverflow();
    return { signature: row.signature, isNew: true, count: 1, firstSeen: row.firstSeen };
  } catch {
    return null;
  }
}

function coalesceIfOverflow() {
  if (_rows.size <= maxRows()) return;
  if (_db) {
    flushObservations();
    return;
  }
  evictMemory();
}

function evictMemory() {
  const cap = maxRows();
  if (_rows.size <= cap) return;
  const ranked = [..._rows.values()].sort((a, b) => {
    if (a.count !== b.count) return a.count - b.count;
    return String(a.lastSeen).localeCompare(String(b.lastSeen));
  });
  while (_rows.size > cap && ranked.length) {
    const victim = ranked.shift();
    _rows.delete(victim.signature);
  }
}

export function loadObservations(db = _db) {
  try {
    if (!db || !tableReady(db)) return 0;
    const rows = db.prepare(`
      SELECT signature, source, route, error_class, message_norm,
             first_seen, last_seen, count, sample_json
        FROM repair_observation_signatures
    `).all();
    for (const row of rows) {
      let sample = null;
      try { sample = row.sample_json ? JSON.parse(row.sample_json) : null; }
      catch { sample = null; }
      const loaded = {
        signature: row.signature,
        source: row.source || "",
        route: row.route || "",
        errorClass: row.error_class || "Error",
        messageNorm: row.message_norm || "",
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        count: Number(row.count) || 0,
        sample: sample || {
          source: row.source || "",
          route: row.route || null,
          errorClass: row.error_class || "Error",
          message: row.message_norm || "",
        },
        dirty: false,
      };
      const current = _rows.get(row.signature);
      if (current && current.dirty && current.count >= loaded.count) {
        rememberLoaded(loaded);
        continue;
      }
      _rows.set(row.signature, loaded);
      rememberLoaded(loaded);
    }
    return rows.length;
  } catch {
    return 0;
  }
}

function sampleJson(sample) {
  const json = JSON.stringify(sample ?? {});
  if (json.length <= 800) return json;
  return JSON.stringify({
    source: String(sample?.source || "").slice(0, 80),
    route: sample?.route ? String(sample.route).slice(0, 120) : null,
    errorClass: String(sample?.errorClass || "").slice(0, 40),
    message: String(sample?.message || "").slice(0, 180),
  });
}

function prune(db) {
  const cap = maxRows();
  const total = db.prepare("SELECT COUNT(*) AS c FROM repair_observation_signatures").get().c;
  if (total <= cap) return;
  const excess = total - cap;
  const victims = db.prepare(`
    SELECT signature FROM repair_observation_signatures
     ORDER BY count ASC, last_seen ASC
     LIMIT ?
  `).all(excess);
  const del = db.prepare("DELETE FROM repair_observation_signatures WHERE signature = ?");
  for (const victim of victims) {
    del.run(victim.signature);
    _rows.delete(victim.signature);
  }
}

/**
 * Write every dirty signature in one transaction. Safe to call when the
 * table is missing or the handle is closed — returns without throwing.
 */
export function flushObservations() {
  const db = _db;
  if (!db) return { ok: true, flushed: 0 };
  let dirty;
  try {
    dirty = [];
    for (const row of _rows.values()) {
      if (row.dirty) dirty.push(row);
    }
    if (dirty.length === 0) return { ok: true, flushed: 0 };
    if (!tableReady(db)) return { ok: true, flushed: 0, reason: "no_table" };
  } catch {
    return { ok: false, flushed: 0 };
  }
  try {
    const upsert = db.prepare(`
      INSERT INTO repair_observation_signatures (
        signature, source, route, error_class, message_norm,
        first_seen, last_seen, count, sample_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(signature) DO UPDATE SET
        source = excluded.source,
        route = excluded.route,
        error_class = excluded.error_class,
        message_norm = excluded.message_norm,
        last_seen = excluded.last_seen,
        count = excluded.count,
        sample_json = excluded.sample_json,
        updated_at = excluded.updated_at
    `);
    const now = new Date().toISOString();
    const tx = db.transaction((rows) => {
      for (const row of rows) {
        upsert.run(
          row.signature,
          row.source,
          row.route,
          row.errorClass,
          row.messageNorm,
          row.firstSeen,
          row.lastSeen,
          row.count,
          sampleJson(row.sample),
          now,
        );
      }
    });
    tx(dirty);
    _stats.batches += 1;
    _stats.statements += dirty.length;
    for (const row of dirty) row.dirty = false;
  } catch {
    return { ok: false, flushed: 0 };
  }
  try { prune(db); }
  catch { /* cap is best-effort; the counts already landed */ }
  return { ok: true, flushed: dirty.length };
}

export function stopObservationFlushTimer() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

function startTimer(flushMs) {
  stopObservationFlushTimer();
  const ms = resolveFlushMs(flushMs);
  if (!ms) return;
  _timer = setInterval(() => {
    try { flushObservations(); }
    catch { /* interval flush never crashes the process */ }
  }, ms);
  _timer.unref?.();
}

/**
 * Point the store at a database and load existing signatures so a signature
 * seen before this process started is not announced again.
 * `flushMs: 0` disables the interval (tests). Production default is 30s.
 */
export function configureObservationStore(db, opts = {}) {
  _db = db || null;
  if (!_db) {
    stopObservationFlushTimer();
    return { loaded: 0 };
  }
  const loaded = loadObservations(_db);
  startTimer(opts.flushMs);
  return { loaded };
}

export function getObservationStatus() {
  try {
    let pending = 0;
    const entries = [];
    for (const row of _rows.values()) {
      if (row.dirty) pending += 1;
      entries.push({
        signature: row.signature,
        source: row.source,
        route: row.route || null,
        errorClass: row.errorClass,
        message: row.messageNorm,
        count: row.count,
        firstSeen: row.firstSeen,
        lastSeen: row.lastSeen,
      });
    }
    entries.sort((a, b) => b.count - a.count || String(b.lastSeen).localeCompare(String(a.lastSeen)));
    return {
      ok: true,
      size: _rows.size,
      pending,
      entries: entries.slice(0, 50),
    };
  } catch {
    return { ok: true, size: 0, pending: 0, entries: [] };
  }
}

export function getObservationFlushStats() {
  return { batches: _stats.batches, statements: _stats.statements };
}

export function resetObservationsForTest() {
  stopObservationFlushTimer();
  _rows.clear();
  _warned.clear();
  _db = null;
  _stats.batches = 0;
  _stats.statements = 0;
}
