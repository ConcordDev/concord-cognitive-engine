// server/lib/runtime/blind-evaluator.js
//
// Independent blind evaluator for Dila-vs-Raw quality comparison.
// Receives task + output + objective verification — never the producer identity.

import crypto from "node:crypto";
import { getMission } from "../mission-runtime.js";
import { verifyMissionDelta } from "./dgb-benchmark.js";
import { qualityFromVerification } from "../pce/quality-score.js";
import {
  estimateInvocationCost,
  resolvePricingConfig,
} from "./cognitive-economics.js";
import { resolveInvocationBilling } from "./provider-billing.js";

function safeParse(json, fallback = null) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

/**
 * Capture mission outputs for blind comparison — actual step results, not just pass/fail.
 */
export function captureMissionOutput(db, missionId) {
  if (!db || !missionId) return { ok: false, reason: "no_mission" };

  const mission = getMission(db, missionId);
  if (!mission) return { ok: false, reason: "mission_not_found" };

  const steps = db.prepare(`
    SELECT step_index, tool_name, status, result_json, args_json
    FROM mission_step_log WHERE mission_id = ? ORDER BY step_index
  `).all(missionId);

  const deltaStep = steps.find((s) => s.tool_name === "cognitive_delta_execute");
  const deltaResult = safeParse(deltaStep?.result_json);

  const completedOutputs = steps
    .filter((s) => s.status === "completed")
    .map((s) => ({
      stepIndex: s.step_index,
      tool: s.tool_name,
      result: safeParse(s.result_json),
      args: safeParse(s.args_json),
    }));

  return {
    ok: true,
    missionId,
    task: {
      goal: mission.goal,
      template: mission.template,
    },
    status: mission.status,
    completed: mission.status === "completed",
    delta: deltaResult ? {
      stage: deltaResult.stage,
      action: deltaResult.delta?.ACTION,
      confidence: deltaResult.delta?.CONFIDENCE,
      rationaleRef: deltaResult.delta?.RATIONALE_REF,
      expectedResult: deltaResult.delta?.EXPECTED_RESULT,
      principle: deltaResult.principle,
    } : null,
    steps: steps.map((s) => ({
      index: s.step_index,
      tool: s.tool_name,
      status: s.status,
    })),
    outputs: completedOutputs,
    executiveState: safeParse(mission.executive_state_json),
    route: safeParse(mission.last_route_json),
  };
}

/**
 * Gather objective verification signals — tests, gates, delta checks.
 * No producer identity; suitable for independent evaluator input.
 */
export function gatherObjectiveVerification(db, missionId, {
  verifyDelta = {},
  metrics = {},
} = {}) {
  const output = captureMissionOutput(db, missionId);
  if (!output.ok) return { ok: false, reason: output.reason };

  const deltaVerify = verifyMissionDelta(db, missionId, verifyDelta);
  const stepLog = output.steps || [];
  const completed = stepLog.filter((s) => s.status === "completed").length;
  const failed = stepLog.filter((s) => s.status === "failed").length;
  const total = stepLog.length || 1;

  const gates = [
    { gate: "mission_completed", ok: output.completed },
    { gate: "delta_committed", ok: deltaVerify.checks?.stageOk ?? false },
    { gate: "delta_action", ok: deltaVerify.checks?.actionOk ?? false },
    { gate: "delta_confidence", ok: deltaVerify.checks?.confOk ?? false },
    { gate: "delta_rationale", ok: deltaVerify.checks?.rationaleOk ?? false },
    { gate: "step_verification", ok: failed === 0 && completed > 0 },
    { gate: "f0_safety", ok: (metrics.reliability?.f0ViolationsBlocked ?? 0) === 0
      || metrics.reliability?.f0ViolationsBlocked === 1 },
  ];

  const testsPassed = deltaVerify.verified && output.completed && failed === 0;

  return {
    ok: true,
    missionCompleted: output.completed,
    verificationPassRate: completed / total,
    failedSteps: failed,
    deltaVerified: deltaVerify.verified,
    deltaChecks: deltaVerify.checks,
    testsPassed,
    gates,
    delta: deltaVerify,
    regression: metrics.reliability?.recoveryRequired ? 1 : 0,
    humanIntervention: metrics.reliability?.humanIntervention || 0,
  };
}

/**
 * Score one dimension 0–1 from objective signals.
 */
function scoreCorrectness(objective) {
  let score = 0;
  if (objective.missionCompleted) score += 0.4;
  if (objective.deltaVerified) score += 0.35;
  if (objective.verificationPassRate >= 1) score += 0.15;
  if (objective.failedSteps === 0) score += 0.1;
  return Math.min(1, score);
}

function scoreVerification(objective) {
  const gates = objective.gates || [];
  const passed = gates.filter((g) => g.ok).length;
  const gateRate = gates.length ? passed / gates.length : 0;
  const testWeight = objective.testsPassed ? 0.5 : 0;
  return Math.min(1, gateRate * 0.5 + testWeight);
}

function scoreQuality(output, objective) {
  const verification = { gates: objective.gates, testsPassed: objective.testsPassed };
  const pceQuality = qualityFromVerification(verification);

  let structural = 0;
  if (output.delta?.rationaleRef) structural += 0.35;
  if (output.delta?.confidence != null && output.delta.confidence >= 0.3) structural += 0.25;
  if (output.delta?.expectedResult) structural += 0.2;
  if (output.delta?.stage === "committed") structural += 0.2;

  return Math.min(1, pceQuality * 0.6 + structural * 0.4);
}

function scoreGeneralization(generalizationResult) {
  if (!generalizationResult) return 0.5;
  if (generalizationResult.variantVerified) return 1;
  if (generalizationResult.variantCompleted) return 0.6;
  return 0.2;
}

function scoreEfficiency(metrics, baseline = null) {
  const tokens = metrics?.efficiency?.actualModelInputTokens ?? metrics?.actualModelInputTokens ?? 0;
  const latency = metrics?.durationMs ?? metrics?.latencyMs ?? 0;
  const cost = metrics?.costUsd ?? 0;

  if (baseline) {
    const tokenScore = baseline.tokens > 0
      ? Math.max(0, 1 - tokens / baseline.tokens)
      : (tokens === 0 ? 1 : 0);
    const latencyScore = baseline.latency > 0
      ? Math.max(0, 1 - latency / baseline.latency)
      : (latency === 0 ? 1 : 0);
    const costScore = baseline.cost > 0
      ? Math.max(0, 1 - cost / baseline.cost)
      : (cost === 0 ? 1 : 0);
    return (tokenScore + latencyScore + costScore) / 3;
  }

  const maxTokens = 50_000;
  const maxLatency = 30_000;
  const tokenScore = Math.max(0, 1 - tokens / maxTokens);
  const latencyScore = Math.max(0, 1 - latency / maxLatency);
  return (tokenScore + latencyScore) / 2;
}

/**
 * Independent blind evaluation — producer identity MUST NOT be passed in.
 */
export function evaluateBlindSubmission({
  submissionId,
  task,
  output,
  objectiveVerification,
  efficiencyMetrics,
  generalizationResult,
  efficiencyBaseline,
} = {}) {
  if (!output || !objectiveVerification) {
    return { ok: false, reason: "missing_submission_data" };
  }

  const correctness = scoreCorrectness(objectiveVerification);
  const verification = scoreVerification(objectiveVerification);
  const quality = scoreQuality(output, objectiveVerification);
  const generalization = scoreGeneralization(generalizationResult);
  const efficiency = scoreEfficiency(efficiencyMetrics, efficiencyBaseline);

  const composite = (
    correctness * 0.25
    + verification * 0.35
    + quality * 0.15
    + generalization * 0.15
    + efficiency * 0.10
  );

  return {
    ok: true,
    submissionId: submissionId || `sub_${crypto.randomUUID().slice(0, 8)}`,
    task,
    dimensions: {
      correctness,
      verification,
      quality,
      generalization,
      efficiency,
    },
    composite,
    regressionRate: objectiveVerification.regression || 0,
    humanInterventionRate: objectiveVerification.humanIntervention || 0,
    objectiveSignals: {
      missionCompleted: objectiveVerification.missionCompleted,
      deltaVerified: objectiveVerification.deltaVerified,
      verificationPassRate: objectiveVerification.verificationPassRate,
      testsPassed: objectiveVerification.testsPassed,
      gates: objectiveVerification.gates,
    },
    outputSummary: {
      status: output.status,
      deltaAction: output.delta?.action,
      deltaStage: output.delta?.stage,
      stepCount: output.steps?.length || 0,
    },
  };
}

/**
 * Compare two blind evaluations (e.g. Raw vs Dila) — dimension deltas.
 */
export function compareBlindEvaluations(evalA, evalB, { labelA = "A", labelB = "B" } = {}) {
  const dims = ["correctness", "verification", "quality", "generalization", "efficiency"];
  const deltas = {};
  for (const d of dims) {
    deltas[d] = (evalB.dimensions?.[d] ?? 0) - (evalA.dimensions?.[d] ?? 0);
  }

  const compositeDelta = evalB.composite - evalA.composite;
  const bWins = compositeDelta > 0.01;
  const tie = Math.abs(compositeDelta) <= 0.01;
  const aWins = compositeDelta < -0.01;

  return {
    [labelA]: evalA,
    [labelB]: evalB,
    compositeDelta,
    dimensionDeltas: deltas,
    winner: tie ? "tie" : (bWins ? labelB : labelA),
    qualityParityOrBetter: evalB.composite >= evalA.composite - 0.01,
    efficiencyBetter: (evalB.dimensions?.efficiency ?? 0) > (evalA.dimensions?.efficiency ?? 0),
    targetMet: evalB.composite >= evalA.composite - 0.01
      && (evalB.dimensions?.efficiency ?? 0) > (evalA.dimensions?.efficiency ?? 0),
  };
}

/**
 * Score SWE-style objective verification — tests pass is primary signal.
 */
export function gatherSweObjectiveVerification(sweResult) {
  const passed = sweResult?.results?.filter((r) => r.ok).length || 0;
  const total = sweResult?.results?.length || 1;
  const passRate = passed / total;

  const gates = [
    { gate: "suite_passed", ok: sweResult?.ok === true },
    { gate: "all_cases_passed", ok: passed === total },
    { gate: "pass_rate_100", ok: passRate >= 1 },
  ];

  return {
    ok: true,
    missionCompleted: sweResult?.ok === true,
    verificationPassRate: passRate,
    failedSteps: total - passed,
    deltaVerified: sweResult?.ok === true,
    deltaChecks: { stageOk: sweResult?.ok, actionOk: sweResult?.ok, confOk: true, rationaleOk: true },
    testsPassed: sweResult?.ok === true,
    gates,
    regression: 0,
    humanIntervention: 0,
    swePassRate: passRate,
    swePassed: passed,
    sweTotal: total,
  };
}

/**
 * Evaluate SWE harness submission for blind comparison.
 */
export function evaluateSweBlindSubmission({
  submissionId,
  task,
  sweResult,
  efficiencyMetrics,
} = {}) {
  const objective = gatherSweObjectiveVerification(sweResult);
  return evaluateBlindSubmission({
    submissionId,
    task,
    output: {
      ok: sweResult?.ok,
      status: sweResult?.ok ? "completed" : "failed",
      completed: sweResult?.ok,
      delta: null,
      steps: (sweResult?.results || []).map((r, i) => ({
        index: i,
        tool: "swe_case",
        status: r.ok ? "completed" : "failed",
      })),
      outputs: sweResult?.results || [],
    },
    objectiveVerification: objective,
    efficiencyMetrics: efficiencyMetrics || { tokens: 0, latency: 0, cost: 0 },
  });
}

/**
 * Estimate cost for efficiency scoring from mission metrics.
 * Prefers real provider billing when COGNITIVE_ECON_MODE=billed.
 */
export function efficiencyMetricsFromMission(metrics, pricing, { db, missionId, pathId, stepIndex } = {}) {
  const p = pricing || resolvePricingConfig();

  const billing = resolveInvocationBilling({
    db,
    missionId,
    stepIndex,
    metrics,
    pricing: p,
  });

  if (billing.ok && billing.mode === "billed" && billing.source !== "estimated") {
    const inputTok = billing.promptTokens || metrics?.efficiency?.actualModelInputTokens || 0;
    return {
      actualModelInputTokens: inputTok,
      durationMs: metrics?.durationMs || 0,
      costUsd: billing.totalUsd,
      tokens: inputTok,
      latency: metrics?.durationMs || 0,
      cost: billing.totalUsd,
      billingSource: billing.source,
      billingMode: billing.mode,
      path: pathId,
    };
  }

  const inputTok = metrics?.efficiency?.actualModelInputTokens || 0;
  const cacheHit = metrics?.intelligence?.cacheHit === 1;
  const cost = estimateInvocationCost({
    inputTokens: inputTok,
    cacheHit,
    skipLlm: metrics?.efficiency?.skipLlm === 1,
    pceDeterministic: (metrics?.efficiency?.llmCallsAvoidedPce || 0) > 0,
    pricing: p,
  });

  return {
    actualModelInputTokens: inputTok,
    durationMs: metrics?.durationMs || 0,
    costUsd: cost.totalUsd,
    tokens: inputTok,
    latency: metrics?.durationMs || 0,
    cost: cost.totalUsd,
    billingSource: "estimated",
    billingMode: p.mode || "estimated",
    path: pathId,
  };
}

export const BLIND_DIMENSION_WEIGHTS = Object.freeze({
  correctness: 0.25,
  verification: 0.35,
  quality: 0.15,
  generalization: 0.15,
  efficiency: 0.10,
});
