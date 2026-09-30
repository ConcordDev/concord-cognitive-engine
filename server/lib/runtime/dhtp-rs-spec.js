// server/lib/runtime/dhtp-rs-spec.js
// DHTP-RS-MASTER-001 — Representation Sufficiency benchmark specification (code anchor)

export const SPEC_ID = "DHTP-RS-MASTER-001";
export const SPEC_VERSION = "1.0.0";
export const BENCHMARK_VERSION = "1.1.0";
export const RUBRIC_VERSION = "1.0.0";
export const EVALUATOR_VERSION = "1.0.0-rubric-deterministic";

export const CLAIM_LEVELS = Object.freeze({
  0: "Demonstration — works on specific benchmark",
  1: "Replication — survives repeated trials",
  2: "Task generalization — multiple cognitive probes",
  3: "Model generalization — multiple model sizes/families",
  4: "Representation mechanism — ablations show selection/structure contribute",
  5: "External validation — human blind scoring confirms",
});

/** Current authorized public claim (spec §22) */
export const CURRENT_CLAIM = Object.freeze({
  level: 1,
  levelLabel: CLAIM_LEVELS[1],
  text: "Concord's DHTP representation substantially reduces inference context and, in the current fleet-health benchmark, produces much higher task quality and reliability than full raw DTU context. Preliminary controls also indicate that task-directed structured representation can outperform naive same-budget representations.",
  notClaimed: [
    "universal superiority",
    "frontier-equivalent 2B models",
    "general intelligence improvement",
    "guaranteed hallucination reduction",
    "superiority across all model families",
    "superiority across all tasks",
  ],
});

/** Spec condition letters → harness condition ids */
export const SPEC_CONDITIONS = Object.freeze({
  A: { id: "raw_corpus", label: "FULL RAW" },
  B: { id: "dhtp_packet", label: "DHTP" },
  C: { id: "matched_budget_raw", label: "MATCHED-BUDGET RAW" },
  D: { id: "random_budget_raw", label: "RANDOM-BUDGET RAW" },
});

/** Phase 2 compact set (spec §9) */
export const PHASE2_CONFIG = Object.freeze({
  probes: [
    "fleet_health",
    "contradiction_detection",
    "decision",
    "temporal_reasoning",
    "anomaly_detection",
    "planning",
  ],
  trials: 20,
  conditions: ["dhtp_packet", "matched_budget_raw", "random_budget_raw"],
  interCallDelayMs: 4000,
});

/** Phase 1 complete baseline (spec §6) — rsb_c57a1d7b-6d5, 30 trials, successful calls only */
export const PHASE1_BASELINE = Object.freeze({
  runId: "rsb_c57a1d7b-6d5",
  trials: 30,
  probe: "fleet_health",
  successfulCallsOnly: true,
  results: {
    dhtp_packet: { quality: 0.906, tokensIn: 257, latencyMs: 6500, apiFailureRate: 0 },
    matched_budget_raw: { quality: 0.858, tokensIn: 276, latencyMs: 5100, apiFailureRate: 0 },
    random_budget_raw: { quality: 0.810, tokensIn: 135, latencyMs: 5300, apiFailureRate: 0 },
    raw_corpus: { quality: 0.198, tokensIn: 16997, latencyMs: 22500, apiFailureRate: 0.30 },
  },
  pairedDeltas: {
    dhtp_minus_raw: 0.708,
    dhtp_minus_matched: 0.048,
    dhtp_minus_random: 0.096,
  },
  claimLevel: 1,
});

/** Ablation conditions for Step 3 (spec §11) */
export const ABLATION_CONDITIONS = Object.freeze({
  dhtp_full: {
    id: "dhtp_full",
    label: "DHTP full (selection + structure)",
    pathId: "D",
    description: "DTU retrieval + DHTP cognitive packet",
  },
  selection_only: {
    id: "selection_only",
    label: "Selection only",
    pathId: "B",
    description: "Task-relevant DTUs, no DHTP compression",
  },
  structure_only: {
    id: "structure_only",
    label: "Structure only",
    pathId: "C",
    description: "DHTP structure on full corpus without DTU filter",
  },
});

export const FAILURE_CATEGORIES = Object.freeze([
  "model_reasoning_failure",
  "missing_information",
  "incorrect_dhtp_selection",
  "incorrect_dhtp_compilation",
  "evaluator_disagreement",
  "api_failure",
  "timeout",
  "malformed_response",
  "schema_failure",
  "hallucination",
  "harness_error",
]);

export const EXECUTION_ORDER = Object.freeze([
  "STEP_1_analyze_phase1",
  "STEP_2_phase2_generalization",
  "STEP_3_selection_ablations",
  "STEP_4_local_model_portability",
  "STEP_5_full_raw_selective",
  "STEP_6_human_blind_validation",
  "STEP_7_freeze_and_publish",
]);
