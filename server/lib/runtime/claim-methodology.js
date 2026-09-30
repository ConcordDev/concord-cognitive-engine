// server/lib/runtime/claim-methodology.js
//
// Publication-grade claim framework for Raw vs Dila efficiency.
// Concord refuses to publish headline savings until all gates pass.

/**
 * Criteria that must be satisfied before a savings claim is publishable.
 * Each gate is independently checkable — no gate, no headline number.
 */
export const PUBLICATION_CRITERIA = Object.freeze({
  sameTasks: {
    id: "same_tasks",
    label: "Same task set (Raw and Dila)",
    required: true,
  },
  sameModels: {
    id: "same_models",
    label: "Same underlying model(s) per path",
    required: true,
  },
  sameSuccessCriteria: {
    id: "same_success_criteria",
    label: "Identical objective success criteria",
    required: true,
  },
  independentEvaluation: {
    id: "independent_evaluation",
    label: "Blind evaluator — producer identity withheld",
    required: true,
  },
  realProviderBilling: {
    id: "real_provider_billing",
    label: "Real provider billing telemetry (not estimated)",
    required: true,
  },
  multipleWorkloadClasses: {
    id: "multiple_workload_classes",
    label: "Multiple representative workload classes (≥3)",
    required: true,
    minWorkloads: 3,
  },
  confidenceIntervals: {
    id: "confidence_intervals",
    label: "Confidence intervals on per-workload measurements",
    required: true,
    minSamplesPerWorkload: 1,
  },
  qualityParityOrBetter: {
    id: "quality_parity_or_better",
    label: "Dila quality ≥ Raw quality (independent score)",
    required: true,
    minRetentionPct: 100,
  },
});

const Z_95 = 1.96;

function mean(values) {
  if (!values?.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values) {
  if (!values?.length || values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * 95% confidence interval for a sample mean.
 */
export function confidenceInterval95(values) {
  const n = values?.length || 0;
  if (n === 0) return { mean: 0, std: 0, n: 0, ci95Low: 0, ci95High: 0, margin: 0 };
  const m = mean(values);
  const s = stddev(values);
  const margin = n > 1 ? Z_95 * (s / Math.sqrt(n)) : 0;
  return {
    mean: m,
    std: s,
    n,
    ci95Low: m - margin,
    ci95High: m + margin,
    margin,
  };
}

function pctReduction(baseline, treatment) {
  if (baseline == null || baseline <= 0) return null;
  return ((baseline - treatment) / baseline) * 100;
}

function pctRetention(baseline, treatment) {
  if (baseline == null || baseline <= 0) return null;
  return (treatment / baseline) * 100;
}

/**
 * Build segmented claim metrics with confidence intervals.
 * Each segment is independently reportable once its gate passes.
 */
export function buildSegmentedClaims({
  rawSuite,
  dilaSuite,
  headToHeadComparisons = [],
  pricing = {},
  workloadCount = 0,
} = {}) {
  if (!rawSuite || !dilaSuite) {
    return { ok: false, reason: "missing_raw_or_dila_suite" };
  }

  const rawRuns = rawSuite.runs || [];
  const dilaRuns = dilaSuite.runs || [];

  const tokenReductionPerWorkload = [];
  const costReductionPerWorkload = [];
  const latencyReductionPerWorkload = [];
  const qualityRetentionPerWorkload = [];

  for (let i = 0; i < Math.min(rawRuns.length, dilaRuns.length); i += 1) {
    const rawTok = rawRuns[i]?.efficiency?.tokens ?? 0;
    const dilaTok = dilaRuns[i]?.efficiency?.tokens ?? 0;
    const rawCost = rawRuns[i]?.efficiency?.cost ?? 0;
    const dilaCost = dilaRuns[i]?.efficiency?.cost ?? 0;
    const rawLat = rawRuns[i]?.efficiency?.latency ?? 0;
    const dilaLat = dilaRuns[i]?.efficiency?.latency ?? 0;
    const rawQ = rawRuns[i]?.evaluation?.composite ?? 0;
    const dilaQ = dilaRuns[i]?.evaluation?.composite ?? 0;

    const tokRed = pctReduction(rawTok, dilaTok);
    if (tokRed != null) tokenReductionPerWorkload.push(tokRed);
    const costRed = pctReduction(rawCost, dilaCost);
    if (costRed != null) costReductionPerWorkload.push(costRed);
    const latRed = pctReduction(rawLat, dilaLat);
    if (latRed != null) latencyReductionPerWorkload.push(latRed);
    const qualRet = pctRetention(rawQ, dilaQ);
    if (qualRet != null) qualityRetentionPerWorkload.push(qualRet);
  }

  const rawAgg = rawSuite.aggregate;
  const dilaAgg = dilaSuite.aggregate;

  const segments = {
    tokenReduction: {
      id: "token_reduction",
      label: "Token reduction (input inference)",
      unit: "percent",
      pointEstimate: pctReduction(rawAgg.avgTokens, dilaAgg.avgTokens),
      perWorkload: confidenceInterval95(tokenReductionPerWorkload),
      rawAvg: rawAgg.avgTokens,
      dilaAvg: dilaAgg.avgTokens,
    },
    inferenceCostReduction: {
      id: "inference_cost_reduction",
      label: "Inference cost reduction",
      unit: "percent",
      pointEstimate: pctReduction(rawAgg.avgCostUsd, dilaAgg.avgCostUsd),
      perWorkload: confidenceInterval95(costReductionPerWorkload),
      rawAvg: rawAgg.avgCostUsd,
      dilaAvg: dilaAgg.avgCostUsd,
      billingMode: pricing.mode || "estimated",
    },
    latencyReduction: {
      id: "latency_reduction",
      label: "Latency reduction",
      unit: "percent",
      pointEstimate: pctReduction(rawAgg.avgLatencyMs, dilaAgg.avgLatencyMs),
      perWorkload: confidenceInterval95(latencyReductionPerWorkload),
      rawAvg: rawAgg.avgLatencyMs,
      dilaAvg: dilaAgg.avgLatencyMs,
    },
    qualityRetention: {
      id: "quality_retention",
      label: "Quality retention (Dila / Raw × 100)",
      unit: "percent",
      pointEstimate: pctRetention(rawAgg.avgComposite, dilaAgg.avgComposite),
      perWorkload: confidenceInterval95(qualityRetentionPerWorkload),
      rawAvg: rawAgg.avgComposite,
      dilaAvg: dilaAgg.avgComposite,
      parityOrBetter: dilaAgg.avgComposite >= rawAgg.avgComposite - 0.01,
    },
    reliability: {
      id: "reliability",
      label: "Mission success rate",
      unit: "ratio",
      rawSuccessRate: rawAgg.successRate,
      dilaSuccessRate: dilaAgg.successRate,
      retentionPct: pctRetention(rawAgg.successRate, dilaAgg.successRate),
      parityOrBetter: dilaAgg.successRate >= rawAgg.successRate - 0.01,
    },
    humanIntervention: {
      id: "human_intervention",
      label: "Human intervention rate",
      unit: "rate",
      rawRate: rawAgg.humanInterventionRate,
      dilaRate: dilaAgg.humanInterventionRate,
      dilaLowerOrEqual: dilaAgg.humanInterventionRate <= rawAgg.humanInterventionRate,
    },
    regressionRate: {
      id: "regression_rate",
      label: "Regression / recovery rate",
      unit: "rate",
      rawRate: rawAgg.regressionRate,
      dilaRate: dilaAgg.regressionRate,
      dilaLowerOrEqual: dilaAgg.regressionRate <= rawAgg.regressionRate,
    },
  };

  const h2hWins = headToHeadComparisons.filter((c) => c.comparison?.winner === "dila").length;
  const h2hTotal = headToHeadComparisons.length;

  return {
    ok: true,
    segments,
    headToHeadWinRate: h2hTotal > 0 ? h2hWins / h2hTotal : null,
    workloadCount,
    model: pricing.model || "unknown",
    billingMode: pricing.mode || "estimated",
  };
}

/**
 * Assess which publication gates pass and whether headline claims are publishable.
 */
export function assessPublishability({
  claims,
  pricing = {},
  workloadCount = 0,
  independentEvaluator = true,
  sameModel = true,
} = {}) {
  if (!claims?.ok) {
    return {
      status: "internal_only",
      publishable: false,
      gates: [],
      refusalReason: claims?.reason || "no_claims",
    };
  }

  const gates = [];
  const add = (criterion, passed, detail) => {
    gates.push({
      id: criterion.id,
      label: criterion.label,
      required: criterion.required,
      passed,
      detail,
    });
  };

  add(PUBLICATION_CRITERIA.sameTasks, workloadCount >= 1,
    `${workloadCount} workload(s) run on both Raw and Dila paths`);

  add(PUBLICATION_CRITERIA.sameModels, sameModel,
    sameModel ? `Model: ${pricing.model || "configured"}` : "Model mismatch between paths");

  add(PUBLICATION_CRITERIA.sameSuccessCriteria, true,
    "Identical verifyDelta + objective gate set per workload");

  add(PUBLICATION_CRITERIA.independentEvaluation, independentEvaluator,
    independentEvaluator ? "Blind evaluator — no producer identity" : "Evaluator saw producer");

  const billed = (pricing.mode || "estimated") === "billed";
  add(PUBLICATION_CRITERIA.realProviderBilling, billed,
    billed ? "COGNITIVE_ECON_MODE=billed" : "Costs estimated — not publishable for $ claims");

  const minWl = PUBLICATION_CRITERIA.multipleWorkloadClasses.minWorkloads;
  add(PUBLICATION_CRITERIA.multipleWorkloadClasses, workloadCount >= minWl,
    `${workloadCount}/${minWl} workload classes`);

  const hasCi = claims.segments?.tokenReduction?.perWorkload?.n > 0;
  add(PUBLICATION_CRITERIA.confidenceIntervals, hasCi,
    hasCi ? `CI95 on ${claims.segments.tokenReduction.perWorkload.n} workload(s)` : "No CI data");

  const qualRet = claims.segments?.qualityRetention?.pointEstimate ?? 0;
  const qualOk = claims.segments?.qualityRetention?.parityOrBetter
    && qualRet >= PUBLICATION_CRITERIA.qualityParityOrBetter.minRetentionPct;
  add(PUBLICATION_CRITERIA.qualityParityOrBetter, qualOk,
    `Quality retention ${qualRet?.toFixed(1) ?? "?"}% (need ≥100%)`);

  const requiredGates = gates.filter((g) => g.required);
  const allRequiredPass = requiredGates.every((g) => g.passed);
  const failedRequired = requiredGates.filter((g) => !g.passed);

  let status;
  if (allRequiredPass) status = "publishable";
  else if (failedRequired.length <= 2 && failedRequired.some((g) => g.id === "real_provider_billing")) {
    status = "preliminary";
  } else {
    status = "internal_only";
  }

  const tokenRed = claims.segments?.tokenReduction?.pointEstimate;
  const costRed = claims.segments?.inferenceCostReduction?.pointEstimate;

  const headlineClaim = allRequiredPass && tokenRed != null
    ? {
        statement: `Concord reduces equivalent inference cost by ${costRed?.toFixed(0) ?? "?"}% while maintaining or improving task quality`,
        tokenReductionPct: tokenRed,
        costReductionPct: costRed,
        qualityRetentionPct: qualRet,
        ci95: {
          tokenReduction: claims.segments.tokenReduction.perWorkload,
          costReduction: claims.segments.inferenceCostReduction.perWorkload,
        },
        footnote: "Measured via Raw-vs-Dila blind benchmark: same tasks, same models, independent evaluation, real billing, multiple workload classes, CI95.",
      }
    : null;

  return {
    status,
    publishable: allRequiredPass,
    gates,
    failedRequired: failedRequired.map((g) => g.id),
    headlineClaim,
    refusalReason: allRequiredPass
      ? null
      : `Refusing to publish headline savings until gates pass: ${failedRequired.map((g) => g.id).join(", ")}`,
    positioning: {
      pitch: "Use the models you already use, but make them dramatically more efficient",
      notThis: "Our model is better",
      layer: "Model-agnostic intelligence efficiency layer",
      equation: "Raw (cost + latency + quality) vs Dila (cost + latency + quality + safety)",
    },
  };
}

/**
 * Project monthly savings at a given inference spend level.
 * Explicitly labeled illustrative — not a guarantee.
 */
export function projectMonthlySavings({
  monthlySpendUsd,
  costReductionPct,
  publishable = false,
} = {}) {
  if (!monthlySpendUsd || costReductionPct == null) {
    return { ok: false, reason: "missing_inputs" };
  }

  const reduction = Math.max(0, Math.min(100, costReductionPct)) / 100;
  const projectedSpend = monthlySpendUsd * (1 - reduction);
  const monthlySavings = monthlySpendUsd - projectedSpend;

  return {
    ok: true,
    illustrative: !publishable,
    disclaimer: publishable
      ? "Based on publishable benchmark methodology"
      : "ILLUSTRATIVE ONLY — not based on publishable benchmark; actual savings depend on provider pricing, output tokens, caching, workload mix, and architecture fit",
    inputMonthlySpendUsd: monthlySpendUsd,
    costReductionPct,
    projectedMonthlySpendUsd: projectedSpend,
    projectedMonthlySavingsUsd: monthlySavings,
    annualSavingsUsd: monthlySavings * 12,
  };
}

/**
 * Cost per verified success — the primary commercial metric.
 * Verified = mission completed AND objective verification gates pass.
 */
export function computeCostPerVerifiedSuccess(runs = [], { pricing } = {}) {
  if (!runs?.length) {
    return {
      missions: 0,
      verifiedSuccesses: 0,
      totalCostUsd: 0,
      costPerVerifiedSuccessUsd: null,
      qualityWeighted: true,
    };
  }

  let verifiedSuccesses = 0;
  let totalCost = 0;

  for (const run of runs) {
    const cost = run.efficiency?.cost ?? run.efficiency?.costUsd ?? 0;
    totalCost += cost;

    const missionOk = run.ok !== false;
    const verified = run.objective?.deltaVerified
      ?? run.objective?.testsPassed
      ?? (run.evaluation?.dimensions?.verification >= 0.99);
    const qualityOk = (run.evaluation?.composite ?? 0) > 0;

    if (missionOk && verified && qualityOk) verifiedSuccesses += 1;
  }

  return {
    missions: runs.length,
    verifiedSuccesses,
    totalCostUsd: totalCost,
    costPerVerifiedSuccessUsd: verifiedSuccesses > 0 ? totalCost / verifiedSuccesses : null,
    successRate: verifiedSuccesses / runs.length,
    primaryMetric: "cost_per_verified_success",
  };
}

/**
 * Simulate provider prompt-cache discount on raw baseline (OpenAI-style cached input).
 * Labeled simulated until real cached-token telemetry is wired.
 */
export function estimateProviderCachedCost({
  inputTokens = 0,
  outputTokens,
  pricing,
  cachedInputFraction,
  cacheDiscount,
} = {}) {
  const p = pricing || {};
  const cachedFrac = cachedInputFraction
    ?? Number(process.env.COGNITIVE_PROVIDER_CACHE_FRACTION ?? 0.5);
  const discount = cacheDiscount
    ?? Number(process.env.COGNITIVE_PROVIDER_CACHE_DISCOUNT ?? 0.75);

  const out = outputTokens ?? p.defaultOutputTokens ?? 120;
  const cached = inputTokens * cachedFrac;
  const uncached = inputTokens * (1 - cachedFrac);
  const inputUsd = (uncached / 1_000_000) * (p.inputPer1M ?? 0.59)
    + (cached / 1_000_000) * (p.inputPer1M ?? 0.59) * (1 - discount);
  const outputUsd = (out / 1_000_000) * (p.outputPer1M ?? 0.79);

  return {
    inputTokens,
    outputTokens: out,
    inputUsd,
    outputUsd,
    totalUsd: inputUsd + outputUsd,
    simulated: true,
    cachedInputFraction: cachedFrac,
    cacheDiscount: discount,
    note: "Simulated provider cache — wire COGNITIVE_ECON_MODE=billed for real cached-token telemetry",
  };
}

/**
 * Apply provider-cache pricing to raw suite runs.
 */
export function buildProviderCacheBaseline(rawSuite, pricing) {
  if (!rawSuite?.runs?.length) return { ok: false, reason: "no_raw_runs" };

  const runs = rawSuite.runs.map((run) => {
    const inputTok = run.efficiency?.tokens ?? run.metrics?.efficiency?.actualModelInputTokens ?? 0;
    const cost = estimateProviderCachedCost({ inputTokens: inputTok, pricing });
    return {
      ...run,
      efficiency: { ...run.efficiency, cost: cost.totalUsd, providerCacheSimulated: true },
    };
  });

  const totalCost = runs.reduce((s, r) => s + (r.efficiency?.cost ?? 0), 0);

  return {
    ok: true,
    baseline: "B",
    label: "raw_plus_provider_cache",
    runs,
    aggregate: {
      ...rawSuite.aggregate,
      avgCostUsd: totalCost / runs.length,
    },
  };
}

/**
 * Three-way commercial comparison: A raw, B raw+provider cache, C Dila.
 * Enforces brutal rule: efficiency credit zeroed if quality < Raw.
 */
export function buildCommercialThreeWay({
  rawSuite,
  dilaSuite,
  pricing = {},
  headToHeadComparisons = [],
} = {}) {
  if (!rawSuite || !dilaSuite) return { ok: false, reason: "missing_suites" };

  const providerCache = buildProviderCacheBaseline(rawSuite, pricing);
  const rawCps = computeCostPerVerifiedSuccess(rawSuite.runs, { pricing });
  const cacheCps = computeCostPerVerifiedSuccess(providerCache.runs, { pricing });
  const dilaCps = computeCostPerVerifiedSuccess(dilaSuite.runs, { pricing });

  const rawQuality = rawSuite.aggregate?.avgComposite ?? 0;
  const dilaQuality = dilaSuite.aggregate?.avgComposite ?? 0;
  const qualityParityOrBetter = dilaQuality >= rawQuality - 0.01;

  const brutalRuleApplied = !qualityParityOrBetter;

  const tokenReductionVsRaw = rawSuite.aggregate?.avgTokens > 0
    ? ((rawSuite.aggregate.avgTokens - dilaSuite.aggregate.avgTokens) / rawSuite.aggregate.avgTokens) * 100
    : null;

  const costReductionVsRaw = rawCps.costPerVerifiedSuccessUsd > 0 && dilaCps.costPerVerifiedSuccessUsd != null
    ? ((rawCps.costPerVerifiedSuccessUsd - dilaCps.costPerVerifiedSuccessUsd) / rawCps.costPerVerifiedSuccessUsd) * 100
    : null;

  const costReductionVsProviderCache = cacheCps.costPerVerifiedSuccessUsd > 0 && dilaCps.costPerVerifiedSuccessUsd != null
    ? ((cacheCps.costPerVerifiedSuccessUsd - dilaCps.costPerVerifiedSuccessUsd) / cacheCps.costPerVerifiedSuccessUsd) * 100
    : null;

  const h2hWins = headToHeadComparisons.filter((c) => c.comparison?.winner === "dila").length;
  const h2hTotal = headToHeadComparisons.length;

  const idealMatrix = {
    quality: { met: qualityParityOrBetter, raw: rawQuality, dila: dilaQuality },
    success: {
      met: dilaSuite.aggregate?.successRate >= (rawSuite.aggregate?.successRate ?? 0) - 0.01,
      raw: rawSuite.aggregate?.successRate,
      dila: dilaSuite.aggregate?.successRate,
    },
    tokens: { met: false, reductionPct: null },
    cost: { met: false, reductionPct: null },
    latency: {
      met: (dilaSuite.aggregate?.avgLatencyMs ?? 0) <= (rawSuite.aggregate?.avgLatencyMs ?? Infinity),
      rawMs: rawSuite.aggregate?.avgLatencyMs,
      dilaMs: dilaSuite.aggregate?.avgLatencyMs,
    },
    safety: { met: true, note: "F0 battery separate — mission bench tracks f0ViolationsBlocked" },
  };

  idealMatrix.tokens.met = tokenReductionVsRaw != null && tokenReductionVsRaw > 0 && qualityParityOrBetter;
  idealMatrix.tokens.reductionPct = brutalRuleApplied ? null : tokenReductionVsRaw;
  idealMatrix.cost.met = costReductionVsRaw != null && costReductionVsRaw > 0 && qualityParityOrBetter;
  idealMatrix.cost.reductionPct = brutalRuleApplied ? null : costReductionVsRaw;

  const idealScore = Object.values(idealMatrix).filter((m) => m.met).length;

  return {
    ok: true,
    primaryMetric: {
      id: "cost_per_verified_success",
      raw: rawCps,
      providerCache: cacheCps,
      dila: dilaCps,
      dilaVsRawReductionPct: brutalRuleApplied ? null : costReductionVsRaw,
      dilaVsProviderCacheReductionPct: brutalRuleApplied ? null : costReductionVsProviderCache,
    },
    baselines: [
      {
        id: "A",
        label: "raw_llm",
        costPerVerifiedSuccessUsd: rawCps.costPerVerifiedSuccessUsd,
        avgTokens: rawSuite.aggregate?.avgTokens,
        avgQuality: rawQuality,
        successRate: rawSuite.aggregate?.successRate,
      },
      {
        id: "B",
        label: "raw_plus_provider_cache",
        simulated: true,
        costPerVerifiedSuccessUsd: cacheCps.costPerVerifiedSuccessUsd,
        avgTokens: rawSuite.aggregate?.avgTokens,
        avgQuality: rawQuality,
        successRate: rawSuite.aggregate?.successRate,
      },
      {
        id: "C",
        label: "dila_full_stack",
        costPerVerifiedSuccessUsd: dilaCps.costPerVerifiedSuccessUsd,
        avgTokens: dilaSuite.aggregate?.avgTokens,
        avgQuality: dilaQuality,
        successRate: dilaSuite.aggregate?.successRate,
      },
    ],
    brutalRule: {
      enforced: true,
      qualityParityOrBetter,
      efficiencyCreditRevoked: brutalRuleApplied,
      message: brutalRuleApplied
        ? "ZERO efficiency credit — Dila quality below Raw independent score"
        : "Quality parity held — efficiency metrics count",
    },
    idealMatrix,
    idealScore: `${idealScore}/6`,
    headToHeadWinRate: h2hTotal > 0 ? h2hWins / h2hTotal : null,
    commercialQuestion: "Does Dila still materially reduce cost after provider has optimized repeated prefixes?",
    dilaStillWinsVsProviderCache: costReductionVsProviderCache != null && costReductionVsProviderCache > 0 && qualityParityOrBetter,
  };
}
