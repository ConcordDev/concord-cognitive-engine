// server/lib/runtime/cognitive-economics.js
//
// Cost-per-successful-mission economics for the Dila cognitive stack.
// Translates token accounting into $/mission using configurable provider rates.

/**
 * A–E path ladder — same workloads, increasing stack depth.
 */
export const ECONOMIC_PATHS = Object.freeze({
  A: {
    id: "A",
    label: "raw_llm_baseline",
    description: "Full world JSON to model — no DTU filter, DHTP, PCE, or cache",
    compile: {
      pathVariant: "raw_json",
      useRawJson: true,
      skipDhtp: true,
      skipCache: true,
      skipDtuFilter: false,
    },
    mission: {
      enableCache: false,
      enablePce: false,
      enableRecovery: false,
    },
  },
  B: {
    id: "B",
    label: "dhtp_only",
    description: "Full corpus + DHTP compression — no DTU retrieval filter",
    compile: {
      pathVariant: "dhtp_only",
      useRawJson: false,
      skipDhtp: false,
      skipCache: true,
      skipDtuFilter: true,
    },
    mission: {
      enableCache: false,
      enablePce: false,
      enableRecovery: false,
    },
  },
  C: {
    id: "C",
    label: "dtu_dhtp",
    description: "DTU retrieval + DHTP cognitive packet",
    compile: {
      pathVariant: "dtu_dhtp",
      useRawJson: false,
      skipDhtp: false,
      skipCache: true,
      skipDtuFilter: false,
    },
    mission: {
      enableCache: false,
      enablePce: false,
      enableRecovery: false,
    },
  },
  D: {
    id: "D",
    label: "dtu_dhtp_pce",
    description: "DTU + DHTP + deterministic PCE where eligible",
    compile: {
      pathVariant: "dtu_dhtp",
      useRawJson: false,
      skipDhtp: false,
      skipCache: true,
      skipDtuFilter: false,
    },
    mission: {
      enableCache: false,
      enablePce: true,
      enableRecovery: false,
    },
  },
  E: {
    id: "E",
    label: "full_dila",
    description: "DTU + DHTP + PCE + cache + verification + recovery",
    compile: {
      pathVariant: "dtu_dhtp_cache",
      useRawJson: false,
      skipDhtp: false,
      skipCache: false,
      skipDtuFilter: false,
    },
    mission: {
      enableCache: true,
      enablePce: true,
      enableRecovery: true,
    },
  },
});

export const DEFAULT_WORKLOADS = Object.freeze([
  { template: "cognitive_probe", weight: 0.7, maxTicks: 12 },
  { template: "dgb_semantic_vitals", weight: 0.15, maxTicks: 12 },
  { template: "dgb_compose_audit", weight: 0.15, maxTicks: 16 },
]);

const PCE_WORKLOAD = Object.freeze({ template: "pce_transform", weight: 0.2, maxTicks: 12 });

/**
 * Resolve provider pricing — env-overridable for real-provider A/B runs.
 */
export function resolvePricingConfig(overrides = {}) {
  return {
    model: overrides.model || process.env.COGNITIVE_ECON_MODEL || "groq-llama-3.3-70b",
    inputPer1M: Number(overrides.inputPer1M ?? process.env.COGNITIVE_ECON_INPUT_PER_1M ?? 0.59),
    outputPer1M: Number(overrides.outputPer1M ?? process.env.COGNITIVE_ECON_OUTPUT_PER_1M ?? 0.79),
    defaultOutputTokens: Number(
      overrides.defaultOutputTokens ?? process.env.COGNITIVE_ECON_DEFAULT_OUTPUT_TOKENS ?? 120,
    ),
    currency: overrides.currency || "USD",
    mode: overrides.mode || process.env.COGNITIVE_ECON_MODE || "estimated",
    note: "Token counts are estimated unless COGNITIVE_ECON_MODE=billed with real provider telemetry",
  };
}

export function getEconomicPathConfig(pathId) {
  const key = String(pathId || "").toUpperCase();
  return ECONOMIC_PATHS[key] || null;
}

/**
 * Blind quality benchmark paths — isolate where quality changes.
 * A Raw LLM · B Raw+DTU · C Raw+DHTP · D DTU+DHTP · E Full Dila
 */
export const BLIND_BENCHMARK_PATHS = Object.freeze({
  A: {
    id: "A",
    label: "raw_llm",
    description: "Full context JSON to LLM — no DTU, DHTP, PCE, or cache",
    stack: "raw",
    compile: {
      pathVariant: "raw_json",
      useRawJson: true,
      skipDhtp: true,
      skipCache: true,
      skipDtuFilter: false,
    },
    mission: {
      enableCache: false,
      enablePce: false,
      enableRecovery: false,
    },
  },
  B: {
    id: "B",
    label: "raw_plus_dtu",
    description: "DTU retrieval pack — no DHTP compression",
    stack: "raw",
    compile: {
      pathVariant: "dtu_only",
      useRawJson: false,
      skipDhtp: true,
      skipCache: true,
      skipDtuFilter: false,
    },
    mission: {
      enableCache: false,
      enablePce: false,
      enableRecovery: false,
    },
  },
  C: {
    id: "C",
    label: "raw_plus_dhtp",
    description: "Full corpus + DHTP — no DTU retrieval filter",
    stack: "raw",
    compile: {
      pathVariant: "dhtp_only",
      useRawJson: false,
      skipDhtp: false,
      skipCache: true,
      skipDtuFilter: true,
    },
    mission: {
      enableCache: false,
      enablePce: false,
      enableRecovery: false,
    },
  },
  D: {
    id: "D",
    label: "dtu_dhtp",
    description: "DTU retrieval + DHTP cognitive packet + critic",
    stack: "dila",
    compile: {
      pathVariant: "dtu_dhtp",
      useRawJson: false,
      skipDhtp: false,
      skipCache: true,
      skipDtuFilter: false,
    },
    mission: {
      enableCache: false,
      enablePce: false,
      enableRecovery: false,
    },
  },
  E: {
    id: "E",
    label: "full_dila",
    description: "DTU + DHTP + PCE + cache + critic + recovery",
    stack: "dila",
    compile: {
      pathVariant: "dtu_dhtp_cache",
      useRawJson: false,
      skipDhtp: false,
      skipCache: false,
      skipDtuFilter: false,
    },
    mission: {
      enableCache: true,
      enablePce: true,
      enableRecovery: true,
    },
  },
});

export function getBlindPathConfig(pathId) {
  const key = String(pathId || "").toUpperCase();
  return BLIND_BENCHMARK_PATHS[key] || null;
}

/**
 * Resolve path config for bench runs — blind paths take precedence when suite=blind.
 */
export function getBenchmarkPathConfig(pathId, { suite = "economics" } = {}) {
  if (suite === "blind") return getBlindPathConfig(pathId);
  return getEconomicPathConfig(pathId);
}

/**
 * Estimate billed cost for one cognitive invocation.
 */
export function estimateInvocationCost({
  inputTokens = 0,
  outputTokens,
  cacheHit = false,
  skipLlm = false,
  pceDeterministic = false,
  pricing,
} = {}) {
  const p = pricing || resolvePricingConfig();
  const out = outputTokens ?? p.defaultOutputTokens;

  if (cacheHit || skipLlm || pceDeterministic) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      inputUsd: 0,
      outputUsd: 0,
      totalUsd: 0,
      avoided: true,
      reason: cacheHit ? "cache_hit" : (pceDeterministic ? "pce_deterministic" : "skip_llm"),
    };
  }

  const inputUsd = (inputTokens / 1_000_000) * p.inputPer1M;
  const outputUsd = (out / 1_000_000) * p.outputPer1M;
  return {
    inputTokens,
    outputTokens: out,
    inputUsd,
    outputUsd,
    totalUsd: inputUsd + outputUsd,
    avoided: false,
    reason: null,
  };
}

/**
 * Quality score 0–1 from mission substrates (verification-weighted).
 */
export function scoreMissionQuality(metrics = {}) {
  let score = 0;
  if (metrics.reliability?.missionCompletion) score += 0.35;
  if ((metrics.reliability?.verificationPassRate ?? 0) >= 1) score += 0.25;
  if ((metrics.intelligence?.cognitiveOutcomes ?? 0) > 0) score += 0.2;
  if (!metrics.reliability?.recoveryRequired) score += 0.1;
  if ((metrics.efficiency?.llmCallsAvoidedCache ?? 0) > 0) score += 0.05;
  if ((metrics.efficiency?.llmCallsAvoidedPce ?? 0) > 0) score += 0.05;
  return Math.min(1, score);
}

/**
 * Aggregate economics across mission iterations for one path.
 */
export function aggregatePathEconomics({
  pathId,
  iterations = [],
  pricing,
} = {}) {
  const p = pricing || resolvePricingConfig();
  const path = getEconomicPathConfig(pathId);
  const rows = iterations.map((it) => it.metrics).filter(Boolean);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalUsd = 0;
  let failures = 0;
  let retries = 0;
  let humanInterventions = 0;
  let qualitySum = 0;
  const latencies = [];

  for (const it of iterations) {
    const m = it.metrics || {};
    if (!it.ok) failures += 1;
    retries += m.reliability?.recoveryRequired || 0;
    humanInterventions += m.reliability?.humanIntervention || 0;
    qualitySum += scoreMissionQuality(m);
    latencies.push(m.durationMs || 0);

    const inputTok = m.efficiency?.actualModelInputTokens || 0;
    const cacheHit = m.intelligence?.cacheHit === 1;
    const pceHit = (m.efficiency?.llmCallsAvoidedPce || 0) > 0;
    const cost = estimateInvocationCost({
      inputTokens: inputTok,
      cacheHit,
      skipLlm: m.efficiency?.skipLlm === 1,
      pceDeterministic: pceHit,
      pricing: p,
    });
    totalInputTokens += cost.inputTokens;
    totalOutputTokens += cost.outputTokens;
    totalUsd += cost.totalUsd;
  }

  const successes = iterations.filter((it) => it.ok).length;
  const n = iterations.length || 1;

  return {
    pathId,
    label: path?.label,
    description: path?.description,
    missions: n,
    successes,
    failures,
    successRate: successes / n,
    costPerMissionUsd: totalUsd / n,
    costPerSuccessfulMissionUsd: successes > 0 ? totalUsd / successes : null,
    billedInputTokens: totalInputTokens,
    billedOutputTokens: totalOutputTokens,
    totalUsd,
    avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    retries,
    humanInterventions,
    avgQualityScore: qualitySum / n,
    pricing: p,
  };
}

/**
 * Compare path aggregates — compute multiplier vs baseline A.
 */
export function comparePathEconomics(pathResults) {
  const baseline = pathResults.find((r) => r.pathId === "A");
  const baselineCost = baseline?.costPerSuccessfulMissionUsd ?? baseline?.costPerMissionUsd ?? 0;

  return pathResults.map((r) => ({
    pathId: r.pathId,
    label: r.label,
    costPerSuccessfulMissionUsd: r.costPerSuccessfulMissionUsd,
    costMultiplierVsRaw: baselineCost > 0 && r.costPerSuccessfulMissionUsd != null
      ? r.costPerSuccessfulMissionUsd / baselineCost
      : null,
    savingsPctVsRaw: baselineCost > 0 && r.costPerSuccessfulMissionUsd != null
      ? ((baselineCost - r.costPerSuccessfulMissionUsd) / baselineCost) * 100
      : null,
    successRate: r.successRate,
    avgQualityScore: r.avgQualityScore,
    billedInputTokens: r.billedInputTokens,
    avgLatencyMs: r.avgLatencyMs,
    retries: r.retries,
    humanInterventions: r.humanInterventions,
  }));
}
