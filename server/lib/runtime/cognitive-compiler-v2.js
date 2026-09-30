// server/lib/runtime/cognitive-compiler-v2.js
//
// Cognitive Compiler v2 — minimum sufficient cognition for a specific inference.
// C* = argmin ContextCost(C) s.t. P(success|C) ≥ target

import { compileCognitivePacket } from "./dhtp-cognitive-compiler.js";
import { buildCompressionPolicy } from "./dhtp-policy.js";
import { anticipateContext, filterRecallByAnticipation } from "./predictive-context.js";
import {
  attachRecoveryContracts,
  recompileField,
  recordRecoveryEvent,
} from "./cognitive-recovery.js";
import { applyCompressionGovernor, recordGovernorOutcome } from "./compression-governor.js";
import {
  resolveBaseReasoningLevel,
  reasoningLevelToRouteHints,
  climbReasoningLadder,
  REASONING_LEVELS,
} from "./reasoning-ladder.js";
import {
  lookupCapabilityFamily,
  evaluateCapabilityPromotion,
  promoteCapabilityFamily,
} from "./capability-memory.js";
import {
  getOperationalSelfModel,
  selfModelConfidence,
  updateSelfModelFromOutcome,
} from "./dila-self-model.js";

/**
 * Compile minimum sufficient cognitive state for one inference step.
 */
export function compileMinimumSufficientCognition({
  ir,
  mission,
  step,
  stepIndex,
  route,
  db,
  recallPack,
  context,
  cacheHit = false,
  pceEligible = false,
  qualityTarget = 0.95,
  riskThreshold = 0.05,
  latencyBudgetMs,
  forceTier = null,
  skipGovernor = false,
} = {}) {
  if (!ir) return { ok: false, reason: "no_ir" };

  const taskClass = route?.taskClass || mission?.template || "reasoning";
  const goal = mission?.goal || ir.OBJECTIVE;

  const anticipation = anticipateContext({
    goal,
    taskClass,
    template: mission?.template,
    step,
    mission,
    priorSteps: context?.priorSteps,
  });

  const filteredRecall = recallPack
    ? filterRecallByAnticipation(recallPack, anticipation)
    : null;

  const familyLookup = db
    ? lookupCapabilityFamily(db, { mission, step, goal })
    : { hit: false };

  const selfModel = db ? getOperationalSelfModel(db, taskClass) : null;
  const confidence = db ? selfModelConfidence(db, taskClass) : { confidence: 0.5 };

  let policy = buildCompressionPolicy(ir, {
    stepIndex,
    missionAge: mission?.tick_count || 0,
    db,
    taskClass,
  });

  let governor = null;
  if (!skipGovernor && !forceTier) {
    governor = applyCompressionGovernor({ ir, policy, taskClass });
    if (governor.policyChanged) policy = governor.adjustedPolicy;
  }

  const policyFn = (field, value) => {
    const p = policy[field];
    if (p) return p;
    return { compressionLevel: "compact", decisionImpact: 0.5, importance: 0.5, freshness: 0.5 };
  };

  let compiled = compileCognitivePacket(ir, { policyFn, forceTier });
  compiled = attachRecoveryContracts(ir, compiled, policyFn);

  const ladder = resolveBaseReasoningLevel({
    taskClass,
    step,
    route,
    cacheHit: cacheHit || familyLookup.hit,
    pceEligible,
  });

  if (confidence.shouldEscalate) {
    ladder.level = Math.max(ladder.level, 5);
    ladder.escalated = true;
    ladder.reason = "self_model_low_confidence";
  }

  const routeHints = reasoningLevelToRouteHints(ladder);

  return {
    ok: true,
    version: "cognitive_compiler_v2",
    compiled,
    packet: compiled.packet,
    anticipation,
    filteredRecall,
    governor,
    recoveryContracts: compiled.recoveryContracts,
    recoverableFieldCount: compiled.recoverableFieldCount,
    reasoningLadder: ladder,
    routeHints,
    capabilityFamily: familyLookup.hit ? familyLookup.capability : null,
    selfModel: {
      confidence: confidence.confidence,
      shouldEscalate: confidence.shouldEscalate,
      compressionHarm: selfModel?.compressionHarm,
    },
    optimization: {
      objective: "min_context_cost",
      qualityTarget,
      riskThreshold,
      latencyBudgetMs,
      tokenCost: compiled.packetTokens,
      fullTokenCost: compiled.fullContextTokens,
      savingsPct: compiled.fullContextTokens > 0
        ? ((compiled.fullContextTokens - compiled.packetTokens) / compiled.fullContextTokens) * 100
        : 0,
    },
  };
}

/**
 * Handle model recovery request — expand one field progressively.
 */
export function handleRecoveryRequest(compiledState, pointer, { ir, policy, db, missionId } = {}) {
  const policyFn = (field, value) => policy?.[field] || { importance: 1 };
  const result = recompileField(compiledState.compiled || compiledState, pointer, { ir, policyFn });

  if (result.ok && db) {
    recordRecoveryEvent(db, {
      missionId,
      field: result.field,
      pointer,
      success: true,
    });
  }

  return result;
}

/**
 * Post-execution learning hook — governor outcomes + self-model update.
 */
export function recordCompilerLearning(db, {
  missionId,
  stepIndex,
  taskClass,
  policy,
  taskSuccess,
  verificationPassed,
  recoveryRequired,
  governor,
  reasoningLevel,
  modelRoute,
  tokenCost,
  qualityScore,
} = {}) {
  const outcomes = recordGovernorOutcome(db, {
    missionId,
    stepIndex,
    taskClass,
    policy,
    taskSuccess,
    recoveryRequired,
  });

  const selfUpdate = updateSelfModelFromOutcome(db, {
    taskClass,
    taskSuccess,
    verificationPassed,
    recoveryRequired,
    compressionGovernor: governor,
    reasoningLevel,
    modelRoute,
    tokenCost,
    qualityScore,
  });

  return {
    ok: true,
    governorOutcomes: outcomes,
    selfModel: selfUpdate,
  };
}

export {
  recompileField,
  anticipateContext,
  applyCompressionGovernor,
  climbReasoningLadder,
  REASONING_LEVELS,
  evaluateCapabilityPromotion,
  promoteCapabilityFamily,
  getOperationalSelfModel,
  selfModelConfidence,
};
