// server/lib/pce/pce-improvement-cycle.js
//
// Ouroboros loop: benchmark → find gaps → propose patterns → promote/demote → repeat.

import { runConcordBench } from "./concord-bench.js";
import { runPceBench } from "./pce-bench.js";
import { pceMetricsSummary } from "./pce-metrics.js";
import {
  proposePatternsFromFailures,
  getTopFailureSignatures,
} from "./pattern-promotion.js";
import { seedConcordCorpus } from "./concord-corpus.js";
import { seedProvenBenchPatterns, fillGapsFromProvenPatterns } from "./concord-bench-patterns.js";
import { buildConcordBenchReport } from "./concord-bench-report.js";
import { runPceExcellenceCycle } from "./pce-excellence-runner.js";
import { runLearningPipeline } from "./learning-pipeline.js";
import { runPatternLifecyclePass } from "./pattern-promotion.js";

/**
 * Analyze benchmark gaps and map to capability priorities.
 */
export function analyzeBenchmarkGaps(benchResult) {
  const gaps = benchResult?.gaps || [];
  const priorities = [];

  const classCounts = benchResult?.failureClasses || {};
  for (const [klass, count] of Object.entries(classCounts)) {
    priorities.push({
      failureClass: klass,
      count,
      action: klass === "missing_pattern"
        ? "add_deterministic_pattern"
        : klass === "verification"
          ? "strengthen_verification_gate"
          : klass === "transform"
            ? "improve_transform_primitive"
            : "investigate",
    });
  }

  if (!priorities.length && gaps.length) {
    const byClass = {};
    for (const g of gaps) {
      const fc = g.failureClass || "unknown";
      byClass[fc] = (byClass[fc] || 0) + 1;
    }
    for (const [klass, count] of Object.entries(byClass)) {
      priorities.push({
        failureClass: klass,
        count,
        action: klass === "missing_pattern" ? "add_deterministic_pattern" : "investigate",
      });
    }
  }

  return {
    ok: true,
    gapCount: gaps.length,
    gaps,
    priorities: priorities.sort((a, b) => b.count - a.count),
    passRate: benchResult?.passRate,
  };
}

/**
 * Full improvement cycle — delegates to excellence runner when migration 434 present.
 */
export async function runPceImprovementCycle({ db, concordRoot, runToyBench = false, fullSurface = true } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  const hasLearning = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pce_excellence_runs'`).get();

  if (fullSurface && hasLearning) {
    const excellence = await runPceExcellenceCycle({ db, concordRoot });
    let toyBench = null;
    if (runToyBench) {
      toyBench = await runPceBench(db, {
        categories: ["bug_repair", "security_repair"],
        repoRoot: concordRoot,
      });
    }
    return {
      ...excellence,
      cycle: "pce_improvement",
      concordBench: {
        total: excellence.total,
        passed: excellence.passed,
        failed: excellence.failed,
        passRate: excellence.passRate,
        suites: excellence.suites,
      },
      toyBench: toyBench ? { passRate: toyBench.passRate, passed: toyBench.passed, total: toyBench.total } : null,
      learning: excellence.learning,
      metrics: {
        deterministicCoverage: excellence.deterministicCoverage,
        llmFallbackRate: excellence.llmFallbackRate,
        killerMetric: excellence.killerMetrics,
      },
    };
  }

  seedConcordCorpus(db);
  seedProvenBenchPatterns(db);
  const started = Date.now();

  const concordBench = await runConcordBench(db, { concordRoot });
  const gapAnalysis = analyzeBenchmarkGaps(concordBench);
  const gapFill = fillGapsFromProvenPatterns(db, concordBench.gaps);

  let toyBench = null;
  if (runToyBench) {
    toyBench = await runPceBench(db, {
      categories: ["bug_repair", "security_repair"],
      repoRoot: concordRoot,
    });
  }

  const proposals = proposePatternsFromFailures(db);
  const lifecycle = await runPatternLifecyclePass(db, { concordRoot });
  const learning = await runLearningPipeline(db, {
    benchResults: concordBench.results,
    concordRoot,
    suite: "concord_core",
  });
  const metrics = pceMetricsSummary(db, { sinceDays: 7 });
  const report = buildConcordBenchReport(db, { sinceDays: 7 });
  const topFailures = getTopFailureSignatures(db, { limit: 5 });

  return {
    ok: concordBench.ok,
    cycle: "pce_improvement",
    durationMs: Date.now() - started,
    concordBench: {
      total: concordBench.total,
      passed: concordBench.passed,
      failed: concordBench.failed,
      passRate: concordBench.passRate,
      byCategory: concordBench.byCategory,
    },
    toyBench: toyBench ? { passRate: toyBench.passRate, passed: toyBench.passed, total: toyBench.total } : null,
    gapAnalysis,
    learning: {
      provenPatternsSeeded: gapFill.seeded?.length || 0,
      proposalsCreated: proposals.proposals?.length || 0,
      patternsPromoted: lifecycle.promoted?.length || 0,
      patternsBlocked: lifecycle.blocked?.length || 0,
      patternsDemoted: lifecycle.demoted?.length || 0,
      pipeline: learning,
      topFailureSignatures: topFailures.map((s) => ({
        hash: s.signature_hash,
        occurrences: s.occurrences,
        patternId: s.pattern_id,
      })),
    },
    report,
    metrics: metrics.ok ? {
      deterministicCoverage: metrics.deterministicCoverage,
      successRate: metrics.successRate,
      llmFallbackRate: metrics.llmFallbackRate,
      killerMetric: metrics.killerMetric,
    } : null,
    nextActions: gapAnalysis.priorities.slice(0, 5),
  };
}
