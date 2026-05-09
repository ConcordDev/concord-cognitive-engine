/**
 * Quota / usage in-memory write-through cache.
 *
 * Why: high-volume per-macro / per-API-call writes against api_usage_log
 * (and similar shape tables) bottleneck the SQLite single-writer at
 * 10k+ calls/sec in load tests. The fix is well known but never wired:
 *
 *   - keep a per-user accumulator in memory
 *   - flush every FLUSH_INTERVAL_MS via a single batched transaction
 *     (better-sqlite3's `db.transaction(...)` runs many INSERTs as one
 *     write — that's the whole point)
 *   - flush on SIGTERM / SIGINT / process.exit so an in-flight buffer
 *     never silently drops calls under graceful shutdown
 *
 * Drop-in replacement: callers do `enqueueUsage(db, row)` instead of
 * `recordUsage(db, row)`. The cache owns the flush schedule.
 *
 * Test target: 1000 calls in 1s should produce ≤ 1 DB write batch
 * (just the flush) and the row count must reconcile.
 *
 * Env:
 *   CONCORD_QUOTA_FLUSH_MS   override flush interval, default 5000
 *   CONCORD_QUOTA_MAX_BUFFER soft buffer cap; flush early if exceeded
 */

import crypto from "node:crypto";

const DEFAULT_FLUSH_MS = Number(process.env.CONCORD_QUOTA_FLUSH_MS || 5000);
const DEFAULT_MAX_BUFFER = Number(process.env.CONCORD_QUOTA_MAX_BUFFER || 5000);

/**
 * Build a cache instance bound to a specific table + column shape.
 * Each call to `createQuotaCache` returns its own buffer + timer so
 * tests can run in isolation. Production code creates ONE per table.
 */
export function createQuotaCache({
  table,
  columns,
  flushIntervalMs = DEFAULT_FLUSH_MS,
  maxBufferRows = DEFAULT_MAX_BUFFER,
  onFlush, // optional observer for tests
} = {}) {
  if (!table || typeof table !== "string") throw new Error("createQuotaCache: table required");
  if (!Array.isArray(columns) || columns.length === 0) throw new Error("createQuotaCache: columns array required");

  // SQL identifier guards. The placeholders are user-controlled; the
  // identifiers are not — but defense-in-depth never hurts.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error("invalid_table_name");
  for (const c of columns) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c)) throw new Error(`invalid_column_name:${c}`);
  }

  const buffer = []; // each entry: { dbHandle, values: [...] }
  let timer = null;
  let flushing = false; // re-entry guard
  const stats = { enqueued: 0, flushedRows: 0, flushedBatches: 0, lastFlushAt: null };

  const placeholders = "(" + columns.map(() => "?").join(", ") + ")";
  const cols = columns.join(", ");

  function buildInsertSql(rowCount) {
    const allRows = Array.from({ length: rowCount }, () => placeholders).join(", ");
    return `INSERT INTO ${table} (${cols}) VALUES ${allRows}`;
  }

  function flushSync() {
    if (flushing) return { flushedRows: 0, batches: 0 };
    if (buffer.length === 0) return { flushedRows: 0, batches: 0 };
    flushing = true;
    try {
      // Group by db handle — most callers only have one but tests may
      // exercise multiple :memory: dbs.
      const byDb = new Map();
      for (const entry of buffer) {
        if (!byDb.has(entry.dbHandle)) byDb.set(entry.dbHandle, []);
        byDb.get(entry.dbHandle).push(entry.values);
      }
      let totalRows = 0;
      let batches = 0;
      for (const [db, rows] of byDb.entries()) {
        const sql = buildInsertSql(rows.length);
        const flat = [];
        for (const row of rows) flat.push(...row);
        try {
          db.prepare(sql).run(...flat);
          totalRows += rows.length;
          batches += 1;
        } catch (err) {
          // Per-row fallback: if the bulk insert fails (e.g. a CHECK
          // constraint on one row), retry one-by-one so good rows
          // still land. Bad rows are logged via onFlush({ kind:'error' }).
          const single = `INSERT INTO ${table} (${cols}) VALUES ${placeholders}`;
          const stmt = db.prepare(single);
          for (const row of rows) {
            try { stmt.run(...row); totalRows += 1; }
            catch (e) {
              try { onFlush?.({ kind: "row_error", error: e?.message, table }); }
              catch { /* observer best-effort */ }
            }
          }
          batches += 1;
        }
      }
      buffer.length = 0;
      stats.flushedRows += totalRows;
      stats.flushedBatches += batches;
      stats.lastFlushAt = Date.now();
      try { onFlush?.({ kind: "ok", rows: totalRows, batches }); }
      catch { /* observer best-effort */ }
      return { flushedRows: totalRows, batches };
    } finally {
      flushing = false;
    }
  }

  function ensureTimer() {
    if (timer) return;
    timer = setInterval(() => {
      try { flushSync(); }
      catch { /* timer must keep running */ }
    }, flushIntervalMs);
    // Don't keep the process alive solely for the flush timer.
    if (typeof timer.unref === "function") timer.unref();
  }

  function enqueue(db, row) {
    if (!db || typeof db.prepare !== "function") throw new Error("enqueue: db handle required");
    if (!Array.isArray(row) || row.length !== columns.length) {
      throw new Error(`enqueue: row must be array of ${columns.length} values`);
    }
    buffer.push({ dbHandle: db, values: row });
    stats.enqueued += 1;
    ensureTimer();
    if (buffer.length >= maxBufferRows) {
      // Soft cap exceeded — flush early to bound memory growth.
      flushSync();
    }
  }

  function close() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    flushSync();
  }

  function snapshot() {
    return {
      bufferDepth: buffer.length,
      flushIntervalMs,
      maxBufferRows,
      ...stats,
    };
  }

  return { enqueue, flush: flushSync, close, snapshot };
}

/**
 * Default singleton for api_usage_log — the canonical heavy-write
 * surface. Production code uses this instance; tests should make
 * their own via `createQuotaCache`.
 */
let _apiUsageCache = null;
export function getApiUsageCache() {
  if (!_apiUsageCache) {
    _apiUsageCache = createQuotaCache({
      table: "api_usage_log",
      columns: [
        "id", "user_id", "api_key_hash", "endpoint", "method",
        "category", "cost", "balance_after", "metadata_json", "created_at",
      ],
    });
    // Best-effort flush on shutdown so an in-flight buffer doesn't
    // silently drop calls. Both signals + a final exit hook.
    const flushOnExit = () => { try { _apiUsageCache?.close(); } catch { /* noop */ } };
    process.once("SIGTERM", flushOnExit);
    process.once("SIGINT", flushOnExit);
    process.once("beforeExit", flushOnExit);
  }
  return _apiUsageCache;
}

/** Test-only: reset the singleton so tests can isolate. */
export function _resetApiUsageCache() {
  if (_apiUsageCache) { try { _apiUsageCache.close(); } catch { /* noop */ } }
  _apiUsageCache = null;
}

/**
 * Helper: produce a stable id for a usage row when the caller hasn't
 * supplied one. Mirrors the existing `uid("usg")` style in api-billing.
 */
export function makeUsageId() {
  return "usg_" + crypto.randomBytes(8).toString("hex");
}
