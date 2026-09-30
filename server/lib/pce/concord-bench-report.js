// server/lib/pce/concord-bench-report.js
//
// Formatted empirical report for Dila onboarding and mission outcomes.

import { concordBenchHistory } from "./concord-bench.js";
import { pceMetricsSummary } from "./pce-metrics.js";
import { getTopFailureSignatures } from "./pattern-promotion.js";

export function buildConcordBenchReport(db, { sinceDays = 7 } = {}) {
  const history = concordBenchHistory(db, { sinceDays });
  const metrics = pceMetricsSummary(db, { sinceDays });
  const failures = getTopFailureSignatures(db, { limit: 5, minOccurrences: 2 });

  const passRate = history.ok ? history.passRate : null;
  const grade = passRate == null ? "unknown"
    : passRate >= 0.95 ? "excellent"
      : passRate >= 0.85 ? "good"
        : passRate >= 0.7 ? "needs_work"
          : "critical";

  return {
    ok: true,
    grade,
    passRate,
    history: history.ok ? {
      total: history.total,
      passed: history.passed,
      failed: history.failed,
      topFailureClasses: history.topFailureClasses,
    } : null,
    metrics: metrics.ok ? {
      deterministicCoverage: metrics.deterministicCoverage,
      successRate: metrics.successRate,
      llmFallbackRate: metrics.llmFallbackRate,
      killerMetric: metrics.killerMetric,
    } : null,
    recurringFailures: failures.map((f) => ({
      hash: f.signature_hash,
      occurrences: f.occurrences,
      patternId: f.pattern_id,
    })),
    recommendations: buildRecommendations(history, metrics, failures),
  };
}

function buildRecommendations(history, metrics, failures) {
  const recs = [];
  if (history.ok && history.passRate != null && history.passRate < 0.9) {
    recs.push({
      priority: "high",
      action: "run_pce_improvement_cycle",
      reason: `ConcordBench pass rate ${(history.passRate * 100).toFixed(1)}% below 90% target`,
    });
  }
  for (const fc of history.topFailureClasses || []) {
    if (fc.klass === "missing_pattern") {
      recs.push({
        priority: "high",
        action: "seed_proven_bench_patterns",
        reason: `${fc.count} failures from missing deterministic patterns`,
      });
    }
  }
  if (metrics.ok && metrics.llmFallbackRate > 0.3) {
    recs.push({
      priority: "medium",
      action: "expand_concord_corpus",
      reason: `LLM fallback rate ${(metrics.llmFallbackRate * 100).toFixed(1)}% — add patterns`,
    });
  }
  if (failures.length > 0) {
    recs.push({
      priority: "medium",
      action: "review_failure_signatures",
      reason: `${failures.length} recurring failure signatures need pattern proposals`,
    });
  }
  return recs.slice(0, 5);
}
