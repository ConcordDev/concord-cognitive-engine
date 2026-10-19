// server/lib/sqlite-stats-refresh.js
//
// INC-100: refresh stale query-planner statistics, one table at a time.
//
// sqlite_stat1 on the live concord.db was written by an ANALYZE run when the
// tables were small and never refreshed. On 2026-10-19 it said
// emergent_communications had 2 rows (real: 844k), brain_interactions 4
// (real: 5M by rowid), inference_spans 8 (15M), and 22 more large tables were
// off by 50x or more. Trusting those numbers the planner picks a full SCAN
// over an index that exists, e.g. idle-behavior.js recentCommunicationCount:
// SCAN emergent_communications ~50 ms per call instead of ~0.1 ms through
// idx_comm_from. MinorAgentScheduler.tickAll runs a batch of agent ticks via
// Array.map, so ~70 of those scans ran back to back and held the event loop
// for ~3.5 s (the recurring event_loop_lag_spike, caught in a CPU profile at
// 2026-10-19T12:05:58Z).
//
// The boot-time `PRAGMA optimize` never fixed this: plain optimize only
// considers tables the connection has already queried, and at boot it has
// queried none. This module finds tables whose rowid high-water mark is far
// above the row count recorded in sqlite_stat1 and re-ANALYZEs just those,
// with analysis_limit so each ANALYZE samples a bounded number of rows, and
// yields between tables so no single step holds the loop for long.
//
// Never throws.

const yieldMs = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });
const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * Tables whose sqlite_stat1 row estimate is stale.
 * @returns {{ tbl: string, est: number, rows: number }[]}
 */
export function findStaleStatTables(db, { minRows = 10_000, ratio = 10 } = {}) {
  let stats;
  try {
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_stat1'").get();
    if (!has) return [];
    stats = db.prepare("SELECT tbl, max(CAST(stat AS INTEGER)) AS est FROM sqlite_stat1 GROUP BY tbl").all();
  } catch {
    return [];
  }
  const stale = [];
  for (const { tbl, est } of stats) {
    let rows = 0;
    try {
      // max(rowid) is an O(log n) btree seek; it is an upper bound on the row
      // count, which is all a "grew by 10x" check needs. WITHOUT ROWID tables
      // throw here and are skipped.
      rows = Number(db.prepare(`SELECT max(rowid) AS n FROM ${quoteIdent(tbl)}`).get()?.n) || 0;
    } catch {
      continue;
    }
    const e = Number(est) || 0;
    if (rows >= minRows && rows > ratio * Math.max(e, 1)) stale.push({ tbl, est: e, rows });
  }
  return stale;
}

/**
 * Re-ANALYZE stale tables one at a time.
 * @returns {Promise<{ ok: boolean, checked?: number, refreshed?: {tbl: string, ms: number}[], error?: string }>}
 */
export async function refreshStaleStats(db, { minRows = 10_000, ratio = 10, analysisLimit = 400, pauseMs = 50, maxTables = 100 } = {}) {
  if (!db) return { ok: false, error: "no_db" };
  let prevLimit = 0;
  try {
    const stale = findStaleStatTables(db, { minRows, ratio }).slice(0, maxTables);
    if (stale.length === 0) return { ok: true, checked: 0, refreshed: [] };
    try { prevLimit = Number(db.pragma("analysis_limit", { simple: true })) || 0; } catch { /* older sqlite */ }
    const refreshed = [];
    for (const { tbl } of stale) {
      await yieldMs(pauseMs);
      try {
        db.pragma(`analysis_limit = ${Math.max(0, Math.floor(analysisLimit))}`);
        const t0 = Date.now();
        db.exec(`ANALYZE ${quoteIdent(tbl)}`);
        refreshed.push({ tbl, ms: Date.now() - t0 });
      } catch { /* table busy or gone — next run retries */ }
    }
    return { ok: true, checked: stale.length, refreshed };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    try { db.pragma(`analysis_limit = ${prevLimit}`); } catch { /* ignore */ }
  }
}
