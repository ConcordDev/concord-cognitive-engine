// server/lib/runtime/cognitive-delta-runtime.js
//
// Full delta execution: validate → critic → F0 → execute → verify → commit → DTU.
// Model proposes cognition. Concord owns reality.

import { processCognitiveResponse } from "./dhtp-compiler.js";
import { critiqueResult, runCriticPass } from "./critic.js";
import { resolveAuthGateMode } from "../auth-gate/policy.js";
import { recordCausalChain } from "./causal-memory.js";
import { recordNode } from "./memory-graph.js";
import { storeCognitiveSolution, fingerprintCognition } from "./cognitive-cache.js";
import { recordFieldOutcomes } from "./dhtp-policy-learner.js";
import { recordDhtpMetric } from "./dhtp-metrics.js";

const READ_ONLY_ACTIONS = new Set([
  "analyze", "observe", "inspect", "read", "list", "status", "report",
]);

/**
 * Map structured @ACTION to executable dispatch.
 */
function resolveActionDispatch(delta, { step, mission } = {}) {
  const action = String(delta.ACTION || "").trim();
  const lower = action.toLowerCase();

  if (lower.startsWith("dispatch:")) {
    const tool = action.slice("dispatch:".length).trim();
    return { kind: "mcp", tool, args: step?.args || {} };
  }
  if (lower === "pce_execute" || lower === "patch_file" || lower === "coding_pipeline") {
    return { kind: "pce", intent: mission?.goal || delta.EXPECTED_RESULT || "apply patch" };
  }
  if (READ_ONLY_ACTIONS.has(lower)) {
    return { kind: "observe", tool: step?.tool || "observe" };
  }
  if (step?.tool && step.tool !== "cognitive_delta") {
    return { kind: "mcp", tool: step.tool, args: step?.args || {} };
  }
  return { kind: "unknown", action };
}

/**
 * Execute procedural action after validation gates pass.
 */
async function executeResolvedAction(dispatch, { db, mission, step, dispatchMCP, gateCtx } = {}) {
  if (dispatch.kind === "observe") {
    return { ok: true, result: { ok: true, observation: { action: dispatch.tool, mode: "read_only" } } };
  }

  if (dispatch.kind === "pce") {
    const { runCodingPipeline } = await import("../pce/coding-pipeline.js");
    const pipeline = await runCodingPipeline({
      db,
      intent: dispatch.intent,
      repoRoot: step?.args?.repoRoot,
      missionId: mission?.id,
      params: step?.args?.params,
      manualSteps: step?.args?.steps || null,
    });
    return { ok: pipeline.ok !== false, result: pipeline, gate: "pce_verification" };
  }

  if (dispatch.kind === "mcp" && typeof dispatchMCP === "function") {
    const gateResult = await dispatchMCP(dispatch.tool, dispatch.args || {}, gateCtx);
    return { ok: gateResult?.ok !== false, result: gateResult?.result ?? gateResult, f0Decision: gateResult?.decision };
  }

  return { ok: false, reason: "unresolved_action", dispatch };
}

/**
 * Commit outcome to DTU / memory graph.
 */
function commitCognitiveOutcome(db, {
  mission, step, delta, execution, critic, fingerprint,
} = {}) {
  if (!db) return { ok: false };

  const mem = recordNode(db, {
    memoryClass: execution.ok ? "durable" : "episodic",
    kind: "cognitive_delta_outcome",
    refId: mission?.id,
    title: `Delta: ${delta.ACTION} → ${execution.ok ? "verified" : "failed"}`,
    content: {
      delta,
      fingerprint,
      critic: critic?.verdict,
      result: execution.result,
      principle: "model_proposes_concord_commits",
    },
    provenance: { mission_id: mission?.id, step_tool: step?.tool },
  });

  recordCausalChain(db, {
    missionId: mission?.id,
    event: { kind: "cognitive_delta", action: delta.ACTION },
    action: { tool: step?.tool, delta },
    result: { ok: execution.ok, summary: execution.result },
    cause: execution.ok ? { kind: "verified_execution" } : { kind: "execution_failed" },
    consequence: { critic: critic?.verdict },
    lesson: execution.ok
      ? `Verified cognitive pattern: ${delta.ACTION} for ${step?.tool}`
      : `Cognitive delta ${delta.ACTION} failed — do not cache`,
  });

  return { ok: true, memoryNodeId: mem?.nodeId };
}

/**
 * Full cognitive delta execution pipeline.
 */
export async function executeCognitiveDelta({
  db,
  text,
  delta: preParsedDelta,
  mission,
  step,
  stepIndex,
  dispatchMCP,
  gateCtx,
  cognition,
  route,
} = {}) {
  const started = Date.now();

  const f0Mode = resolveAuthGateMode(gateCtx || {});
  const f0Authorized = f0Mode === "enforce"
    || gateCtx?.actor?.role === "admin"
    || gateCtx?.actor?.role === "sovereign"
    || mission?.source === "operator";

  const parsed = preParsedDelta
    ? { ok: true, delta: preParsedDelta, validation: { ok: true } }
    : processCognitiveResponse(text, { f0Authorized });

  if (!parsed.ok || !parsed.validation?.ok) {
    return {
      ok: false,
      stage: "validate",
      reason: parsed.validation?.reason || parsed.reason || "invalid_delta",
      parsed,
    };
  }

  const delta = parsed.delta;
  const dispatch = resolveActionDispatch(delta, { step, mission });

  const preCritic = critiqueResult({
    objective: mission?.goal,
    result: { action: delta.ACTION, confidence: delta.CONFIDENCE },
    executionOutcome: "UNKNOWN",
  });
  if (preCritic.verdict === "reject" && !READ_ONLY_ACTIONS.has(String(delta.ACTION).toLowerCase())) {
    return { ok: false, stage: "critic", reason: "pre_execution_reject", critic: preCritic };
  }

  const execution = await executeResolvedAction(dispatch, { db, mission, step, dispatchMCP, gateCtx });
  const durationMs = Date.now() - started;

  const postCritic = await runCriticPass({
    db,
    mission,
    stepResult: execution.result,
    executionOutcome: execution.ok ? "SUCCESS" : "FAILED",
  });

  const verified = execution.ok && postCritic.verdict !== "reject";
  const fingerprint = cognition?.fingerprint
    || fingerprintCognition({ mission, step, ir: cognition?.ir, goal: mission?.goal });

  if (verified && fingerprint) {
    storeCognitiveSolution(db, {
      fingerprint,
      mission,
      step,
      goal: mission?.goal,
      solution: { dispatch, result: execution.result },
      delta,
      verified: true,
    });
  }

  if (cognition?.policy) {
    recordFieldOutcomes(db, {
      missionId: mission?.id,
      stepIndex,
      taskClass: route?.taskClass,
      policy: cognition.policy,
      taskSuccess: verified,
      recoveryRequired: postCritic.progression === "recover",
    });
  }

  recordDhtpMetric(db, {
    missionId: mission?.id,
    stepIndex,
    taskClass: route?.taskClass,
    taskSuccess: verified,
    verificationSuccess: verified,
    recoveryRequired: postCritic.progression === "recover",
    latencyMs: durationMs,
    path: cognition?.cacheHit ? "cognitive_cache_reuse" : "delta_execution",
  });

  const commit = commitCognitiveOutcome(db, {
    mission, step, delta, execution, critic: postCritic, fingerprint,
  });

  return {
    ok: verified,
    stage: verified ? "committed" : "failed",
    delta,
    dispatch,
    execution,
    critic: postCritic,
    commit,
    fingerprint,
    durationMs,
    principle: "model_proposes_concord_commits",
  };
}

export { tryCognitiveCache } from "./cognitive-cache.js";
