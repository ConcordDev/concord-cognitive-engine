// server/lib/pce/deterministic-coverage.js
//
// PCE (Predictable Cognitive Execution) determinism coverage — measures what
// share of DHTP-routed steps resolved via the deterministic `pce_deterministic`
// path (no live LLM call) rather than falling through to a brain invocation.
// Reads the same `dhtp_metrics` table that `dhtp-metrics.js#dhtpMetricsSummary`
// summarizes; this report isolates the deterministic-vs-LLM split specifically.

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dhtp_metrics'`).get();
  } catch {
    return false;
  }
}

/**
 * Report the deterministic ("pce_deterministic") share of DHTP-routed steps
 * over the trailing window.
 */
export function deterministicCoverageReport(db, { sinceDays = 7 } = {}) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;

  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN path = 'pce_deterministic' THEN 1 ELSE 0 END) AS deterministic_count,
      AVG(CASE WHEN path = 'pce_deterministic' THEN task_success END) AS deterministic_success_rate,
      AVG(CASE WHEN path != 'pce_deterministic' THEN task_success END) AS non_deterministic_success_rate
    FROM dhtp_metrics WHERE created_at >= ?
  `).get(since);

  const total = row?.total || 0;
  const deterministicCount = row?.deterministic_count || 0;
  const deterministicCoverage = total > 0 ? deterministicCount / total : 0;

  return {
    ok: true,
    windowDays: sinceDays,
    total,
    deterministicCount,
    nonDeterministicCount: total - deterministicCount,
    deterministicCoverage,
    deterministicSuccessRate: row?.deterministic_success_rate ?? null,
    nonDeterministicSuccessRate: row?.non_deterministic_success_rate ?? null,
  };
}
