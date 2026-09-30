// server/lib/pce/pce-metrics.js
//
// PCEBench — empirical metrics: success rate, deterministic coverage, cost per success.

import crypto from "node:crypto";

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pce_metrics'`).get();
  } catch {
    return false;
  }
}

export function recordPceMetric(db, {
  missionId, category = "coding", path, ok, deterministic = false,
  durationMs, filesChanged = 0, testsPassed, qualityScore,
  tokensUsed = 0, humanIntervention = false, recoveryAttempts = 0,
  regression = false, meta = null,
} = {}) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  const id = `pcem_${crypto.randomUUID().slice(0, 12)}`;
  try {
    db.prepare(`
      INSERT INTO pce_metrics
        (id, mission_id, category, path, ok, deterministic, duration_ms, files_changed,
         tests_passed, quality_score, tokens_used, human_intervention, recovery_attempts, regression, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      missionId || null,
      category,
      path || "failed",
      ok ? 1 : 0,
      deterministic ? 1 : 0,
      durationMs ?? null,
      filesChanged,
      testsPassed == null ? null : (testsPassed ? 1 : 0),
      qualityScore ?? null,
      tokensUsed,
      humanIntervention ? 1 : 0,
      recoveryAttempts,
      regression ? 1 : 0,
      meta ? JSON.stringify(meta) : null,
    );
    return { ok: true, id };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function pceMetricsSummary(db, { sinceDays = 30 } = {}) {
  if (!db || !tablesReady(db)) {
    return { ok: false, reason: "migration_required" };
  }
  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
  const rows = db.prepare(`
    SELECT * FROM pce_metrics WHERE created_at >= ? ORDER BY created_at DESC
  `).all(since);

  const total = rows.length;
  const successes = rows.filter((r) => r.ok).length;
  const deterministic = rows.filter((r) => r.deterministic).length;
  const deterministicSuccess = rows.filter((r) => r.ok && r.deterministic).length;
  const llmPath = rows.filter((r) => r.path === "llm").length;
  const regressions = rows.filter((r) => r.regression).length;
  const humanInterventions = rows.filter((r) => r.human_intervention).length;
  const avgDuration = total
    ? rows.reduce((s, r) => s + (r.duration_ms || 0), 0) / total
    : 0;
  const avgQuality = rows.filter((r) => r.quality_score != null).length
    ? rows.filter((r) => r.quality_score != null).reduce((s, r) => s + r.quality_score, 0)
      / rows.filter((r) => r.quality_score != null).length
    : null;

  const tokensTotal = rows.reduce((s, r) => s + (r.tokens_used || 0), 0);
  const costPerSuccess = successes > 0 ? tokensTotal / successes : null;

  return {
    ok: true,
    windowDays: sinceDays,
    total,
    successes,
    failures: total - successes,
    successRate: total ? successes / total : null,
    deterministicCoverage: total ? deterministic / total : null,
    deterministicSuccessRate: deterministic ? deterministicSuccess / deterministic : null,
    llmFallbackRate: total ? llmPath / total : null,
    regressionRate: total ? regressions / total : null,
    humanInterventionRate: total ? humanInterventions / total : null,
    avgDurationMs: Math.round(avgDuration),
    avgQualityScore: avgQuality != null ? Math.round(avgQuality * 1000) / 1000 : null,
    tokensTotal,
    costPerSuccess,
    killerMetric: {
      label: "deterministic_coverage",
      value: total ? deterministic / total : null,
      target: "decrease_llm_dependency_over_time",
    },
  };
}
