// server/lib/runtime/dhtp-policy.js
//
// Adaptive compression policy — importance, freshness, recoverability + learned overrides.

import { scoreBlock } from "../dhtp-cognitive-ir.js";
import { getLearnedPolicies } from "./dhtp-policy-learner.js";

export const COMPRESSION_LEVELS = Object.freeze([
  "verbatim",
  "compact",
  "hash",
  "archive",
  "forget",
  "recover_on_demand",
]);

/**
 * Decide compression level for a context block.
 */
export function decideCompressionLevel(blockMeta, learnedOverride) {
  if (learnedOverride?.compression_level) {
    return learnedOverride.compression_level;
  }
  if (!blockMeta) return "compact";
  if (blockMeta.decisionImpact >= 0.95 || blockMeta.importance >= 0.95) return "verbatim";
  if (blockMeta.recoverability >= 0.85 && blockMeta.importance < 0.5) return "recover_on_demand";
  if (blockMeta.importance < 0.3 && blockMeta.freshness < 0.3) return "forget";
  if (blockMeta.importance < 0.4) return "archive";
  if (blockMeta.importance >= 0.7) return "compact";
  return "hash";
}

/**
 * Score all IR fields and return policy map (with learned overrides when db provided).
 */
export function buildCompressionPolicy(ir, ctx = {}) {
  const learned = ctx.db && ctx.taskClass
    ? getLearnedPolicies(ctx.db, ctx.taskClass)
    : (ctx.learnedPolicies || {});

  const policies = {};
  for (const [field, value] of Object.entries(ir || {})) {
    if (value == null || value === "") continue;
    const scored = scoreBlock(field, value, ctx);
    const learnedRow = learned[field];
    policies[field] = {
      ...scored,
      compressionLevel: decideCompressionLevel(scored, learnedRow),
      learned: learnedRow ? {
        fromSamples: learnedRow.sample_count,
        successRate: learnedRow.success_rate,
        confidence: learnedRow.confidence,
      } : null,
    };
  }
  return policies;
}

/**
 * Minimum representation hint for model router — drives DHTP-aware routing.
 */
export function minimumRepresentationForTask({ taskClass, deterministicEligible = false } = {}) {
  if (deterministicEligible) {
    return { level: "none", llmTokens: 0, path: "pce_deterministic" };
  }
  if (taskClass === "classification" || taskClass === "cheap") {
    return { level: "hash", llmTokens: "minimal", path: "small_model_dhtp" };
  }
  if (taskClass === "coding") {
    return { level: "compact", llmTokens: "moderate", path: "medium_model_dhtp" };
  }
  if (taskClass === "reasoning" || taskClass === "research") {
    return { level: "verbatim", llmTokens: "moderate", path: "frontier_model_dhtp" };
  }
  return { level: "compact", llmTokens: "moderate", path: "default_dhtp" };
}
