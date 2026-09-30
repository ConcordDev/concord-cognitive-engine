// @sync-fs-ok: each batch's archive write must be on disk before that batch's
// rows are deleted, so the write inside a batch is synchronous; the loop yields
// to the event loop between batches, and each run is capped at
// maxBatches x batchSize rows per ~hourly heartbeat.
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
// the event loop for long; a backlog drains over successive runs, and the
// loop yields to the event loop between batches (the file writes inside a
// batch stay synchronous so the archive is on disk before the delete).
//
// brain_interactions: only rows whose outcome is settled and not training
// data are pruned — never 'pending' (the outcome resolver still works on
// them) and never 'positive' (buildPositiveCorpus's training set). On
// 2026-09-30, 2.48M of its 2.49M rows were 'stuck_timeout' (marked by the
// external brain-reaper), ~180k/day, ~2GB. Archived like the others, so the
// data is kept on disk, just out of the live DB.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DAY_MS = 86_400_000;

// tsKind: how created/recorded timestamps are stored in that table.
//   "ms"   — integer epoch milliseconds
//   "s"    — integer epoch seconds
//   "text" — datetime('now') / ISO text (compared lexically at day precision)
// extraWhere: a fixed SQL condition (a literal here, never caller input).
// ordered: false skips ORDER BY where the table has no index to sort by
// cheaply (storage order is roughly insertion order, i.e. oldest first).
export const RETAINED_LOGS = Object.freeze([
  { table: "emergent_activity_feed", tsColumn: "created_at", tsKind: "ms", keyColumn: "id", envDays: "CONCORD_EMERGENT_FEED_RETENTION_DAYS", defaultDays: 14 },
  { table: "inference_spans", tsColumn: "recorded_at", tsKind: "text", keyColumn: "id", envDays: "CONCORD_INFERENCE_SPANS_RETENTION_DAYS", defaultDays: 14 },
  { table: "brain_interactions", tsColumn: "created_at", tsKind: "s", keyColumn: "id", envDays: "CONCORD_BRAIN_INTERACTIONS_RETENTION_DAYS", defaultDays: 7,
    extraWhere: "outcome NOT IN ('pending', 'positive')", ordered: false },
].map((spec) => Object.freeze(spec)));

function cutoffFor(tsKind, days, now) {
  const t = now - days * DAY_MS;
  if (tsKind === "ms") return t;
  if (tsKind === "s") return Math.floor(t / 1000);
  return new Date(t).toISOString().slice(0, 19).replace("T", " ");
}

function dayOf(tsKind, value) {
  if (tsKind === "ms") return new Date(Number(value)).toISOString().slice(0, 10);
  if (tsKind === "s") return new Date(Number(value) * 1000).toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Archive then delete rows older than the retention window in one table.
 * Returns { ok, table, archived, deleted, done } — never rejects.
 */
export async function pruneLog(db, spec, { days, now = Date.now(), archiveRoot, batchSize = 5000, maxBatches = 20 } = {}) {
  const { table, tsColumn, tsKind, keyColumn } = spec;
  try {
    const retentionDays = Number(days ?? process.env[spec.envDays] ?? spec.defaultDays ?? 14);
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return { ok: true, table, skipped: "retention_disabled" };
    const cutoff = cutoffFor(tsKind, retentionDays, now);
    const dir = path.join(archiveRoot, table);
    fs.mkdirSync(dir, { recursive: true });

    const where = spec.extraWhere ? `${tsColumn} < ? AND (${spec.extraWhere})` : `${tsColumn} < ?`;
    const order = spec.ordered === false ? "" : ` ORDER BY ${tsColumn}`;
    const select = db.prepare(`SELECT * FROM ${table} WHERE ${where}${order} LIMIT ?`);
    const del = db.prepare(`DELETE FROM ${table} WHERE ${keyColumn} = ?`);
    const deleteMany = db.transaction((rows) => { for (const r of rows) del.run(r[keyColumn]); });

    let archived = 0, deleted = 0, done = false;
    for (let b = 0; b < maxBatches; b++) {
      if (b > 0) await new Promise((r) => { setImmediate(r); });
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

export async function pruneRetainedLogs(db, opts = {}) {
  const results = [];
  for (const spec of RETAINED_LOGS) results.push(await pruneLog(db, spec, opts));
  return results;
}
