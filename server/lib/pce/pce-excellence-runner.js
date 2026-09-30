// server/lib/pce/pce-excellence-runner.js
//
// Full excellence cycle — all suites + learning + regression + delta tracking.

import crypto from "node:crypto";
import { runConcordBench, runBenchSuite } from "./concord-bench.js";
import { BENCH_SUITES, ALL_BENCH_CASE_COUNT } from "./bench-registry.js";
import { runLearningPipeline } from "./learning-pipeline.js";
import { deterministicCoverageReport } from "./deterministic-coverage.js";
import { proposePatternsFromFailures } from "./pattern-promotion.js";
import { seedConcordCorpus } from "./concord-corpus.js";
import { seedProvenBenchPatterns } from "./concord-bench-patterns.js";
import { buildConcordBenchReport } from "./concord-bench-report.js";
import { analyzeBenchmarkGaps } from "./pce-improvement-cycle.js";
import { runDhtpPolicyLearningCycle } from "../runtime/dhtp-policy-learner.js";

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pce_excellence_runs'`).get();
  } catch {
    return false;
  }
}

function runId() {
  return `per_${crypto.randomUUID().slice(0, 12)}`;
}

function lastExcellenceRun(db) {
  if (!tablesReady(db)) return null;
  return db.prepare(`
    SELECT * FROM pce_excellence_runs ORDER BY created_at DESC LIMIT 1
  `).get();
}

function persistExcellenceRun(db, payload) {
  if (!tablesReady(db)) return null;
  const id = runId();
  db.prepare(`
    INSERT INTO pce_excellence_runs
      (id, pass_rate, deterministic_coverage, llm_fallback_rate, total_cases, passed, failed,
       promoted, rejected, delta_pass_rate, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    payload.passRate,
    payload.deterministicCoverage,
    payload.llmFallbackRate,
    payload.total,
    payload.passed,
    payload.failed,
    payload.promoted || 0,
    payload.rejected || 0,
    payload.deltaPassRate,
    JSON.stringify(payload),
  );
  return id;
}

/**
 * Run all benchmark suites (core + engineering + adversarial).
 */
export async function runAllBenchSuites(db, { concordRoot, suiteIds } = {}) {
  const ids = suiteIds || Object.keys(BENCH_SUITES);
  const suites = {};
  const allResults = [];

  for (const suiteId of ids) {
    const r = await runBenchSuite(db, suiteId, { concordRoot });
    suites[suiteId] = r;
    for (const result of r.results || []) {
      allResults.push({ ...result, suite: suiteId });
    }
  }

  const passed = allResults.filter((r) => r.ok).length;
  const total = allResults.length;

  return {
    ok: passed === total,
    suites,
    total,
    passed,
    failed: total - passed,
    passRate: total ? passed / total : 0,
    results: allResults,
    gaps: allResults.filter((r) => !r.ok).map((r) => ({
      caseId: r.caseId,
      suite: r.suite,
      category: r.category,
      failureClass: r.failureClass,
      reason: r.result?.reason || r.reason,
    })),
  };
}

/**
 * Full PCE excellence cycle — benchmark → learn → regress → promote → measure delta.
 */
export async function runPceExcellenceCycle({ db, concordRoot, suiteIds, skipLearning = false } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  seedConcordCorpus(db);
  seedProvenBenchPatterns(db);
  const started = Date.now();
  const prev = lastExcellenceRun(db);

  const bench = await runAllBenchSuites(db, { concordRoot, suiteIds });
  const gapAnalysis = analyzeBenchmarkGaps({
    gaps: bench.gaps,
    failureClasses: bench.gaps.reduce((acc, g) => {
      const fc = g.failureClass || "unknown";
      acc[fc] = (acc[fc] || 0) + 1;
      return acc;
    }, {}),
    passRate: bench.passRate,
  });

  let learning = null;
  if (!skipLearning) {
    learning = await runLearningPipeline(db, {
      benchResults: bench.results,
      concordRoot,
      suite: "all_suites",
    });
  } else {
    const proposals = proposePatternsFromFailures(db);
    learning = { ok: true, skipped: true, proposals };
  }

  const detReport = deterministicCoverageReport(db, { sinceDays: 7 });
  const report = buildConcordBenchReport(db, { sinceDays: 7 });
  const dhtpLearning = runDhtpPolicyLearningCycle(db, { sinceDays: 14 });

  const prevPassRate = prev?.pass_rate ?? null;
  const deltaPassRate = prevPassRate != null ? bench.passRate - prevPassRate : null;

  const payload = {
    passRate: bench.passRate,
    deterministicCoverage: detReport.deterministicCoverage,
    llmFallbackRate: detReport.llmRate,
    total: bench.total,
    passed: bench.passed,
    failed: bench.failed,
    promoted: learning?.promoted?.length || 0,
    rejected: learning?.blocked?.length || 0,
    deltaPassRate,
    bench,
    gapAnalysis,
    learning,
    dhtpLearning,
    detReport,
    report,
    durationMs: Date.now() - started,
    catalogSize: ALL_BENCH_CASE_COUNT,
  };

  const runRecordId = persistExcellenceRun(db, payload);

  return {
    ok: bench.passRate >= (Number(process.env.PCE_EXCELLENCE_MIN_PASS_RATE) || 0.75),
    cycle: "pce_excellence",
    runId: runRecordId,
    durationMs: payload.durationMs,
    passRate: bench.passRate,
    deltaPassRate,
    previousPassRate: prevPassRate,
    total: bench.total,
    passed: bench.passed,
    failed: bench.failed,
    catalogSize: ALL_BENCH_CASE_COUNT,
    suites: Object.fromEntries(
      Object.entries(bench.suites).map(([k, v]) => [k, {
        total: v.total,
        passed: v.passed,
        passRate: v.passRate,
      }]),
    ),
    deterministicCoverage: detReport.deterministicCoverage,
    llmFallbackRate: detReport.llmRate,
    killerMetrics: {
      passRate: bench.passRate,
      deterministicCoverage: detReport.deterministicCoverage,
      deltaPassRate,
      regressionBlocked: learning?.blocked?.length || 0,
    },
    learning: {
      gapsProcessed: learning?.gapsProcessed || 0,
      promoted: learning?.promoted || [],
      blocked: learning?.blocked || [],
      demoted: learning?.demoted || [],
    },
    gapAnalysis,
    dhtpLearning,
    report,
    nextActions: gapAnalysis.priorities?.slice(0, 5) || [],
  };
}

export function excellenceRunHistory(db, { limit = 20 } = {}) {
  if (!tablesReady(db)) return { ok: false, reason: "migration_required" };
  const rows = db.prepare(`
    SELECT id, pass_rate, deterministic_coverage, llm_fallback_rate,
           total_cases, passed, failed, promoted, rejected, delta_pass_rate, created_at
    FROM pce_excellence_runs ORDER BY created_at DESC LIMIT ?
  `).all(limit);

  return {
    ok: true,
    runs: rows,
    trend: rows.length >= 2
      ? {
          passRateDelta: rows[0].pass_rate - rows[1].pass_rate,
          latest: rows[0].pass_rate,
          prior: rows[1].pass_rate,
        }
      : null,
  };
}
