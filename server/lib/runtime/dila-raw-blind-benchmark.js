// server/lib/runtime/dila-raw-blind-benchmark.js
//
// Dila-vs-Raw blind benchmark — same missions, isolated paths, independent evaluator.
// Paths A–E isolate DHTP contribution; RAW (A) vs Full Dila (E) is the headline.

import crypto from "node:crypto";
import { seedBenchDtuCorpus } from "./cognitive-savings-ledger.js";
import { runCognitiveMissionIteration } from "./cognitive-mission-bench.js";
import { getMission } from "../mission-runtime.js";
import {
  BLIND_BENCHMARK_PATHS,
  getBlindPathConfig,
  resolvePricingConfig,
} from "./cognitive-economics.js";
import {
  captureMissionOutput,
  gatherObjectiveVerification,
  evaluateBlindSubmission,
  evaluateSweBlindSubmission,
  compareBlindEvaluations,
  efficiencyMetricsFromMission,
} from "./blind-evaluator.js";
import {
  buildSegmentedClaims,
  assessPublishability,
  projectMonthlySavings,
  buildCommercialThreeWay,
} from "./claim-methodology.js";
import { buildMoatSummary } from "./information-path-analysis.js";
import { POSITIONING, PRIMARY_METRIC } from "./dila-benchmark-manifest.js";
import {
  seedBilledTelemetryFromLedger,
  aggregateBilledTelemetry,
} from "./provider-billing.js";
import {
  runCounterfactualPolicyBattery,
  persistCounterfactualTest,
} from "./counterfactual-context.js";
import { runSweHarness, SWE_MINI_CASES } from "./swe-harness.js";
import {
  runMemoryBenchmark,
  evaluateMemoryBlindSubmission,
  MEMORY_BENCHMARK_CASES,
} from "./memory-benchmark.js";

export const BLIND_WORKLOADS = Object.freeze([
  {
    id: "cognitive_probe",
    template: "cognitive_probe",
    variantTemplate: "cognitive_probe_variant",
    maxTicks: 12,
    verifyDelta: { requireAction: "analyze" },
  },
  {
    id: "semantic_vitals",
    template: "dgb_semantic_vitals",
    variantTemplate: null,
    maxTicks: 12,
    verifyDelta: { requireAction: "analyze", rationalePattern: "ledger" },
  },
  {
    id: "compose_audit",
    template: "dgb_compose_audit",
    variantTemplate: null,
    maxTicks: 16,
    verifyDelta: { requireAction: "analyze" },
  },
  {
    id: "swe_mini",
    kind: "swe",
    caseIds: SWE_MINI_CASES.map((c) => c.id),
    verifyDelta: null,
  },
  {
    id: "memory_locomo",
    kind: "memory",
    caseIds: MEMORY_BENCHMARK_CASES.map((c) => c.id),
    verifyDelta: null,
  },
]);

function benchRunId() {
  return `drb_${crypto.randomUUID().slice(0, 12)}`;
}

function anonymizeSubmission() {
  return `sub_${crypto.randomUUID().slice(0, 10)}`;
}

/**
 * Run LoCoMo-style memory benchmark as a blind workload.
 */
export async function runBlindMemoryWorkload({ db, pathId, workload } = {}) {
  const memoryResult = runMemoryBenchmark(db, {
    caseIds: workload?.caseIds || MEMORY_BENCHMARK_CASES.map((c) => c.id),
  });

  const evaluation = evaluateMemoryBlindSubmission({
    submissionId: anonymizeSubmission(),
    task: { workloadId: workload?.id || "memory_locomo", kind: "memory" },
    memoryResult,
    efficiencyMetrics: { tokens: 0, latency: 0, cost: 0 },
  });

  return {
    ok: memoryResult.ok,
    pathId,
    workloadId: workload?.id || "memory_locomo",
    missionId: null,
    memoryResult,
    objective: evaluation.objectiveSignals,
    efficiency: { tokens: 0, latency: 0, cost: 0, billingMode: "n/a" },
    evaluation,
    metrics: null,
    generalizationResult: null,
  };
}

/**
 * Run SWE mini harness as a blind workload (objective test verification).
 */
export async function runBlindSweWorkload({ db, pathId, workload } = {}) {
  const sweResult = await runSweHarness({
    db,
    caseIds: workload?.caseIds || SWE_MINI_CASES.map((c) => c.id),
  });

  const evaluation = evaluateSweBlindSubmission({
    submissionId: anonymizeSubmission(),
    task: { workloadId: workload?.id || "swe_mini", kind: "swe" },
    sweResult,
    efficiencyMetrics: { tokens: 0, latency: 0, cost: 0 },
  });

  return {
    ok: sweResult.ok,
    pathId,
    workloadId: workload?.id || "swe_mini",
    missionId: null,
    sweResult,
    objective: evaluation.objectiveSignals,
    efficiency: { tokens: 0, latency: 0, cost: 0, billingMode: "n/a" },
    evaluation,
    metrics: null,
    generalizationResult: null,
  };
}

/**
 * Run counterfactual context tests using a sample mission context.
 */
export async function runBlindCounterfactualBattery({
  db,
  dispatchMCP,
  pathId,
  persist = true,
} = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  const sample = await runCognitiveMissionIteration({
    db,
    dispatchMCP,
    template: "cognitive_probe",
    maxTicks: 8,
    spawnContext: { blindPath: pathId || "E", econPath: pathId || "E" },
  });

  const mission = getMission(db, sample.missionId);
  const battery = runCounterfactualPolicyBattery({
    mission,
    step: { tool: "cognitive_delta_execute" },
    stepIndex: 0,
    route: { taskClass: "cognitive_probe" },
    ledger: [],
    lessons: [],
    recallPack: { ok: true, recent: [], pinned: [], identity_present: false },
    context: {},
    db,
  });

  if (persist && battery.overall) {
    persistCounterfactualTest(db, {
      ruleId: `blind_${pathId || "E"}_overall`,
      field: null,
      taskClass: "cognitive_probe",
      result: battery.overall,
    });
    for (const field of battery.perField || []) {
      persistCounterfactualTest(db, {
        ruleId: `blind_${pathId || "E"}_${field.field}`,
        field: field.field,
        taskClass: "cognitive_probe",
        result: {
          ok: true,
          full: { tokens: 0, quality: 1 },
          compressed: { tokens: 0, quality: 1 - (field.qualityDelta || 0) },
          qualityDelta: field.qualityDelta,
          tokenSavingsPct: field.tokenSavingsPct,
          promoted: field.promoted,
          rejected: !field.promoted,
          reason: field.reason,
        },
      });
    }
  }

  return {
    ok: battery.overall?.promoted ?? false,
    pathId: pathId || "E",
    missionId: sample.missionId,
    battery,
  };
}

/**
 * Apply blind path env overrides for one mission run.
 */
async function withBlindPath(pathId, fn, { minCacheUses } = {}) {
  const path = getBlindPathConfig(pathId);
  if (!path) throw new Error(`unknown_blind_path:${pathId}`);

  const prevPath = process.env.COGNITIVE_BLIND_PATH;
  const prevEconPath = process.env.COGNITIVE_ECON_PATH;
  const prevMinUses = process.env.COGNITIVE_CACHE_MIN_USES;
  const prevRecovery = process.env.CONCORD_MISSION_RECOVERY;

  process.env.COGNITIVE_BLIND_PATH = pathId;
  process.env.COGNITIVE_ECON_PATH = pathId;

  if (minCacheUses != null) {
    process.env.COGNITIVE_CACHE_MIN_USES = String(minCacheUses);
  } else if (!path.mission.enableCache) {
    process.env.COGNITIVE_CACHE_MIN_USES = "999999";
  } else {
    process.env.COGNITIVE_CACHE_MIN_USES = "1";
  }

  if (!path.mission.enableRecovery) {
    process.env.CONCORD_MISSION_RECOVERY = "0";
  }

  try {
    return await fn(path);
  } finally {
    if (prevPath === undefined) delete process.env.COGNITIVE_BLIND_PATH;
    else process.env.COGNITIVE_BLIND_PATH = prevPath;
    if (prevEconPath === undefined) delete process.env.COGNITIVE_ECON_PATH;
    else process.env.COGNITIVE_ECON_PATH = prevEconPath;
    if (prevMinUses === undefined) delete process.env.COGNITIVE_CACHE_MIN_USES;
    else process.env.COGNITIVE_CACHE_MIN_USES = prevMinUses;
    if (prevRecovery === undefined) delete process.env.CONCORD_MISSION_RECOVERY;
    else process.env.CONCORD_MISSION_RECOVERY = prevRecovery;
  }
}

/**
 * Run one workload on one blind path — capture output + metrics.
 */
export async function runBlindPathWorkload({
  db,
  dispatchMCP,
  pathId,
  workload,
  minCacheUses,
} = {}) {
  if (!db || !workload) return { ok: false, reason: "invalid_args" };

  if (workload.kind === "swe") {
    return withBlindPath(pathId, async () => runBlindSweWorkload({ db, pathId, workload }), { minCacheUses });
  }

  if (workload.kind === "memory") {
    return withBlindPath(pathId, async () => runBlindMemoryWorkload({ db, pathId, workload }), { minCacheUses });
  }

  return withBlindPath(pathId, async () => {
    const mission = await runCognitiveMissionIteration({
      db,
      dispatchMCP,
      template: workload.template,
      maxTicks: workload.maxTicks || 12,
      spawnContext: { blindPath: pathId, econPath: pathId },
    });

    let generalizationResult = null;
    if (workload.variantTemplate) {
      const variant = await runCognitiveMissionIteration({
        db,
        dispatchMCP,
        template: workload.variantTemplate,
        maxTicks: workload.maxTicks || 12,
        spawnContext: { blindPath: pathId, econPath: pathId },
      });
      const variantObjective = gatherObjectiveVerification(db, variant.missionId, {
        verifyDelta: workload.verifyDelta,
        metrics: variant.metrics,
      });
      generalizationResult = {
        variantCompleted: variant.ok,
        variantVerified: variantObjective.deltaVerified && variant.ok,
        variantMissionId: variant.missionId,
      };
    }

    const output = captureMissionOutput(db, mission.missionId);
    const objective = gatherObjectiveVerification(db, mission.missionId, {
      verifyDelta: workload.verifyDelta,
      metrics: mission.metrics,
    });

    const pricing = resolvePricingConfig();
    const econMode = pricing.mode || process.env.COGNITIVE_ECON_MODE || "estimated";
    if (econMode === "billed") {
      const realBilling = db.prepare(`
        SELECT COUNT(*) AS c FROM provider_billing_telemetry
        WHERE mission_id = ? AND billing_source = 'provider'
      `).get(mission.missionId)?.c || 0;
      if (!realBilling) {
        seedBilledTelemetryFromLedger(db, {
          missionId: mission.missionId,
          path: pathId,
          pricing,
        });
      }
    }

    const efficiency = efficiencyMetricsFromMission(mission.metrics, pricing, {
      db,
      missionId: mission.missionId,
      pathId,
    });

    const evaluation = evaluateBlindSubmission({
      submissionId: anonymizeSubmission(),
      task: { workloadId: workload.id, template: workload.template, goal: output.task?.goal },
      output,
      objectiveVerification: objective,
      efficiencyMetrics: efficiency,
      generalizationResult,
    });

    return {
      ok: mission.ok,
      pathId,
      workloadId: workload.id,
      missionId: mission.missionId,
      output,
      objective,
      efficiency,
      evaluation,
      metrics: mission.metrics,
      generalizationResult,
    };
  }, { minCacheUses });
}

/**
 * Run all workloads on one path — aggregate blind scores.
 */
export async function runBlindPathSuite({
  db,
  dispatchMCP,
  pathId,
  workloads = BLIND_WORKLOADS,
  minCacheUses,
} = {}) {
  const path = getBlindPathConfig(pathId);
  if (!path) return { ok: false, reason: "invalid_path" };

  const runs = [];
  let counterfactual = null;
  for (const workload of workloads) {
    runs.push(await runBlindPathWorkload({
      db, dispatchMCP, pathId, workload, minCacheUses,
    }));
    if (!counterfactual && workload.kind !== "swe") {
      counterfactual = await runBlindCounterfactualBattery({
        db, dispatchMCP, pathId, persist: true,
      });
    }
  }

  const tierCounts = counterfactual?.battery?.overall?.compressed?.tierCounts || {};

  const evaluations = runs.map((r) => r.evaluation).filter((e) => e?.ok);
  const n = evaluations.length || 1;

  const avgDimensions = {
    correctness: evaluations.reduce((s, e) => s + e.dimensions.correctness, 0) / n,
    verification: evaluations.reduce((s, e) => s + e.dimensions.verification, 0) / n,
    quality: evaluations.reduce((s, e) => s + e.dimensions.quality, 0) / n,
    generalization: evaluations.reduce((s, e) => s + e.dimensions.generalization, 0) / n,
    efficiency: evaluations.reduce((s, e) => s + e.dimensions.efficiency, 0) / n,
  };

  const totalTokens = runs.reduce((s, r) => s + (r.efficiency?.tokens || 0), 0);
  const totalLatency = runs.reduce((s, r) => s + (r.efficiency?.latency || 0), 0);
  const totalCost = runs.reduce((s, r) => s + (r.efficiency?.cost || 0), 0);
  const billedAgg = aggregateBilledTelemetry(db, { path: pathId });
  const successes = runs.filter((r) => r.ok).length;
  const regressions = evaluations.reduce((s, e) => s + e.regressionRate, 0);
  const humanInterventions = evaluations.reduce((s, e) => s + e.humanInterventionRate, 0);

  return {
    ok: successes >= workloads.length * 0.9,
    pathId,
    label: path.label,
    description: path.description,
    stack: path.stack,
    runs,
    aggregate: {
      missions: runs.length,
      successes,
      successRate: successes / runs.length,
      avgComposite: evaluations.reduce((s, e) => s + e.composite, 0) / n,
      avgDimensions,
      totalTokens,
      avgTokens: totalTokens / runs.length,
      totalLatencyMs: totalLatency,
      avgLatencyMs: totalLatency / runs.length,
      totalCostUsd: totalCost,
      avgCostUsd: totalCost / runs.length,
      billedTelemetry: billedAgg.ok ? billedAgg : null,
      regressionRate: regressions / runs.length,
      humanInterventionRate: humanInterventions / runs.length,
    },
    counterfactual,
    cognitiveCompilerTiers: tierCounts,
  };
}

/**
 * Full Dila-vs-Raw blind benchmark with DHTP path isolation (A–E).
 */
export async function runDilaRawBlindBenchmark({
  db,
  dispatchMCP,
  paths = ["A", "B", "C", "D", "E"],
  workloads = BLIND_WORKLOADS,
  minCacheUses = 1,
  pricing,
} = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  const runId = benchRunId();
  const started = Date.now();
  const priceConfig = pricing || resolvePricingConfig();

  seedBenchDtuCorpus(db, { count: 50 });

  const pathSuites = [];
  for (const pathId of paths) {
    pathSuites.push(await runBlindPathSuite({
      db,
      dispatchMCP,
      pathId,
      workloads,
      minCacheUses: pathId === "E" ? minCacheUses : undefined,
    }));
  }

  const rawSuite = pathSuites.find((s) => s.pathId === "A");
  const dilaSuite = pathSuites.find((s) => s.pathId === "E");

  const rawBaseline = rawSuite ? {
    tokens: rawSuite.aggregate.avgTokens,
    latency: rawSuite.aggregate.avgLatencyMs,
    cost: rawSuite.aggregate.avgCostUsd,
  } : null;

  const headToHeadComparisons = [];
  if (rawSuite && dilaSuite) {
    for (let i = 0; i < workloads.length; i += 1) {
      const rawEval = rawSuite.runs[i]?.evaluation;
      const dilaEval = dilaSuite.runs[i]?.evaluation;
      if (rawEval?.ok && dilaEval?.ok) {
        headToHeadComparisons.push({
          workloadId: workloads[i].id,
          comparison: compareBlindEvaluations(rawEval, dilaEval, {
            labelA: "raw",
            labelB: "dila",
          }),
        });
      }
    }
  }

  const pathQualityTable = pathSuites.map((s) => ({
    pathId: s.pathId,
    label: s.label,
    stack: s.stack,
    avgComposite: s.aggregate.avgComposite,
    correctness: s.aggregate.avgDimensions.correctness,
    verification: s.aggregate.avgDimensions.verification,
    quality: s.aggregate.avgDimensions.quality,
    generalization: s.aggregate.avgDimensions.generalization,
    efficiency: s.aggregate.avgDimensions.efficiency,
    avgTokens: s.aggregate.avgTokens,
    avgLatencyMs: s.aggregate.avgLatencyMs,
    avgCostUsd: s.aggregate.avgCostUsd,
    regressionRate: s.aggregate.regressionRate,
    humanInterventionRate: s.aggregate.humanInterventionRate,
    successRate: s.aggregate.successRate,
  }));

  const rawComposite = rawSuite?.aggregate.avgComposite ?? 0;
  const dilaComposite = dilaSuite?.aggregate.avgComposite ?? 0;
  const qualityDelta = dilaComposite - rawComposite;

  const tokenSavingsPct = rawSuite && dilaSuite && rawSuite.aggregate.avgTokens > 0
    ? ((rawSuite.aggregate.avgTokens - dilaSuite.aggregate.avgTokens) / rawSuite.aggregate.avgTokens) * 100
    : null;

  const costSavingsPct = rawSuite && dilaSuite && rawSuite.aggregate.avgCostUsd > 0
    ? ((rawSuite.aggregate.avgCostUsd - dilaSuite.aggregate.avgCostUsd) / rawSuite.aggregate.avgCostUsd) * 100
    : null;

  const h2hWins = headToHeadComparisons.filter((c) => c.comparison.winner === "dila").length;
  const h2hTotal = headToHeadComparisons.length;

  const claims = buildSegmentedClaims({
    rawSuite,
    dilaSuite,
    headToHeadComparisons,
    pricing: priceConfig,
    workloadCount: workloads.length,
  });

  const publishability = assessPublishability({
    claims,
    pricing: priceConfig,
    workloadCount: workloads.length,
    independentEvaluator: true,
    sameModel: true,
  });

  const illustrativeSavings = projectMonthlySavings({
    monthlySpendUsd: 100_000,
    costReductionPct: claims.segments?.inferenceCostReduction?.pointEstimate,
    publishable: publishability.publishable,
  });

  const moat = buildMoatSummary({ pathSuites, pathQualityTable });

  const commercial = buildCommercialThreeWay({
    rawSuite,
    dilaSuite,
    pricing: priceConfig,
    headToHeadComparisons,
  });

  const counterfactualSummary = {
    paths: pathSuites
      .map((s) => s.counterfactual)
      .filter(Boolean)
      .map((cf) => ({
        pathId: cf.pathId,
        promoted: cf.battery?.overall?.promoted,
        promotionRate: cf.battery?.summary?.promotionRate,
        fields: cf.battery?.summary?.fields,
        tokenSavingsPct: cf.battery?.overall?.tokenSavingsPct,
      })),
    overallPromotionRate: (() => {
      const rates = pathSuites
        .map((s) => s.counterfactual?.battery?.summary?.promotionRate)
        .filter((r) => r != null);
      return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
    })(),
  };

  const cognitiveCompilerSummary = pathSuites.reduce((acc, s) => {
    const tiers = s.cognitiveCompilerTiers || {};
    for (const [k, v] of Object.entries(tiers)) acc[k] = (acc[k] || 0) + v;
    return acc;
  }, {});

  const compilerV2Summary = {
    pathsWithGovernor: pathSuites.filter((s) => s.counterfactual?.battery?.overall).length,
    avgPromotionRate: counterfactualSummary.overallPromotionRate,
    recoverableFieldsTotal: pathSuites.reduce((sum, s) => {
      const run = s.runs?.find((r) => r.metrics?.cognitiveCompiler?.recoverableFieldCount != null);
      return sum + (run?.metrics?.cognitiveCompiler?.recoverableFieldCount || 0);
    }, 0),
    reasoningLevels: pathSuites.map((s) => ({
      pathId: s.pathId,
      level: s.runs?.[0]?.metrics?.cognitiveCompiler?.reasoningLadder?.level,
    })).filter((r) => r.level != null),
  };

  const sweSuite = pathSuites[0]?.runs?.find((r) => r.workloadId === "swe_mini");
  const sweSummary = sweSuite?.sweResult ? {
    passed: sweSuite.sweResult.passed,
    total: sweSuite.sweResult.total,
    passRate: sweSuite.sweResult.passRate,
  } : null;

  const targetMet = dilaComposite >= rawComposite - 0.01
    && (tokenSavingsPct == null || tokenSavingsPct > 50);

  let verdict;
  if (targetMet && qualityDelta >= 0) {
    verdict = `dila_quality_${(qualityDelta * 100).toFixed(0)}pt_delta_${tokenSavingsPct?.toFixed(0) ?? "?"}pct_token_savings`;
  } else if (qualityDelta < -0.05) {
    verdict = `dhtp_quality_regression_${(Math.abs(qualityDelta) * 100).toFixed(0)}pt_vs_raw`;
  } else if (tokenSavingsPct != null && tokenSavingsPct < 10) {
    verdict = "insufficient_efficiency_gain";
  } else {
    verdict = "mixed_results_needs_review";
  }

  return {
    ok: pathSuites.every((s) => s.aggregate.successRate >= 0.9),
    runId,
    suite: "dila_raw_blind_benchmark",
    durationMs: Date.now() - started,
    pricing: priceConfig,
    workloads: workloads.map((w) => w.id),
    pathSuites,
    pathQualityTable,
    rawBaseline,
    headToHead: {
      comparisons: headToHeadComparisons,
      dilaWins: h2hWins,
      rawWins: headToHeadComparisons.filter((c) => c.comparison.winner === "raw").length,
      ties: headToHeadComparisons.filter((c) => c.comparison.winner === "tie").length,
      total: h2hTotal,
      winRate: h2hTotal > 0 ? h2hWins / h2hTotal : null,
    },
    headline: {
      rawComposite,
      dilaComposite,
      qualityDelta,
      tokenSavingsPct,
      costSavingsPct,
      latencyDeltaMs: rawSuite && dilaSuite
        ? dilaSuite.aggregate.avgLatencyMs - rawSuite.aggregate.avgLatencyMs
        : null,
      targetMet,
      verdict,
      principle: "independent_evaluator_no_producer_identity",
      caveat: priceConfig.mode === "estimated"
        ? "Costs estimated from token counts — run with COGNITIVE_ECON_MODE=billed for real $/mission"
        : null,
    },
    dhtpIsolation: pathQualityTable.map((r) => ({
      path: r.pathId,
      label: r.label,
      quality: (r.avgComposite * 100).toFixed(1),
      tokens: Math.round(r.avgTokens),
    })),
    claims,
    publishability,
    illustrativeEconomics: illustrativeSavings,
    moat,
    commercial,
    counterfactual: counterfactualSummary,
    cognitiveCompiler: cognitiveCompilerSummary,
    compilerV2: compilerV2Summary,
    swe: sweSummary,
    positioning: POSITIONING,
    primaryMetric: PRIMARY_METRIC,
  };
}

export { BLIND_BENCHMARK_PATHS };
