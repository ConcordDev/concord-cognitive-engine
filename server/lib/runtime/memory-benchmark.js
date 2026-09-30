// server/lib/runtime/memory-benchmark.js
//
// LoCoMo-style memory benchmark: factual recall, temporal/causal ordering,
// contradiction detection, stale invalidation, latent constraints, goal persistence,
// corruption resistance. Deterministic — no LLM required for scoring.

import crypto from "node:crypto";
import {
  upsertCognitiveMeta,
  getCognitiveMeta,
  invalidateDtu,
  linkCausalEdge,
  filterApplicableDtus,
} from "../dtu-cognitive-schema.js";

export const MEMORY_BENCHMARK_CASES = Object.freeze([
  {
    id: "factual_recall",
    category: "factual",
    probe: { question: "operator_name", expected: "Alex Chen" },
  },
  {
    id: "temporal_order",
    category: "temporal",
    probe: { question: "first_event", expected: "deploy_v2" },
  },
  {
    id: "contradiction_detect",
    category: "contradiction",
    probe: { question: "valid_budget", expected: "5000" },
  },
  {
    id: "stale_invalidation",
    category: "stale",
    probe: { question: "current_api_version", expected: "v3" },
  },
  {
    id: "latent_constraint",
    category: "constraint",
    probe: { question: "max_batch_size", expected: "32" },
  },
  {
    id: "goal_persistence",
    category: "goal",
    probe: { question: "active_goal", expected: "reduce_cost_per_success" },
  },
  {
    id: "corruption_resistance",
    category: "corruption",
    probe: { question: "verified_metric", expected: "cost_per_verified_success" },
  },
]);

function episodeId(suffix) {
  return `mem_${suffix}_${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Seed a deterministic multi-turn memory corpus into dtu_cognitive_meta.
 */
export function seedMemoryCorpus(db) {
  if (!db) return { ok: false, reason: "no_db" };

  const episodes = {
    operator: episodeId("op"),
    deploy: episodeId("dep"),
    deployOld: episodeId("dep_old"),
    budget: episodeId("budget"),
    budgetBad: episodeId("budget_bad"),
    api: episodeId("api"),
    apiStale: episodeId("api_stale"),
    constraint: episodeId("constraint"),
    goal: episodeId("goal"),
    metric: episodeId("metric"),
    corrupt: episodeId("corrupt"),
  };

  upsertCognitiveMeta(db, episodes.operator, {
    outcomes: [{ key: "operator_name", value: "Alex Chen" }],
    applicability: { domains: ["memory_bench"], tags: ["persona"] },
  });

  upsertCognitiveMeta(db, episodes.deploy, {
    outcomes: [{ key: "first_event", value: "deploy_v2", sequence: 2 }],
    applicability: { domains: ["memory_bench"], tags: ["timeline"] },
  });
  episodes.deploySeed = episodeId("dep_seed");
  upsertCognitiveMeta(db, episodes.deploySeed, {
    outcomes: [{ key: "noise", value: "ignore", sequence: 1 }],
    applicability: { domains: ["memory_bench"], tags: ["timeline"] },
  });
  linkCausalEdge(db, episodes.deploySeed, episodes.deploy, "preceded");

  upsertCognitiveMeta(db, episodes.budget, {
    outcomes: [{ key: "valid_budget", value: "5000" }],
    applicability: { domains: ["memory_bench"], tags: ["finance"] },
    confidence: 0.95,
  });
  upsertCognitiveMeta(db, episodes.budgetBad, {
    outcomes: [{ key: "valid_budget", value: "999999" }],
    applicability: { domains: ["memory_bench"], tags: ["finance"] },
    confidence: 0.2,
  });
  invalidateDtu(db, episodes.budgetBad, { reason: "contradicts_primary", supersededBy: episodes.budget });

  upsertCognitiveMeta(db, episodes.api, {
    outcomes: [{ key: "current_api_version", value: "v3" }],
    applicability: { domains: ["memory_bench"], tags: ["api"] },
  });
  upsertCognitiveMeta(db, episodes.apiStale, {
    outcomes: [{ key: "current_api_version", value: "v1" }],
    applicability: { domains: ["memory_bench"], tags: ["api"] },
  });
  invalidateDtu(db, episodes.apiStale, { reason: "superseded", supersededBy: episodes.api });

  upsertCognitiveMeta(db, episodes.constraint, {
    outcomes: [{ key: "max_batch_size", value: "32" }],
    applicability: { domains: ["memory_bench"], tags: ["constraint"], minConfidence: 0.5 },
  });

  upsertCognitiveMeta(db, episodes.goal, {
    outcomes: [{ key: "active_goal", value: "reduce_cost_per_success" }],
    applicability: { domains: ["memory_bench"], tags: ["goal"] },
  });

  upsertCognitiveMeta(db, episodes.metric, {
    outcomes: [{ key: "verified_metric", value: "cost_per_verified_success" }],
    applicability: { domains: ["memory_bench"], tags: ["metric"] },
    confidence: 0.99,
  });
  upsertCognitiveMeta(db, episodes.corrupt, {
    outcomes: [{ key: "verified_metric", value: "raw_token_savings" }],
    applicability: { domains: ["memory_bench"], tags: ["metric"] },
    confidence: 0.1,
  });
  invalidateDtu(db, episodes.corrupt, { reason: "injected_false_memory" });

  return { ok: true, episodes, dtuIds: Object.values(episodes) };
}

/**
 * Simulate memory retrieval for a probe question.
 */
export function recallFromCorpus(db, dtuIds, probe, context = { domain: "memory_bench" }) {
  const applicable = filterApplicableDtus(db, dtuIds, context);
  let best = null;
  let bestConf = -1;

  for (const { dtuId, confidence } of applicable) {
    const meta = getCognitiveMeta(db, dtuId);
    for (const outcome of meta?.outcomes || []) {
      if (outcome.key !== probe.question) continue;
      if (confidence > bestConf) {
        bestConf = confidence;
        best = { dtuId, value: outcome.value, confidence };
      }
    }
  }

  return best;
}

/**
 * Score one memory benchmark case.
 */
export function scoreMemoryCase(db, corpus, testCase) {
  const recalled = recallFromCorpus(db, corpus.dtuIds, testCase.probe);
  const correct = recalled?.value === testCase.probe.expected;
  return {
    caseId: testCase.id,
    category: testCase.category,
    correct,
    expected: testCase.probe.expected,
    recalled: recalled?.value ?? null,
    confidence: recalled?.confidence ?? 0,
    dtuId: recalled?.dtuId ?? null,
  };
}

/**
 * Run full LoCoMo-style memory benchmark suite.
 */
export function runMemoryBenchmark(db, { caseIds } = {}) {
  const corpus = seedMemoryCorpus(db);
  if (!corpus.ok) return { ok: false, reason: corpus.reason };

  const cases = caseIds?.length
    ? MEMORY_BENCHMARK_CASES.filter((c) => caseIds.includes(c.id))
    : MEMORY_BENCHMARK_CASES;

  const results = cases.map((c) => scoreMemoryCase(db, corpus, c));
  const passed = results.filter((r) => r.correct).length;

  return {
    ok: passed === cases.length,
    suite: "locomo_memory",
    total: cases.length,
    passed,
    passRate: cases.length ? passed / cases.length : 0,
    results,
    corpusEpisodeCount: Object.keys(corpus.episodes).length,
  };
}

/**
 * Blind-benchmark adapter — objective memory scoring per path.
 */
export function evaluateMemoryBlindSubmission({
  submissionId,
  task,
  memoryResult,
  efficiencyMetrics,
} = {}) {
  const objectiveScore = memoryResult?.passRate ?? 0;
  const composite = objectiveScore * 0.85 + (memoryResult?.ok ? 0.15 : 0);

  return {
    submissionId,
    task,
    objectiveScore,
    efficiencyScore: 0,
    generalizationScore: null,
    composite,
    passed: memoryResult?.ok ?? false,
    objectiveSignals: {
      memoryPassRate: memoryResult?.passRate,
      casesPassed: memoryResult?.passed,
      casesTotal: memoryResult?.total,
      categories: (memoryResult?.results || []).map((r) => ({
        id: r.caseId,
        category: r.category,
        correct: r.correct,
      })),
    },
    efficiencyMetrics: efficiencyMetrics || { tokens: 0, latency: 0, cost: 0 },
  };
}
