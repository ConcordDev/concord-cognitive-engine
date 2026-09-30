// server/lib/runtime/cognitive-economics-bench.js
//
// A/B/C/D/E economic multiplier benchmark — same workloads, increasing stack depth.
// Measures $/successful mission, billed tokens, latency, failures, quality.

import crypto from "node:crypto";
import { compileExecutiveCognition } from "./dhtp-compiler.js";
import { seedBenchDtuCorpus } from "./cognitive-savings-ledger.js";
import {
  runCognitiveMissionIteration,
} from "./cognitive-mission-bench.js";

const ANALYZE_DELTA = `@ACTION analyze
@RATIONALE_REF ledger:verified
@CONFIDENCE 0.85
@EXPECTED_RESULT structured_observation`;
import {
  ECONOMIC_PATHS,
  DEFAULT_WORKLOADS,
  resolvePricingConfig,
  getEconomicPathConfig,
  aggregatePathEconomics,
  comparePathEconomics,
  estimateInvocationCost,
} from "./cognitive-economics.js";

const PCE_WORKLOAD = Object.freeze({ template: "pce_transform", weight: 0.2, maxTicks: 12 });

function benchRunId() {
  return `ceb_${crypto.randomUUID().slice(0, 12)}`;
}

function buildWorkloadSchedule({ iterations } = {}) {
  const base = [...DEFAULT_WORKLOADS];
  const schedule = [];
  for (let i = 0; i < iterations; i += 1) {
    schedule.push(base[i % base.length]);
  }
  return schedule;
}

/**
 * Compile-only probe for one path — fast token/cost snapshot per invocation.
 */
export async function runEconomicCompileProbe({ db, pathId } = {}) {
  const path = getEconomicPathConfig(pathId);
  if (!path || !db) return { ok: false, reason: "invalid_path_or_db" };

  const mission = {
    id: `mis_econ_${pathId}`,
    goal: "Analyze fleet organ health via DHTP cognitive delta",
    template: "cognitive_probe",
    status: "running",
  };
  const step = {
    tool: "cognitive_delta_execute",
    args: { text: ANALYZE_DELTA },
  };

  const compiled = await compileExecutiveCognition({
    db,
    mission,
    step,
    stepIndex: 1,
    route: { taskClass: "classification" },
    ledger: {},
    lessons: [],
    context: { observation: { missions_running: 1 } },
    bumpRecall: false,
    ...path.compile,
  });

  const savings = compiled?.savings || {};
  const pricing = resolvePricingConfig();
  const cost = estimateInvocationCost({
    inputTokens: savings.actualModelInputTokens ?? 0,
    cacheHit: compiled?.cacheHit,
    skipLlm: compiled?.skipLlm,
    pceDeterministic: step.tool === "pce_execute",
    pricing,
  });

  return {
    ok: true,
    pathId,
    label: path.label,
    pipeline: {
      world: savings.contextTokensFull,
      afterDtu: savings.tokensAfterDtu,
      dhtp: savings.dhtpTokens,
      modelInput: savings.actualModelInputTokens,
    },
    savings: {
      dtu: savings.dtuSavings,
      dhtp: savings.dhtpSavings,
      cache: savings.cacheSavings,
      pce: savings.pceSavings,
      total: savings.totalTokensAvoided,
    },
    cost,
    cacheHit: compiled?.cacheHit ?? false,
    latencyMs: savings.latencyMs,
  };
}

/**
 * PCE compile probe — deterministic path skips LLM billing.
 */
export async function runEconomicPceProbe({ db, pathId } = {}) {
  const path = getEconomicPathConfig(pathId);
  if (!path || !db) return { ok: false, reason: "invalid_path_or_db" };

  const mission = {
    id: `mis_pce_${pathId}`,
    goal: "Apply deterministic PCE transform",
    template: "pce_transform",
    status: "running",
  };
  const step = { tool: "pce_execute", args: {} };

  const compiled = await compileExecutiveCognition({
    db,
    mission,
    step,
    stepIndex: 1,
    route: { taskClass: "coding" },
    ledger: {},
    lessons: [],
    context: {},
    bumpRecall: false,
    ...path.compile,
  });

  const savings = compiled?.savings || {};
  const pricing = resolvePricingConfig();
  const cost = estimateInvocationCost({
    inputTokens: savings.actualModelInputTokens ?? 0,
    pceDeterministic: true,
    pricing,
  });

  return {
    ok: true,
    pathId,
    pceDeterministic: true,
    modelInput: savings.actualModelInputTokens,
    pceSavings: savings.pceSavings,
    cost,
  };
}

/**
 * Run full mission iterations under one economic path configuration.
 */
export async function runEconomicPathMissions({
  db,
  dispatchMCP,
  pathId,
  iterations = 10,
  minCacheUses,
} = {}) {
  const path = getEconomicPathConfig(pathId);
  if (!path || !db) return { ok: false, reason: "invalid_path_or_db" };

  const prevPath = process.env.COGNITIVE_ECON_PATH;
  const prevMinUses = process.env.COGNITIVE_CACHE_MIN_USES;
  const prevRecovery = process.env.CONCORD_MISSION_RECOVERY;

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

  const schedule = buildWorkloadSchedule({ iterations });

  const results = [];
  try {
    for (let i = 0; i < iterations; i += 1) {
      const workload = schedule[i] || schedule[0];
      results.push(await runCognitiveMissionIteration({
        db,
        dispatchMCP,
        iteration: i + 1,
        template: workload.template,
        maxTicks: workload.maxTicks,
        spawnContext: { econPath: pathId },
      }));
    }
  } finally {
    if (prevPath === undefined) delete process.env.COGNITIVE_ECON_PATH;
    else process.env.COGNITIVE_ECON_PATH = prevPath;
    if (prevMinUses === undefined) delete process.env.COGNITIVE_CACHE_MIN_USES;
    else process.env.COGNITIVE_CACHE_MIN_USES = prevMinUses;
    if (prevRecovery === undefined) delete process.env.CONCORD_MISSION_RECOVERY;
    else process.env.CONCORD_MISSION_RECOVERY = prevRecovery;
  }

  const economics = aggregatePathEconomics({ pathId, iterations: results });
  return { ok: economics.successRate >= 0.9, pathId, iterations: results, economics };
}

/**
 * Full A–E economic multiplier benchmark.
 */
export async function runCognitiveEconomicsBench({
  db,
  dispatchMCP,
  iterationsPerPath = 10,
  paths = ["A", "B", "C", "D", "E"],
  pricing,
  minCacheUses = 1,
} = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  const runId = benchRunId();
  const started = Date.now();
  const priceConfig = pricing || resolvePricingConfig();

  seedBenchDtuCorpus(db, { count: 50 });

  const compileProbes = [];
  for (const pathId of paths) {
    compileProbes.push(await runEconomicCompileProbe({ db, pathId }));
  }
  const pceProbes = [];
  for (const pathId of ["D", "E"]) {
    if (paths.includes(pathId)) {
      pceProbes.push(await runEconomicPceProbe({ db, pathId }));
    }
  }

  const pathResults = [];
  for (const pathId of paths) {
    const pathRun = await runEconomicPathMissions({
      db,
      dispatchMCP,
      pathId,
      iterations: iterationsPerPath,
      minCacheUses: pathId === "E" ? minCacheUses : undefined,
    });
    pathResults.push(pathRun.economics);
  }

  const comparison = comparePathEconomics(pathResults);
  const baseline = comparison.find((c) => c.pathId === "A");
  const fullDila = comparison.find((c) => c.pathId === "E");

  const economicMultiplier = baseline?.costPerSuccessfulMissionUsd > 0 && fullDila?.costPerSuccessfulMissionUsd != null
    ? (fullDila.costPerSuccessfulMissionUsd === 0
      ? null
      : baseline.costPerSuccessfulMissionUsd / fullDila.costPerSuccessfulMissionUsd)
    : null;

  const savingsPctFull = baseline?.costPerSuccessfulMissionUsd > 0 && fullDila?.costPerSuccessfulMissionUsd != null
    ? ((baseline.costPerSuccessfulMissionUsd - fullDila.costPerSuccessfulMissionUsd) / baseline.costPerSuccessfulMissionUsd) * 100
    : null;

  return {
    ok: pathResults.every((r) => r.successRate >= 0.9),
    runId,
    suite: "cognitive_economics_multiplier",
    durationMs: Date.now() - started,
    pricing: priceConfig,
    compileProbes,
    pceProbes,
    pathResults,
    comparison,
    headline: {
      economicMultiplier,
      baselineCostPerSuccessUsd: baseline?.costPerSuccessfulMissionUsd,
      fullDilaCostPerSuccessUsd: fullDila?.costPerSuccessfulMissionUsd,
      savingsPctFullVsRaw: savingsPctFull,
      verdict: savingsPctFull != null && savingsPctFull >= 90
        ? `full_dila_${savingsPctFull.toFixed(0)}pct_cheaper_per_success`
        : (economicMultiplier != null
          ? `full_dila_${economicMultiplier.toFixed(1)}x_cheaper_per_success`
          : "economics_inconclusive"),
      caveat: priceConfig.mode === "estimated"
        ? "Costs are estimated from token counts × configured $/1M rates — run with real provider telemetry for billed $/mission"
        : null,
    },
  };
}

export { ECONOMIC_PATHS, DEFAULT_WORKLOADS };
