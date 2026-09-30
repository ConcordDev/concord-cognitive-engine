// server/lib/runtime/compression-governor.js
//
// Quality-preserving compression governor — counterfactual gate before promotion.

import { runCounterfactualContextTest, persistCounterfactualTest } from "./counterfactual-context.js";
import { legacyLevelToTier } from "./dhtp-cognitive-compiler.js";
import { recordFieldOutcomes } from "./dhtp-policy-learner.js";

const DEFAULT_QUALITY_TOLERANCE = Number(process.env.DHTP_CF_QUALITY_TOLERANCE ?? 0.005);
const DEFAULT_MIN_TOKEN_SAVINGS = Number(process.env.DHTP_CF_MIN_TOKEN_SAVINGS ?? 0.10);

/**
 * Run counterfactual governor on IR + policy before compile promotion.
 */
export function applyCompressionGovernor({ ir, policy, taskClass, qualityTolerance, minTokenSavings } = {}) {
  if (!ir) return { ok: false, reason: "no_ir" };

  const cf = runCounterfactualContextTest({
    ir,
    policy,
    qualityTolerance: qualityTolerance ?? DEFAULT_QUALITY_TOLERANCE,
    minTokenSavings: minTokenSavings ?? DEFAULT_MIN_TOKEN_SAVINGS,
  });

  const adjustedPolicy = { ...policy };
  if (!cf.promoted && cf.reason?.startsWith("quality_regression")) {
    for (const [field, meta] of Object.entries(adjustedPolicy)) {
      if (!meta) continue;
      const rank = ["forget", "hash", "archive", "compact", "verbatim", "recover_on_demand"];
      const idx = rank.indexOf(meta.compressionLevel || "compact");
      if (idx >= 0 && idx < rank.length - 1) {
        adjustedPolicy[field] = {
          ...meta,
          compressionLevel: rank[idx + 1] || "verbatim",
          governorDemoted: true,
          governorReason: cf.reason,
        };
      }
    }
  }

  return {
    ok: true,
    counterfactual: cf,
    promoted: cf.promoted,
    adjustedPolicy,
    policyChanged: JSON.stringify(adjustedPolicy) !== JSON.stringify(policy),
    metrics: {
      qualityDelta: cf.qualityDelta,
      tokenSavingsPct: cf.tokenSavingsPct,
      fullTokens: cf.full?.tokens,
      compressedTokens: cf.compressed?.tokens,
    },
  };
}

/**
 * Promote counterfactual-passing policies into learned store.
 */
export function promotePolicyFromCounterfactual(db, {
  ir, policy, taskClass, missionId, persist = true,
} = {}) {
  const gov = applyCompressionGovernor({ ir, policy, taskClass });
  if (!gov.ok) return gov;

  if (persist && db && gov.promoted) {
    persistCounterfactualTest(db, {
      ruleId: `gov_${taskClass || "default"}`,
      field: null,
      taskClass,
      result: gov.counterfactual,
    });

    for (const [field, meta] of Object.entries(policy || {})) {
      if (!meta?.compressionLevel) continue;
      const tier = legacyLevelToTier(meta.compressionLevel);
      persistCounterfactualTest(db, {
        ruleId: `gov_${taskClass}_${field}`,
        field,
        taskClass,
        result: {
          ok: true,
          full: { tokens: gov.metrics.fullTokens, quality: 1 },
          compressed: { tokens: gov.metrics.compressedTokens, tier },
          qualityDelta: gov.metrics.qualityDelta,
          tokenSavingsPct: gov.metrics.tokenSavingsPct,
          promoted: gov.promoted,
          rejected: !gov.promoted,
          reason: gov.counterfactual.reason,
        },
      });
    }
  }

  return {
    ...gov,
    persisted: persist && !!db,
  };
}

/**
 * Record post-execution outcome and feed policy learner.
 */
export function recordGovernorOutcome(db, {
  missionId, stepIndex, taskClass, policy, taskSuccess, recoveryRequired,
} = {}) {
  const fieldRecord = recordFieldOutcomes(db, {
    missionId, stepIndex, taskClass, policy, taskSuccess, recoveryRequired,
  });

  return {
    ok: true,
    fieldOutcomesRecorded: fieldRecord.recorded || 0,
    taskSuccess,
    recoveryRequired,
  };
}
