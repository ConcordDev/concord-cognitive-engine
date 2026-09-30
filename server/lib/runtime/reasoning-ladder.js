// server/lib/runtime/reasoning-ladder.js
//
// Explicit reasoning ladder — climb only as high as necessary.
// Level 0: deterministic → Level 8: human authorization

export const REASONING_LEVELS = Object.freeze({
  0: { id: 0, name: "deterministic_lookup", path: "lookup", llmRequired: false },
  1: { id: 1, name: "dtu_retrieval", path: "dtu_recall", llmRequired: false },
  2: { id: 2, name: "pce_procedural", path: "pce_deterministic", llmRequired: false },
  3: { id: 3, name: "cheap_model", path: "small_model_dhtp", llmRequired: true, tier: "repair" },
  4: { id: 4, name: "specialist_model", path: "medium_model_dhtp", llmRequired: true, tier: "utility" },
  5: { id: 5, name: "frontier_reasoning", path: "frontier_model_dhtp", llmRequired: true, tier: "conscious" },
  6: { id: 6, name: "parallel_reasoning", path: "parallel_council", llmRequired: true, tier: "conscious" },
  7: { id: 7, name: "adversarial_debate", path: "critic_debate", llmRequired: true, tier: "conscious" },
  8: { id: 8, name: "human_authorization", path: "human_gate", llmRequired: false },
});

const TASK_BASE_LEVEL = Object.freeze({
  classification: 3,
  cheap: 3,
  coding: 4,
  cognitive_probe: 4,
  reasoning: 5,
  research: 5,
});

/**
 * Determine starting reasoning level for a mission step.
 */
export function resolveBaseReasoningLevel({
  taskClass,
  step,
  route,
  cacheHit = false,
  pceEligible = false,
  minRep,
} = {}) {
  if (minRep?.level === "none" || pceEligible || step?.tool === "pce_execute") {
    return { level: 2, reason: "pce_deterministic", ...REASONING_LEVELS[2] };
  }
  if (cacheHit) {
    return { level: 0, reason: "cognitive_cache_hit", ...REASONING_LEVELS[0] };
  }
  if (step?.tool === "dtu_lookup" || step?.tool === "trace_recent") {
    return { level: 1, reason: "dtu_retrieval_only", ...REASONING_LEVELS[1] };
  }

  const base = TASK_BASE_LEVEL[taskClass] ?? TASK_BASE_LEVEL.reasoning;
  return { level: base, reason: `task_class_${taskClass}`, ...REASONING_LEVELS[base] };
}

/**
 * Climb reasoning ladder based on failure signals — returns target level.
 */
export function climbReasoningLadder({
  currentLevel = 4,
  taskSuccess,
  verificationPassed,
  recoveryAttempts = 0,
  f0Blocked = false,
  humanRequired = false,
  confidence,
} = {}) {
  if (humanRequired || f0Blocked) {
    return {
      level: 8,
      escalated: true,
      reason: f0Blocked ? "f0_authorization_required" : "human_required",
      ...REASONING_LEVELS[8],
    };
  }

  if (taskSuccess && verificationPassed) {
    return {
      level: currentLevel,
      escalated: false,
      reason: "success_at_current_level",
      ...REASONING_LEVELS[currentLevel],
    };
  }

  let target = currentLevel;
  if (!verificationPassed && recoveryAttempts >= 1) target = Math.min(7, currentLevel + 1);
  else if (!taskSuccess) target = Math.min(6, currentLevel + 1);
  if (confidence != null && confidence < 0.3) target = Math.max(target, 5);
  if (recoveryAttempts >= 2) target = Math.min(7, target + 1);

  return {
    level: target,
    escalated: target > currentLevel,
    fromLevel: currentLevel,
    reason: taskSuccess ? "verification_failed" : "task_failed",
    ...REASONING_LEVELS[target],
  };
}

/**
 * Map reasoning level to model-router hints.
 */
export function reasoningLevelToRouteHints(ladderResult) {
  const level = ladderResult?.level ?? 4;
  const meta = REASONING_LEVELS[level] || REASONING_LEVELS[4];
  return {
    reasoningLevel: level,
    reasoningPath: meta.path,
    llmRequired: meta.llmRequired,
    brainTier: meta.tier || "utility",
    minimumRepresentation: {
      level: level <= 2 ? "none" : level <= 3 ? "hash" : level <= 4 ? "compact" : "verbatim",
      llmTokens: level <= 2 ? 0 : level <= 3 ? "minimal" : "moderate",
      path: meta.path,
    },
    escalate: ladderResult?.escalated ?? false,
    escalateReason: ladderResult?.reason,
  };
}
