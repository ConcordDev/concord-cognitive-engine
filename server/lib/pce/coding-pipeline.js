// server/lib/pce/coding-pipeline.js
//
// Unified coding pipeline — PCE deterministic first, LLM worker fallback.

import { executePceTask } from "./pce-engine.js";
import { recordPceMetric } from "./pce-metrics.js";
import { buildRepoBrain, impactAnalysis } from "./repo-brain.js";
import { executeWorkerTask } from "../runtime/worker-adapters.js";
import { routeModel, recordRoutingOutcome } from "../runtime/model-router.js";

/**
 * Run the full coding pipeline for a mission step.
 * Path: intent → repo brain → PCE → (if novel) LLM worker → metrics
 */
export async function runCodingPipeline({
  db,
  intent,
  repoRoot,
  missionId,
  mission,
  step,
  params = {},
  manualSteps = null,
  dispatchMCP,
} = {}) {
  const started = Date.now();
  const goal = intent || mission?.goal || mission?.title;

  const brain = await buildRepoBrain(db, repoRoot, {
    query: params.query || goal?.match(/[a-z][a-z0-9_-]{2,}/gi)?.[0],
  });
  const impact = impactAnalysis(brain, {
    filePath: params.filePath,
    symbol: params.symbol,
  });

  const pce = await executePceTask({
    db,
    intent: goal,
    repoRoot,
    missionId,
    params: { ...params, impact },
    manualSteps,
  });

  if (pce.ok) {
    recordPceMetric(db, {
      missionId,
      category: "coding",
      path: "deterministic",
      ok: true,
      deterministic: true,
      durationMs: Date.now() - started,
      filesChanged: pce.changedFiles?.length || 0,
      testsPassed: pce.verification?.testsPassed,
      qualityScore: pce.qualityScore,
      meta: { patternId: pce.patternId, mode: pce.mode, impact },
    });
    return {
      ok: true,
      path: "deterministic",
      brain: brain.summary,
      impact,
      pce,
    };
  }

  if (pce.reason !== "requires_llm" && pce.reason !== "no_matching_pattern") {
    recordPceMetric(db, {
      missionId,
      category: "coding",
      path: "failed",
      ok: false,
      deterministic: pce.deterministic !== false,
      durationMs: Date.now() - started,
      meta: { reason: pce.reason, impact },
    });
    return { ok: false, path: "failed", reason: pce.reason, brain: brain.summary, impact, pce };
  }

  const route = await routeModel({
    db,
    tool: "coding",
    goal,
    missionId,
    traceId: mission?.trace_id,
  });

  const workerId = mission?.assigned_worker_id || route.workerId || "wr-groq-1";
  const worker = await executeWorkerTask({
    workerId,
    task: "coding_synthesis",
    content: JSON.stringify({
      intent: goal,
      impact,
      brainSummary: brain.summary,
      pceAttempt: { reason: pce.reason, mode: pce.mode },
      constraints: [
        "Use existing project patterns",
        "Do not modify tests unless necessary",
        "Return search/replace patches only",
      ],
    }),
    taskClass: "coding",
  });

  recordRoutingOutcome(db, {
    taskClass: "coding",
    provider: worker.provider,
    workerId,
    success: worker.ok,
    latencyMs: worker.latencyMs,
    missionId,
    traceId: mission?.trace_id,
  });

  recordPceMetric(db, {
    missionId,
    category: "coding",
    path: "llm",
    ok: worker.ok,
    deterministic: false,
    durationMs: Date.now() - started,
    tokensUsed: (worker.tokensIn || 0) + (worker.tokensOut || 0),
    meta: { workerId, provider: worker.provider, impact },
  });

  return {
    ok: worker.ok,
    path: "llm",
    brain: brain.summary,
    impact,
    pce: { skipped: true, reason: pce.reason },
    worker,
    route,
    requiresManualApply: true,
    note: "LLM produced analysis — apply patches via pce_execute with manual steps",
  };
}
