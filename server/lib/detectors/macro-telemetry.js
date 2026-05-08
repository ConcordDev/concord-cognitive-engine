// server/lib/detectors/macro-telemetry.js
//
// Runtime instrumentation for the macro dispatcher reach mystery.
//
// MacroUsageDetector flags 253 macros as "no static caller" but the
// dispatcher recognizer (Phase 0) reclassifies them all as "potentially
// reachable via /api/macros/run". The static parse can't tell us which
// of those 253 are actually called by anyone, ever.
//
// This module records every macro invocation at runtime — domain.name,
// timestamp, source (http / heartbeat / internal), latency. The data is
// persisted to audit/detectors/macro-telemetry.jsonl and merged into the
// MacroUsageDetector report so a macro that has fired in the last
// `MACRO_LIVE_WINDOW_DAYS` (default 30) is upgraded from "dispatcher
// reachable" to "live", and a macro that has never fired gets downgraded
// to "candidate for retirement".
//
// Persistence is intentionally cheap — append-only JSONL with daily
// aggregation. Hot path adds a single Map.set + counter increment;
// flush happens on a 5-min interval.

import { appendFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

// In-memory aggregation between flushes. Keys are "domain.name".
const COUNTS_BY_KEY = new Map();        // key -> { total, lastFiredAt, sources: { http, heartbeat, internal, system } }
let _flushInterval = null;
let _started = false;
let _logPath = null;

const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const MACRO_LIVE_WINDOW_DAYS = 30;

/**
 * Record a single invocation. Called from runMacro() in server.js.
 * Hot path — keep allocations minimal.
 *
 * @param {string} domain
 * @param {string} name
 * @param {object} ctx — passed to runMacro; we read ctx.reqMeta to derive source
 */
export function recordInvocation(domain, name, ctx) {
  if (!domain || !name) return;
  const key = `${domain}.${name}`;
  let entry = COUNTS_BY_KEY.get(key);
  if (!entry) {
    entry = { total: 0, lastFiredAt: 0, sources: { http: 0, heartbeat: 0, internal: 0, system: 0 } };
    COUNTS_BY_KEY.set(key, entry);
  }
  entry.total++;
  entry.lastFiredAt = Date.now();
  // Source classification — cheap heuristic on the ctx we already have.
  if (ctx?.reqMeta?.path) entry.sources.http++;
  else if (ctx?.actor?.internal && ctx?.reqMeta?.reason === "heartbeat") entry.sources.heartbeat++;
  else if (ctx?.actor?.internal) entry.sources.internal++;
  else entry.sources.system++;
}

/** Snapshot of the live in-memory aggregation. */
export function snapshot() {
  const now = Date.now();
  const out = [];
  for (const [key, entry] of COUNTS_BY_KEY.entries()) {
    out.push({
      key,
      total: entry.total,
      lastFiredAt: entry.lastFiredAt,
      ageDays: (now - entry.lastFiredAt) / 86_400_000,
      sources: { ...entry.sources },
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

/**
 * Start periodic flush. Safe to call multiple times — second call is a no-op.
 *
 * @param {string} repoRoot — used to compute the audit path
 */
export function startTelemetry(repoRoot) {
  if (_started) return;
  _started = true;
  _logPath = path.join(repoRoot, "audit", "detectors", "macro-telemetry.jsonl");
  _flushInterval = setInterval(() => {
    flush().catch(() => { /* swallow — telemetry must never crash */ });
  }, FLUSH_INTERVAL_MS);
  _flushInterval.unref?.();
}

/** Stop the periodic flush. Used by tests + graceful shutdown. */
export function stopTelemetry() {
  if (_flushInterval) clearInterval(_flushInterval);
  _flushInterval = null;
  _started = false;
}

/** Test-only — clear in-memory counts and disable the file path. */
export function _resetForTest() {
  stopTelemetry();
  COUNTS_BY_KEY.clear();
  _logPath = null;
}

/** Flush the current aggregation to disk and clear in-memory counters. */
export async function flush() {
  if (!_logPath || COUNTS_BY_KEY.size === 0) return { written: 0 };
  await mkdir(path.dirname(_logPath), { recursive: true });
  const generatedAt = new Date().toISOString();
  const rows = [];
  for (const [key, entry] of COUNTS_BY_KEY.entries()) {
    rows.push(JSON.stringify({
      generatedAt,
      key,
      total: entry.total,
      lastFiredAt: entry.lastFiredAt,
      sources: entry.sources,
    }));
  }
  await appendFile(_logPath, rows.join("\n") + "\n", "utf-8");
  COUNTS_BY_KEY.clear();
  return { written: rows.length, path: _logPath };
}

/**
 * Read the persisted telemetry log and aggregate per-key over the last
 * `windowDays` (default = MACRO_LIVE_WINDOW_DAYS).
 *
 * @returns {Promise<{liveKeys: Set<string>, lastFiredAt: Map<string, number>, totals: Map<string, number>}>}
 */
export async function loadAggregated(repoRoot, windowDays = MACRO_LIVE_WINDOW_DAYS) {
  const p = path.join(repoRoot, "audit", "detectors", "macro-telemetry.jsonl");
  let raw;
  try { raw = await readFile(p, "utf-8"); }
  catch { return { liveKeys: new Set(), lastFiredAt: new Map(), totals: new Map() }; }

  const cutoff = Date.now() - windowDays * 86_400_000;
  const lastFiredAt = new Map();
  const totals = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row.key || !Number.isFinite(row.lastFiredAt)) continue;
    const prev = lastFiredAt.get(row.key) || 0;
    if (row.lastFiredAt > prev) lastFiredAt.set(row.key, row.lastFiredAt);
    totals.set(row.key, (totals.get(row.key) || 0) + (row.total || 0));
  }
  // Fold in live in-memory counts so a brand-new run isn't blind.
  for (const [key, entry] of COUNTS_BY_KEY.entries()) {
    const prev = lastFiredAt.get(key) || 0;
    if (entry.lastFiredAt > prev) lastFiredAt.set(key, entry.lastFiredAt);
    totals.set(key, (totals.get(key) || 0) + entry.total);
  }
  const liveKeys = new Set();
  for (const [key, ts] of lastFiredAt.entries()) {
    if (ts >= cutoff) liveKeys.add(key);
  }
  return { liveKeys, lastFiredAt, totals };
}

export { MACRO_LIVE_WINDOW_DAYS };
