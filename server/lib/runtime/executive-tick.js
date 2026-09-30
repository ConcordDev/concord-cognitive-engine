// server/lib/runtime/executive-tick.js
//
// Tier 1 executive loop — plan → route → execute → observe → critic → recover.

import { routeModel, recordRoutingOutcome } from "./model-router.js";
import { recordWorkerOutcome } from "./agent-org.js";
import { classifyExecutionResult, runCriticPass } from "./critic.js";
import { assembleExecutiveContext } from "./context-assembler.js";
import { retrieveRelevantLessons } from "./causal-memory.js";
import { detectWorkspaceChanges } from "./workspace-sensor.js";
import {
  loadLedger,
  saveLedger,
  recordLedgerEvent,
} from "./execution-ledger.js";
import { attemptRecovery } from "./recovery.js";
import { loadLatestCheckpoint } from "./agent-loop.js";

const WORKER_DISPATCH_TOOLS = new Set([
  "coding_loop_search",
  "coding_loop_verify",
  "coding_loop_closure",
  "pce_execute",
  "repo_graph_index",
]);

/**
 * Pre-execution: route, assemble context, optionally vault-dispatch to worker.
 */
export async function prepareExecutiveStep({
  db, mission, step, stepIndex, dispatchMCP,
} = {}) {
  let route = await routeModel({
    db,
    tool: step.tool,
    goal: mission.goal || mission.title,
    missionId: mission.id,
    traceId: mission.trace_id,
  });

  let ledger = loadLedger(db, mission.id, stepIndex);
  ledger = recordLedgerEvent(ledger, "pending", {
    tool: step.tool,
    route: route.workerId,
    taskClass: route.taskClass,
  });

  const context = await assembleExecutiveContext({
    db, mission, step, stepIndex, route, ledger, dispatchMCP,
    lessons: retrieveRelevantLessons(db, { tool: step.tool, goal: mission.goal, limit: 3 }),
  });

  if (context.routeHints) {
    route = {
      ...route,
      maxResponseTokens: context.routeHints.maxResponseTokens,
      dtuBudgetPct: context.routeHints.dtuBudgetPct,
      minimumRepresentation: context.routeHints.minimumRepresentation,
      dhtpCompiled: true,
    };
  }

  let workspaceDelta = null;
  try {
    workspaceDelta = await detectWorkspaceChanges(db, {
      missionId: mission.id,
      watchPaths: step.args?.watchPaths || [],
    });
    if (workspaceDelta?.changed) {
      ledger = recordLedgerEvent(ledger, "invalidated", {
        reason: "workspace_changed",
        changes: workspaceDelta.changes,
      });
    }
  } catch { /* optional */ }

  let workerDispatch = null;
  const workerId = mission.assigned_worker_id || route.workerId;
  if (
    workerId
    && typeof dispatchMCP === "function"
    && WORKER_DISPATCH_TOOLS.has(step.tool)
    && process.env.CONCORD_DILA_WORKER_DISPATCH !== "0"
  ) {
    try {
      workerDispatch = await dispatchMCP("dila_dispatch", {
        worker: workerId,
        task: step.tool,
        content: JSON.stringify({
          missionId: mission.id,
          stepIndex,
          goal: mission.goal,
          args: step.args || {},
          dhtp: context.cognition?.cognitivePacket || null,
        }),
        priority: "action",
      }, { db, trace_id: mission.trace_id });
      ledger = recordLedgerEvent(ledger, "attempted", {
        kind: "worker_dispatch",
        worker: workerId,
        ok: workerDispatch?.ok !== false,
      });
    } catch { /* optional */ }
  }

  try {
    const cols = db.prepare(`PRAGMA table_info(mission_tasks)`).all().map((c) => c.name);
    const execState = {
      lastOutcome: null,
      dhtp: context.cognition?.metrics || null,
      routeHints: context.routeHints || null,
    };
    if (cols.includes("last_route_json")) {
      db.prepare(`UPDATE mission_tasks SET last_route_json = ?, assigned_worker_id = COALESCE(assigned_worker_id, ?), updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(route), workerId, Math.floor(Date.now() / 1000), mission.id);
    }
    if (cols.includes("executive_state_json")) {
      db.prepare(`UPDATE mission_tasks SET executive_state_json = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(execState), Math.floor(Date.now() / 1000), mission.id);
    }
  } catch { /* optional */ }

  saveLedger(db, mission.id, stepIndex, ledger, { tickCount: mission.tick_count });

  return { route, context, cognition: context.cognition, workerDispatch, ledger, workerId, workspaceDelta };
}

/**
 * Post-execution: classify, critic, decide progression.
 */
export async function evaluateExecutiveStep({
  db, mission, step, stepIndex, gateResult, stepOk, route, workerId, dispatchMCP, ledger,
} = {}) {
  const executionOutcome = classifyExecutionResult({ gateResult, stepOk });
  const stepResult = gateResult?.result ?? gateResult ?? {};
  const critic = await runCriticPass({
    db,
    mission,
    stepResult,
    dispatchMCP,
    executionOutcome,
  });

  let ledgerState = ledger || loadLedger(db, mission.id, stepIndex);
  ledgerState = recordLedgerEvent(ledgerState, stepOk ? "verified" : "failed", {
    tool: step.tool,
    outcome: executionOutcome,
    critic: critic.verdict,
  });
  if (stepOk) {
    ledgerState = recordLedgerEvent(ledgerState, "observed", {
      tool: step.tool,
      summary: stepResult?.observation ? "observation_received" : "step_completed",
    });
  }
  saveLedger(db, mission.id, stepIndex, ledgerState, { tickCount: mission.tick_count });

  recordRoutingOutcome(db, {
    taskClass: route?.taskClass,
    provider: route?.provider,
    model: route?.model,
    workerId,
    success: stepOk && critic.progression === "advance" ? 1 : 0,
    missionId: mission.id,
    traceId: mission.trace_id,
  });
  if (workerId) {
    recordWorkerOutcome(db, workerId, {
      success: stepOk && critic.progression === "advance",
      missionId: mission.id,
    });
  }

  try {
    const { recordMissionStepCausal } = await import("./causal-memory.js");
    recordMissionStepCausal(db, {
      mission, step, gateResult, executionOutcome, critic,
    });
  } catch { /* optional */ }

  try {
    const { recordCompilerLearning } = await import("./cognitive-compiler-v2.js");
    recordCompilerLearning(db, {
      missionId: mission.id,
      stepIndex,
      taskClass: route?.taskClass,
      policy: gateResult?.cognition?.policy,
      taskSuccess: stepOk,
      verificationPassed: critic.progression === "advance",
      recoveryRequired: !stepOk,
      reasoningLevel: route?.routeHints?.reasoningLevel,
      modelRoute: route,
    });
  } catch { /* optional */ }

  try {
    db.prepare(`
      UPDATE mission_tasks SET executive_state_json = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify({
      lastOutcome: executionOutcome,
      critic: critic.verdict,
      progression: critic.progression,
      route: route?.workerId,
    }), Math.floor(Date.now() / 1000), mission.id);
  } catch { /* optional cols */ }

  const shouldAdvance = stepOk && (critic.progression === "advance" || critic.progression === "verify_more");
  const shouldRecover = !stepOk || critic.progression === "recover" || critic.progression === "rollback";

  return {
    executionOutcome,
    critic,
    shouldAdvance,
    shouldRecover,
    ledger: ledgerState,
  };
}

/**
 * Handle failure with recovery ladder — may reset mission to running for retry.
 */
export async function handleExecutiveFailure({
  db, mission, step, gateResult, route, workerId, dispatchMCP, dispatchMCPFn, tickIntervalS,
} = {}) {
  const dispatch = dispatchMCP || dispatchMCPFn;
  const recovery = await attemptRecovery({
    db,
    mission: { ...mission, assigned_worker_id: workerId || mission.assigned_worker_id },
    failure: { tool: step.tool, gateResult, workerId },
    dispatchMCP: dispatch,
    loadCheckpoint: loadLatestCheckpoint,
    tickIntervalS: tickIntervalS || 15,
  });

  return recovery;
}
