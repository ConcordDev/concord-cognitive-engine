// server/lib/runtime/dila-benchmark-manifest.js
//
// Strategic benchmark manifest — codifies what Dila must prove before commercial claims.
// Dila is the cognitive OS underneath LLMs, not another coding agent.

/**
 * Primary metric. Everything else is secondary.
 * No credit for token savings if verified quality falls.
 */
export const PRIMARY_METRIC = Object.freeze({
  id: "cost_per_verified_success",
  label: "Cost per Verified Success",
  formula: "total_billed_usd / count(verified_successful_outcomes)",
  brutalRule: "Dila gets zero efficiency credit if independent quality < Raw",
});

export const SECONDARY_METRICS = Object.freeze([
  { id: "quality_per_dollar", label: "Quality / dollar" },
  { id: "success_per_token", label: "Success / token" },
  { id: "success_per_second", label: "Success / second" },
  { id: "capability_growth_per_million_tokens", label: "Verified capability growth / M tokens" },
]);

/**
 * Three commercial baselines — the question investors ask.
 * A: Raw, no app optimization
 * B: Raw + provider prompt caching (complementary layer)
 * C: Dila full stack + provider caching where applicable
 */
export const COMMERCIAL_BASELINES = Object.freeze({
  A: {
    id: "A",
    label: "raw_llm",
    description: "Same model, full context, no DTU/DHTP/PCE/cognitive cache",
  },
  B: {
    id: "B",
    label: "raw_plus_provider_cache",
    description: "Same as A with provider prompt-cache discount on repeated prefixes",
    simulated: true,
  },
  C: {
    id: "C",
    label: "dila_full_stack",
    description: "DTU + DHTP + PCE + cognitive cache + verification + recovery",
    mapsToPath: "E",
  },
});

/**
 * Ideal Raw-vs-Dila result matrix (11/10 target).
 */
export const IDEAL_RESULT_MATRIX = Object.freeze({
  quality: { target: "dila_gte_raw", label: "Dila ≥ Raw" },
  success: { target: "dila_gte_raw", label: "Dila ≥ Raw" },
  tokens: { target: "dila_lt_raw", label: "Dila << Raw" },
  cost: { target: "dila_lt_raw", label: "Dila << Raw" },
  latency: { target: "dila_lte_raw", label: "Dila ≤ Raw" },
  safety: { target: "dila_gt_raw", label: "Dila > Raw" },
});

/**
 * Permanent benchmark layers (Dila Capability Benchmark taxonomy).
 */
export const BENCHMARK_LAYERS = Object.freeze({
  L1_intelligence: { id: 1, name: "Raw intelligence", status: "partial" },
  L2_memory: { id: 2, name: "Memory (LoCoMo, temporal, contradiction)", status: "dgb_started" },
  L3_coding: { id: 3, name: "Coding (SWE-bench, Terminal-Bench, ConcordBench)", status: "concord_bench_partial" },
  L4_agents: { id: 4, name: "Agents (tools, planning, recovery, missions)", status: "mission_runtime" },
  L5_economics: { id: 5, name: "Economics (cost/success, tokens/success)", status: "in_progress" },
  L6_safety: { id: 6, name: "Safety (F0, injection, poisoned DTUs)", status: "f0_battery" },
  L7_generalization: { id: 7, name: "Generalization (DGB L1–L5)", status: "dgb_shipped" },
});

/**
 * P0 empirical gates — nothing ships to marketing until these pass.
 */
export const P0_GATES = Object.freeze([
  { id: "raw_vs_dila_blind", label: "Raw vs Dila blind quality parity", gate: "blind_benchmark" },
  { id: "real_provider_economics", label: "Real provider billed $ (not estimated)", gate: "COGNITIVE_ECON_MODE=billed" },
  { id: "dhtp_semantic_compiler", label: "DHTP semantic compiler (beyond regex presets)", gate: "engineering" },
  { id: "dtu_retrieval_eval", label: "DTU retrieval quality evaluation", gate: "engineering" },
]);

export const POSITIONING = Object.freeze({
  is: "Cognitive operating system underneath LLMs — models are interchangeable reasoning engines",
  isNot: "Another better LLM coding agent",
  moat: "Concord knows what should exist in the model's context in the first place",
  notMoat: "Nobody else has token compression (ACCP/AACP exist)",
  product: "Concord Cognitive Runtime — Dila is the flagship agent on it",
  killerClaim: "Concord reduces tokens required to successfully complete workloads while preserving or improving task quality",
  notClaim: "Concord saves 80% of your tokens",
  architecturalProof: "4.7M tokens avoided is engineering evidence — not yet the product claim until real billed A/B passes",
});

export const COGNITIVE_STACK_LAYERS = Object.freeze([
  "intent_parser",
  "mission_graph",
  "dtu_substrate",
  "repo_brain",
  "world_state",
  "context_intelligence",
  "dhtp_cognitive_compiler",
  "model_router",
  "llm_reasoning",
  "critic_validator",
  "f0_authority",
  "deterministic_execution",
  "verification",
  "dtu_memory",
  "recovery_loop",
  "learning_engine",
  "capability_promotion",
]);
