// @sync-fs-ok: archive writes must be on disk before the rows are deleted, and
// each run is capped at maxBatches x batchSize rows per ~hourly heartbeat. An
// async rewrite (fs/promises + zlib.gzip) measurably stalled the governor tick
// in a CI-like local run (1 tick then only skipped ticks for 150s); the sync
// version ticks normally. Kept sync on purpose.
//
// Retention for append-only activity logs that grew without bound.
//
// emergent_activity_feed (~780k rows/day) and inference_spans had no pruning
// at all; by 2026-09-28 they were 10M and 6.6M rows and most of a 16GB
// concord.db. Rows older than the window are archived to gzipped JSONL
// (data/archive/<table>/<YYYY-MM-DD>.jsonl.gz, one gzip member appended per
// batch — concatenated members are a valid gzip stream) and then deleted.
//
// Work per call is capped (maxBatches × batchSize) so a heartbeat never holds
// the event loop for long; a backlog drains over successive runs.
// brain_interactions is deliberately NOT handled here: its rows are training
// data (train_consented) and are kept.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DAY_MS = 86_400_000;

// tsKind: how created/recorded timestamps are stored in that table.
//   "ms"   — integer epoch milliseconds
//   "text" — datetime('now') / ISO text (compared lexically at day precision)
export const RETAINED_LOGS = [
  { table: "emergent_activity_feed", tsColumn: "created_at", tsKind: "ms", keyColumn: "id", envDays: "CONCORD_EMERGENT_FEED_RETENTION_DAYS" },
  { table: "inference_spans", tsColumn: "recorded_at", tsKind: "text", keyColumn: "id", envDays: "CONCORD_INFERENCE_SPANS_RETENTION_DAYS" },
];

const DEFAULT_DAYS = 14;

function cutoffFor(tsKind, days, now) {
  const t = now - days * DAY_MS;
  if (tsKind === "ms") return t;
  return new Date(t).toISOString().slice(0, 19).replace("T", " ");
}

function dayOf(tsKind, value) {
  if (tsKind === "ms") return new Date(Number(value)).toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Archive then delete rows older than the retention window in one table.
 * Returns { ok, table, archived, deleted, done } — never throws.
 */
export function pruneLog(db, spec, { days, now = Date.now(), archiveRoot, batchSize = 5000, maxBatches = 20 } = {}) {
  const { table, tsColumn, tsKind, keyColumn } = spec;
  try {
    const retentionDays = Number(days ?? process.env[spec.envDays] ?? DEFAULT_DAYS);
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return { ok: true, table, skipped: "retention_disabled" };
    const cutoff = cutoffFor(tsKind, retentionDays, now);
    const dir = path.join(archiveRoot, table);
    fs.mkdirSync(dir, { recursive: true });

    const select = db.prepare(`SELECT * FROM ${table} WHERE ${tsColumn} < ? ORDER BY ${tsColumn} LIMIT ?`);
    const del = db.prepare(`DELETE FROM ${table} WHERE ${keyColumn} = ?`);
    const deleteMany = db.transaction((rows) => { for (const r of rows) del.run(r[keyColumn]); });

    let archived = 0, deleted = 0, done = false;
    for (let b = 0; b < maxBatches; b++) {
      const rows = select.all(cutoff, batchSize);
      if (rows.length === 0) { done = true; break; }
      const byDay = new Map();
      for (const r of rows) {
        const d = dayOf(tsKind, r[tsColumn]);
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(JSON.stringify(r));
      }
      // Archive must land on disk before the rows are deleted.
      for (const [d, lines] of byDay) {
        fs.appendFileSync(path.join(dir, `${d}.jsonl.gz`), zlib.gzipSync(lines.join("\n") + "\n"));
        archived += lines.length;
      }
      deleteMany(rows);
      deleted += rows.length;
      if (rows.length < batchSize) { done = true; break; }
    }
    return { ok: true, table, archived, deleted, done };
  } catch (err) {
    return { ok: false, table, reason: err?.message || String(err) };
  }
}

export function pruneRetainedLogs(db, opts = {}) {
  return RETAINED_LOGS.map((spec) => pruneLog(db, spec, opts));
}
