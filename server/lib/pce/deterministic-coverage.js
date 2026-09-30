// server/lib/pce/deterministic-coverage.js
//
// Measure how much of each solution required LLM vs deterministic path.

import { recordPceMetric } from "./pce-metrics.js";

/**
 * Classify a coding pipeline / PCE result by reasoning path.
 */
export function classifySolutionPath(result = {}) {
  if (result.path === "deterministic" || result.deterministic === true) {
    return {
      llmRequired: false,
      deterministicScore: 1.0,
      path: "deterministic",
      label: "fully_deterministic",
    };
  }
  if (result.path === "llm" || result.requiresLlm || result.reason === "requires_llm") {
    const tokens = result.worker?.tokensIn || result.tokensUsed || 0;
    return {
      llmRequired: true,
      deterministicScore: 0.0,
      path: "llm",
      label: "llm_required",
      tokensUsed: tokens + (result.worker?.tokensOut || 0),
    };
  }
  if (result.path === "hybrid") {
    return {
      llmRequired: true,
      deterministicScore: 0.4,
      path: "hybrid",
      label: "hybrid",
    };
  }
  if (result.ok === false && result.reason === "requires_llm") {
    return { llmRequired: true, deterministicScore: 0.0, path: "llm", label: "llm_fallback_needed" };
  }
  if (result.mode === "deterministic" || result.mode === "compositional") {
    return { llmRequired: false, deterministicScore: 0.9, path: "deterministic", label: "pattern_matched" };
  }
  return { llmRequired: null, deterministicScore: 0.5, path: "unknown", label: "unknown" };
}

export function recordDeterministicOutcome(db, {
  missionId, category, result, durationMs, caseId,
} = {}) {
  const classified = classifySolutionPath(result);
  recordPceMetric(db, {
    missionId,
    category: category || "coding",
    path: classified.path === "deterministic" ? "deterministic" : classified.path === "llm" ? "llm" : "hybrid",
    ok: result?.ok !== false,
    deterministic: !classified.llmRequired,
    durationMs,
    tokensUsed: classified.tokensUsed || 0,
    meta: {
      caseId,
      deterministicScore: classified.deterministicScore,
      label: classified.label,
      llmRequired: classified.llmRequired,
    },
  });
  return classified;
}

/**
 * Aggregate deterministic coverage from recent metrics.
 */
export function deterministicCoverageReport(db, { sinceDays = 7 } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT path, ok, deterministic, tokens_used, meta_json FROM pce_metrics
      WHERE created_at >= ? AND (category LIKE 'concord_bench%' OR category LIKE 'bench_%')
    `).all(since);
  } catch {
    return { ok: false, reason: "migration_required" };
  }

  const total = rows.length;
  const deterministic = rows.filter((r) => r.deterministic).length;
  const llm = rows.filter((r) => r.path === "llm").length;
  const tokensTotal = rows.reduce((s, r) => s + (r.tokens_used || 0), 0);

  let avgDetScore = 0;
  let scored = 0;
  for (const r of rows) {
    try {
      const meta = JSON.parse(r.meta_json || "{}");
      if (meta.deterministicScore != null) {
        avgDetScore += meta.deterministicScore;
        scored += 1;
      }
    } catch { /* optional */ }
  }

  return {
    ok: true,
    windowDays: sinceDays,
    total,
    deterministicCoverage: total ? deterministic / total : null,
    llmRate: total ? llm / total : null,
    avgDeterministicScore: scored ? avgDetScore / scored : null,
    tokensTotal,
    killerMetric: {
      label: "deterministic_coverage",
      value: total ? deterministic / total : null,
      target: "maximize_without_regression",
    },
  };
}
