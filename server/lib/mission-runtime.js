// server/lib/mission-runtime.js
//
// P0 — Mission Task Runtime. Durable multi-step missions that orchestrate
// the organ fleet through F0 dispatchMCP. Autonomous spawn from upstream
// signals; survives process restart.

import crypto from "node:crypto";
import {
  expandTemplate,
  getTemplate,
  INTERNAL_RUNTIME_TOOLS,
  isToolAllowed,
  listTemplateNames,
} from "./mission-templates.js";
import { publish as publishRuntimeEvent } from "./runtime/event-bus.js";
import { planDeterministic, planMission } from "./mission-planner.js";
import { runParallelBatch } from "./parallel-agent-fabric.js";
import { ingestMissionCompletion } from "./runtime/memory-graph.js";
import { expandDomainPack, pickPackForSignal } from "./runtime/domain-packs.js";
import { defaultOwnerAgentId } from "./runtime/constants.js";
import { decomposeToParallelSteps } from "./runtime/mission-decomposer.js";
import { orderDueMissions } from "./runtime/mission-priority.js";
import { getConfig } from "./runtime/runtime-config.js";

const DEFAULT_TICK_INTERVAL_S = Number(process.env.CONCORD_MISSION_TICK_INTERVAL_S) || 90;
const DEFAULT_MAX_STEPS = 50;
const MAX_CONCURRENT_MISSIONS = Number(process.env.CONCORD_MISSION_MAX_CONCURRENT) || 5;
const FLEET_INTERVAL_CYCLES = Number(process.env.CONCORD_MISSION_FLEET_INTERVAL_CYCLES) || 20;

function missionId() {
  return `mis_${crypto.randomUUID().slice(0, 16)}`;
}

function traceId() {
  return crypto.randomUUID();
}

function safeParse(json, fallback = null) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function tablesReady(db) {
  try {
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='mission_tasks'`
    ).get();
    return !!row;
  } catch {
    return false;
  }
}

/**
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.template
 * @param {string} [opts.title]
 * @param {string} [opts.goal]
 * @param {string} [opts.userId]
 * @param {string} [opts.source]
 * @param {string} [opts.sourceRef]
 * @param {object} [opts.spawnContext]
 * @param {Array<{tool:string,args?:object}>} [opts.steps] operator custom steps
 * @param {string} [opts.plannerMode]
 * @param {string} [opts.domainPack]
 * @param {string} [opts.executionMode]
 */
export function createMission(db, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!tablesReady(db)) return { ok: false, reason: "migration_required" };

  let template = String(opts.template || "").trim();
  let title = opts.title;
  let goal = opts.goal;
  let steps = opts.steps;
  let plannerMode = opts.plannerMode || (template ? "template" : "deterministic");
  const domainPack = opts.domainPack || null;
  let executionMode = opts.executionMode || "serial";

  if (domainPack) {
    const pack = expandDomainPack(domainPack, opts);
    if (!pack.ok) return pack;
    template = template || pack.template || "";
    title = title || pack.title;
    goal = goal || pack.goal;
    steps = steps || pack.steps;
    plannerMode = pack.planner || plannerMode;
  }

  if (!template && !steps?.length && goal) {
    if (opts.executionMode === "parallel" || opts.decomposeParallel) {
      const plan = decomposeToParallelSteps(goal, opts);
      if (plan.ok) {
        template = plan.template || "parallel_audit";
        title = title || plan.title;
        steps = plan.steps;
        plannerMode = plan.planner || plannerMode;
        executionMode = plan.executionMode || executionMode;
      }
    }
    if (!steps?.length) {
      const plan = planDeterministic(goal, opts);
      if (!plan.ok) return plan;
      template = plan.template || "dynamic";
      title = title || plan.title;
      steps = plan.steps;
      plannerMode = plan.planner || plannerMode;
    }
  }

  if (template && !steps?.length) {
    const expanded = expandTemplate(template, opts.spawnContext || {});
    if (!expanded) return { ok: false, reason: "unknown_template", template };
    title = title || expanded.title;
    goal = goal || expanded.goal;
    steps = expanded.steps;
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, reason: "no_steps" };
  }

  const source = opts.source || "operator";
  for (const step of steps) {
    if (!step?.tool) return { ok: false, reason: "invalid_step" };
    if (!isToolAllowed(step.tool, source)) {
      return { ok: false, reason: "tool_not_allowed", tool: step.tool, source };
    }
  }

  const id = missionId();
  const tid = traceId();
  const userId = opts.userId || defaultOwnerAgentId(opts);
  const ownerAgentId = opts.ownerAgentId || defaultOwnerAgentId(opts);
  let capped = steps.slice(0, DEFAULT_MAX_STEPS);

  const marathonDefault = getConfig(db, "mission.marathon_default", false);
  if (marathonDefault && (template === "coding_loop_closed" || template === "coding_loop")) {
    capped = [
      ...capped,
      { tool: "marathon_spawn", args: {} },
      { tool: "marathon_status", args: {} },
    ].slice(0, DEFAULT_MAX_STEPS);
  }

  try {
    const cols = db.prepare(`PRAGMA table_info(mission_tasks)`).all().map((c) => c.name);
    const hasPhaseCols = cols.includes("planner_mode");
    const hasOwnerCol = cols.includes("owner_agent_id");

    if (hasPhaseCols && hasOwnerCol) {
      db.prepare(`
        INSERT INTO mission_tasks
          (id, user_id, owner_agent_id, title, goal, template, source, source_ref, status,
           trace_id, current_step, total_steps, steps_json, spawn_context_json,
           max_steps, next_tick_at, planner_mode, domain_pack, execution_mode, loop_phase)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'mission')
      `).run(
        id,
        userId,
        ownerAgentId,
        title || template || "Mission",
        goal || null,
        template || "custom",
        source,
        opts.sourceRef || null,
        tid,
        capped.length,
        JSON.stringify(capped),
        opts.spawnContext ? JSON.stringify(opts.spawnContext) : null,
        Math.min(opts.maxSteps || DEFAULT_MAX_STEPS, DEFAULT_MAX_STEPS),
        nowSec(),
        plannerMode,
        domainPack,
        executionMode,
      );
    } else if (hasPhaseCols) {
      db.prepare(`
        INSERT INTO mission_tasks
          (id, user_id, title, goal, template, source, source_ref, status,
           trace_id, current_step, total_steps, steps_json, spawn_context_json,
           max_steps, next_tick_at, planner_mode, domain_pack, execution_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        userId,
        title || template || "Mission",
        goal || null,
        template || "custom",
        source,
        opts.sourceRef || null,
        tid,
        capped.length,
        JSON.stringify(capped),
        opts.spawnContext ? JSON.stringify(opts.spawnContext) : null,
        Math.min(opts.maxSteps || DEFAULT_MAX_STEPS, DEFAULT_MAX_STEPS),
        nowSec(),
        plannerMode,
        domainPack,
        executionMode,
      );
    } else {
      db.prepare(`
        INSERT INTO mission_tasks
          (id, user_id, title, goal, template, source, source_ref, status,
           trace_id, current_step, total_steps, steps_json, spawn_context_json,
           max_steps, next_tick_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?, ?, ?)
      `).run(
        id,
        userId,
        title || template || "Mission",
        goal || null,
        template || "custom",
        source,
        opts.sourceRef || null,
        tid,
        capped.length,
        JSON.stringify(capped),
        opts.spawnContext ? JSON.stringify(opts.spawnContext) : null,
        Math.min(opts.maxSteps || DEFAULT_MAX_STEPS, DEFAULT_MAX_STEPS),
        nowSec(),
      );
    }
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: e?.message || String(e) };
  }

  publishRuntimeEvent("agent.task.created", {
    missionId: id,
    template: template || "custom",
    source,
    sourceRef: opts.sourceRef || null,
    traceId: tid,
    stepCount: capped.length,
    ownerAgentId,
  });

  try {
    db.prepare(`
      UPDATE mission_runtime_state
      SET missions_spawned = missions_spawned + 1, updated_at = ?
      WHERE id = 1
    `).run(nowSec());
  } catch { /* optional aggregate */ }

  return { ok: true, missionId: id, traceId: tid, totalSteps: capped.length, status: "pending", ownerAgentId };
}

export function listMissions(db, opts = {}) {
  if (!db || !tablesReady(db)) return [];
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const status = opts.status ? String(opts.status) : null;
  try {
    if (status) {
      return db.prepare(`
        SELECT id, user_id, title, goal, template, source, source_ref, status,
               trace_id, current_step, total_steps, tick_count,
               created_at, updated_at, completed_at, next_tick_at, error_reason
        FROM mission_tasks
        WHERE status = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(status, limit);
    }
    return db.prepare(`
      SELECT id, user_id, title, goal, template, source, source_ref, status,
             trace_id, current_step, total_steps, tick_count,
             created_at, updated_at, completed_at, next_tick_at, error_reason
      FROM mission_tasks
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}

export function getMission(db, missionId) {
  if (!db || !missionId || !tablesReady(db)) return null;
  try {
    const row = db.prepare(`SELECT * FROM mission_tasks WHERE id = ?`).get(missionId);
    if (!row) return null;
    const steps = db.prepare(`
      SELECT step_index, tool_name, args_json, status, f0_decision,
             duration_ms, created_at, completed_at
      FROM mission_step_log
      WHERE mission_id = ?
      ORDER BY step_index ASC
    `).all(missionId);
    return {
      ...row,
      steps_plan: safeParse(row.steps_json, []),
      spawn_context: safeParse(row.spawn_context_json, null),
      step_log: steps.map((s) => ({
        ...s,
        args: safeParse(s.args_json, {}),
      })),
    };
  } catch {
    return null;
  }
}

export function countActiveMissions(db) {
  if (!db || !tablesReady(db)) return 0;
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS c FROM mission_tasks
      WHERE status IN ('pending', 'running')
    `).get();
    return row?.c || 0;
  } catch {
    return 0;
  }
}

export function findDueMissions(db, limit = 3) {
  if (!db || !tablesReady(db)) return [];
  const cap = Math.min(Math.max(limit, 1), 10);
  const now = nowSec();
  try {
    const rows = db.prepare(`
      SELECT * FROM mission_tasks
      WHERE status IN ('pending', 'running')
        AND next_tick_at <= ?
      ORDER BY priority_score DESC, next_tick_at ASC
      LIMIT ?
    `).all(now, cap);
    return rows;
  } catch {
    try {
      const rows = db.prepare(`
        SELECT * FROM mission_tasks
        WHERE status IN ('pending', 'running')
          AND next_tick_at <= ?
        ORDER BY next_tick_at ASC
        LIMIT ?
      `).all(now, cap);
      return orderDueMissions(rows).slice(0, cap);
    } catch {
      return [];
    }
  }
}

export function pauseMission(db, missionId) {
  if (!db || !missionId) return { ok: false, reason: "missing_inputs" };
  try {
    const r = db.prepare(`
      UPDATE mission_tasks SET status = 'paused', updated_at = ?
      WHERE id = ? AND status IN ('pending', 'running')
    `).run(nowSec(), missionId);
    return r.changes ? { ok: true, status: "paused" } : { ok: false, reason: "not_pausable" };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function abandonMission(db, missionId) {
  if (!db || !missionId) return { ok: false, reason: "missing_inputs" };
  try {
    const r = db.prepare(`
      UPDATE mission_tasks
      SET status = 'abandoned', completed_at = ?, updated_at = ?
      WHERE id = ? AND status NOT IN ('completed', 'abandoned')
    `).run(nowSec(), nowSec(), missionId);
    return r.changes ? { ok: true, status: "abandoned" } : { ok: false, reason: "not_found" };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

function finalizeMission(db, mission, status, errorReason = null) {
  const ts = nowSec();
  db.prepare(`
    UPDATE mission_tasks
    SET status = ?, error_reason = ?, completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(status, errorReason, ts, ts, mission.id);

  publishRuntimeEvent("agent.task.completed", {
    missionId: mission.id,
    template: mission.template,
    source: mission.source,
    status,
    traceId: mission.trace_id,
    stepsCompleted: mission.current_step,
    totalSteps: mission.total_steps,
    errorReason,
  });

  try {
    ingestMissionCompletion(db, { ...mission, status });
  } catch { /* migration 424 optional */ }

  if (status === "completed") {
    try {
      db.prepare(`
        UPDATE mission_runtime_state
        SET missions_completed = missions_completed + 1, updated_at = ?
        WHERE id = 1
      `).run(ts);
    } catch { /* optional */ }
  }
}

/**
 * Advance a mission by one organ step via F0 dispatchMCP.
 *
 * @param {object} args
 * @param {object} args.db
 * @param {string} args.missionId
 * @param {Function} args.dispatchMCP — auth-gate dispatch (required for real ticks)
 * @param {object} [args.STATE]
 */
export async function tickMission({ db, missionId, dispatchMCP, STATE = null }) {
  if (!db || !missionId) return { ok: false, reason: "missing_inputs" };
  if (typeof dispatchMCP !== "function") return { ok: false, reason: "missing_dispatch" };

  const mission = db.prepare(`SELECT * FROM mission_tasks WHERE id = ?`).get(missionId);
  if (!mission) return { ok: false, reason: "not_found" };
  if (mission.status === "paused") return { ok: false, reason: "paused" };
  if (["completed", "failed", "abandoned"].includes(mission.status)) {
    return { ok: false, reason: "terminal", status: mission.status };
  }

  const plan = safeParse(mission.steps_json, []);
  if (!plan.length) {
    finalizeMission(db, mission, "failed", "empty_plan");
    return { ok: false, reason: "empty_plan" };
  }

  if (mission.status === "pending") {
    db.prepare(`
      UPDATE mission_tasks SET status = 'running', updated_at = ? WHERE id = ?
    `).run(nowSec(), missionId);
    mission.status = "running";
  }

  const stepIndex = mission.current_step;
  if (stepIndex >= plan.length) {
    finalizeMission(db, mission, "completed");
    return { ok: true, status: "completed", stepsExecuted: stepIndex };
  }

  const step = plan[stepIndex];
  if (!isToolAllowed(step.tool, mission.source)) {
    finalizeMission(db, mission, "failed", `tool_blocked:${step.tool}`);
    return { ok: false, reason: "tool_not_allowed", tool: step.tool };
  }

  let executivePrep = { route: null, ledger: null, workerId: null };
  try {
    const { prepareExecutiveStep } = await import("./runtime/executive-tick.js");
    executivePrep = await prepareExecutiveStep({
      db, mission, step, stepIndex, dispatchMCP,
    });
  } catch { /* executive optional pre-migration */ }

  if (stepIndex === 0 && mission.tick_count === 0) {
    try {
      const { captureWorkspaceSnapshot } = await import("./runtime/workspace-sensor.js");
      await captureWorkspaceSnapshot(db, { missionId, repoRoot: step.args?.repoRoot });
    } catch { /* optional */ }
  }

  const started = Date.now();
  let logId = null;
  try {
    const ins = db.prepare(`
      INSERT INTO mission_step_log
        (mission_id, step_index, tool_name, args_json, status, trace_id)
      VALUES (?, ?, ?, ?, 'dispatched', ?)
    `).run(missionId, stepIndex, step.tool, JSON.stringify(step.args || {}), mission.trace_id);
    logId = ins.lastInsertRowid;
  } catch { /* best effort */ }

  const autonomousSources = new Set(["heartbeat", "sentinel", "proactive", "fleet", "watch", "scheduled", "initiative", "system"]);
  const isAutonomous = autonomousSources.has(mission.source) || mission.owner_agent_id === "hermes";
  const gateCtx = {
    actor: {
      id: mission.user_id,
      userId: mission.user_id,
      role: mission.source === "operator" ? "admin" : (isAutonomous ? "system" : "member"),
    },
    db,
    STATE: STATE || globalThis.STATE || null,
    trace_id: mission.trace_id,
    provenance: {
      mission_id: missionId,
      step_index: stepIndex,
      source: mission.source,
      mission_source: mission.source,
      owner_agent_id: mission.owner_agent_id || null,
    },
  };

  let gateResult;
  if (INTERNAL_RUNTIME_TOOLS.has(step.tool)) {
    if (step.tool === "repo_graph_index") {
      const { indexRepo } = await import("./runtime/repo-graph.js");
      const idx = await indexRepo(db, step.args?.repoRoot);
      try {
        const { indexAstLayer } = await import("./runtime/repo-graph-ast.js");
        const { readdirSync } = await import("node:fs");
        const { join } = await import("node:path");
        const root = idx.repoRoot || process.cwd();
        const files = [];
        for (const sub of ["server", "concord-frontend"]) {
          try {
            const walk = (dir, depth = 0) => {
              if (depth > 8 || files.length > 500) return;
              for (const ent of readdirSync(dir, { withFileTypes: true })) {
                if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
                const full = join(dir, ent.name);
                if (ent.isDirectory()) walk(full, depth + 1);
                else if (/\.(js|mjs|cjs)$/.test(ent.name)) files.push(full);
              }
            };
            walk(join(root, sub));
          } catch { /* optional */ }
        }
        const ast = indexAstLayer(db, root, files);
        idx.ast = ast;
      } catch { /* optional */ }
      gateResult = { ok: idx.ok !== false, result: idx };
    } else if (step.tool === "parallel_batch") {
      const tasks = Array.isArray(step.args?.tasks) ? step.args.tasks : [];
      const batch = await runParallelBatch({
        db,
        missionId,
        traceId: mission.trace_id,
        tasks,
        dispatchMCP,
        ctx: gateCtx,
      });
      gateResult = { ok: batch.ok !== false, result: batch };
    } else if (step.tool === "coding_loop_search") {
      const { searchCodingTargets } = await import("./coding-loop.js");
      const search = await searchCodingTargets(db, {
        query: step.args?.query || mission.goal || mission.title,
        repoRoot: step.args?.repoRoot,
      });
      gateResult = { ok: search.ok !== false, result: search };
    } else if (step.tool === "coding_loop_verify") {
      const { verifyCodingTests } = await import("./coding-loop.js");
      const verify = await verifyCodingTests({ testPattern: step.args?.testPattern || "mission" });
      try {
        db.prepare(`UPDATE runtime_tier_state SET coding_loops_run = coding_loops_run + 1, updated_at = ? WHERE id = 1`).run(nowSec());
      } catch { /* optional */ }
      gateResult = { ok: verify.ok !== false, result: verify };
    } else if (step.tool === "coding_loop_closure") {
      const { runCodingLoopClosureStep } = await import("./runtime/coding-loop-closure.js");
      const closed = await runCodingLoopClosureStep({ db, mission, step });
      gateResult = { ok: closed.ok !== false, result: closed.result || closed };
    } else if (step.tool === "swe_harness_run") {
      const { runSweHarness } = await import("./runtime/swe-harness.js");
      const harness = await runSweHarness({ db, caseIds: step.args?.caseIds });
      gateResult = { ok: harness.ok !== false, result: harness };
    } else if (step.tool === "pce_execute") {
      const { runCodingPipeline } = await import("./pce/coding-pipeline.js");
      const pipeline = await runCodingPipeline({
        db,
        intent: step.args?.intent || mission.goal || mission.title,
        repoRoot: step.args?.repoRoot,
        missionId: mission.id,
        mission,
        step,
        params: step.args?.params || step.args,
        manualSteps: step.args?.steps || null,
        dispatchMCP,
      });
      gateResult = { ok: pipeline.ok !== false, result: pipeline };
    } else if (step.tool === "concord_bench_run") {
      const { runAllBenchSuites } = await import("./pce/pce-excellence-runner.js");
      const bench = await runAllBenchSuites(db, { concordRoot: step.args?.repoRoot });
      gateResult = { ok: bench.passRate >= (step.args?.minPassRate ?? 0.75), result: bench };
    } else if (step.tool === "pce_excellence_run") {
      const { runPceExcellenceCycle } = await import("./pce/pce-excellence-runner.js");
      const cycle = await runPceExcellenceCycle({ db, concordRoot: step.args?.repoRoot });
      gateResult = { ok: cycle.ok !== false, result: cycle };
    } else if (step.tool === "pce_improvement_run") {
      const { runPceImprovementCycle } = await import("./pce/pce-improvement-cycle.js");
      const cycle = await runPceImprovementCycle({ db, concordRoot: step.args?.repoRoot });
      gateResult = { ok: cycle.ok !== false, result: cycle };
    } else if (step.tool === "pattern_lifecycle_run") {
      const { proposePatternsFromFailures, runPatternLifecyclePass } = await import("./pce/pattern-promotion.js");
      const { seedProvenBenchPatterns } = await import("./pce/concord-bench-patterns.js");
      seedProvenBenchPatterns(db);
      const proposals = proposePatternsFromFailures(db);
      const lifecycle = await runPatternLifecyclePass(db, { concordRoot: step.args?.repoRoot });
      gateResult = { ok: true, result: { proposals, lifecycle } };
    } else if (step.tool === "cognitive_delta_execute") {
      const { executeCognitiveDelta } = await import("./runtime/cognitive-delta-runtime.js");
      const cognition = executivePrep.cognition || executivePrep.context?.cognition;
      const deltaExec = await executeCognitiveDelta({
        db,
        text: step.args?.text,
        delta: step.args?.delta || cognition?.reuseDelta || null,
        mission,
        step,
        stepIndex,
        dispatchMCP,
        gateCtx,
        cognition,
        route: executivePrep.route,
      });
      gateResult = { ok: deltaExec.ok, result: deltaExec, decision: deltaExec.f0Authorized ? "allow" : null };
    } else if (step.tool === "worker_execute") {
      const { executeWorkerTask } = await import("./runtime/worker-adapters.js");
      const worker = await executeWorkerTask({
        workerId: step.args?.worker || mission.assigned_worker_id,
        task: step.args?.task || step.tool,
        content: step.args?.content || mission.goal,
        taskClass: step.args?.taskClass || "coding",
      });
      gateResult = { ok: worker.ok !== false, result: worker };
    } else if (step.tool === "marathon_spawn") {
      const { spawnMarathonForMission } = await import("./mission-marathon-bridge.js");
      const spawn = spawnMarathonForMission(db, mission, step.args || {});
      gateResult = { ok: spawn.ok !== false, result: spawn };
    } else if (step.tool === "marathon_status") {
      const { checkMarathonMissionProgress } = await import("./mission-marathon-bridge.js");
      const status = checkMarathonMissionProgress(db, missionId);
      gateResult = { ok: status.ok !== false, result: status };
    } else if (step.tool === "initiative_handoff") {
      const autoRecord = process.env.CONCORD_INITIATIVE_AUTO_RECORD === "1";
      const list = await dispatchMCP("initiative_list", { status: "submitted", limit: 5 }, gateCtx);
      const initiatives = list?.result?.observation?.initiatives
        || list?.result?.initiatives
        || [];
      const outcomes = [];
      for (const item of initiatives.slice(0, 3)) {
        const id = item.initiative_id || item.id;
        if (!id) continue;
        const val = await dispatchMCP("initiative_validate", { id }, gateCtx);
        const valid = val?.ok !== false && val?.result?.valid !== false;
        const entry = { id, valid };
        if (autoRecord && valid && mission.source === "operator") {
          const rec = await dispatchMCP(
            "initiative_record_execution",
            { id, outcome: "mission_handoff" },
            gateCtx,
          );
          entry.recorded = rec?.ok !== false;
        }
        outcomes.push(entry);
      }
      gateResult = { ok: true, result: { ok: true, count: outcomes.length, outcomes, autoRecord } };
    } else {
      gateResult = { ok: false, result: { reason: "unknown_internal_tool", tool: step.tool } };
    }
  } else {
    gateResult = await dispatchMCP(step.tool, step.args || {}, gateCtx);
  }

  const durationMs = Date.now() - started;
  let stepOk = gateResult?.ok !== false && gateResult?.result?.ok !== false;
  let executiveEval = null;

  try {
    const { evaluateExecutiveStep } = await import("./runtime/executive-tick.js");
    executiveEval = await evaluateExecutiveStep({
      db,
      mission,
      step,
      stepIndex,
      gateResult,
      stepOk,
      route: executivePrep.route,
      workerId: executivePrep.workerId,
      dispatchMCP,
      ledger: executivePrep.ledger,
    });
    if (executiveEval.shouldRecover && !executiveEval.shouldAdvance) {
      stepOk = false;
    }
  } catch { /* executive optional */ }

  const stepStatus = stepOk ? "completed" : "failed";
  const nextStep = stepIndex + 1;
  const tickCount = (mission.tick_count || 0) + 1;
  const missionFailed = !stepOk;

  if (logId != null) {
    try {
      db.prepare(`
        UPDATE mission_step_log
        SET status = ?, result_json = ?, f0_decision = ?,
            duration_ms = ?, completed_at = ?
        WHERE id = ?
      `).run(
        stepStatus,
        JSON.stringify(gateResult?.result ?? gateResult ?? {}),
        gateResult?.decision || null,
        durationMs,
        nowSec(),
        logId,
      );
    } catch { /* best effort */ }
  }

  if (missionFailed) {
    let recovery = null;
    try {
      const { handleExecutiveFailure } = await import("./runtime/executive-tick.js");
      recovery = await handleExecutiveFailure({
        db,
        mission,
        step,
        gateResult,
        route: executivePrep.route,
        workerId: executivePrep.workerId,
        dispatchMCP,
        tickIntervalS: DEFAULT_TICK_INTERVAL_S,
      });
    } catch { /* optional */ }

    if (recovery?.shouldRetry) {
      db.prepare(`
        UPDATE mission_tasks
        SET tick_count = ?, updated_at = ?, next_tick_at = ?
        WHERE id = ?
      `).run(tickCount, nowSec(), nowSec() + DEFAULT_TICK_INTERVAL_S, missionId);

      return {
        ok: false,
        status: "recovering",
        stepIndex,
        tool: step.tool,
        recoveryAction: recovery.recoveryAction,
        reassignedWorker: recovery.reassignedWorker,
        executive: executiveEval,
        durationMs,
      };
    }

    db.prepare(`
      UPDATE mission_tasks
      SET current_step = ?, tick_count = ?, status = 'failed',
          error_reason = ?, completed_at = ?, updated_at = ?, next_tick_at = ?
      WHERE id = ?
    `).run(
      nextStep,
      tickCount,
      `step_failed:${step.tool}`,
      nowSec(),
      nowSec(),
      nowSec() + DEFAULT_TICK_INTERVAL_S * 10,
      missionId,
    );
    publishRuntimeEvent("agent.task.completed", {
      missionId,
      status: "failed",
      failedStep: stepIndex,
      tool: step.tool,
      traceId: mission.trace_id,
    });
    return {
      ok: false,
      status: "failed",
      stepIndex,
      tool: step.tool,
      gateDecision: gateResult?.decision,
      executive: executiveEval,
      recovery,
      durationMs,
    };
  }

  const marathonProgress = step.tool === "marathon_status" ? gateResult?.result : null;
  const waitingOnMarathon = stepOk
    && mission.template === "marathon_delegate"
    && marathonProgress?.ok
    && !marathonProgress?.terminal;

  if (waitingOnMarathon) {
    db.prepare(`
      UPDATE mission_tasks
      SET current_step = ?, tick_count = ?, status = 'running',
          updated_at = ?, next_tick_at = ?
      WHERE id = ?
    `).run(stepIndex, tickCount, nowSec(), nowSec() + DEFAULT_TICK_INTERVAL_S, missionId);
    return {
      ok: true,
      status: "waiting_marathon",
      stepIndex,
      tool: step.tool,
      marathonStatus: marathonProgress?.status,
      durationMs,
    };
  }

  const isDone = nextStep >= plan.length;

  if (isDone) {
    db.prepare(`
      UPDATE mission_tasks
      SET current_step = ?, tick_count = ?, status = 'completed',
          completed_at = ?, updated_at = ?, next_tick_at = ?
      WHERE id = ?
    `).run(nextStep, tickCount, nowSec(), nowSec(), nowSec(), missionId);
    publishRuntimeEvent("agent.task.completed", {
      missionId,
      template: mission.template,
      source: mission.source,
      status: "completed",
      traceId: mission.trace_id,
      stepsCompleted: nextStep,
      totalSteps: plan.length,
    });
    try {
      ingestMissionCompletion(db, {
        ...mission,
        status: "completed",
        current_step: nextStep,
      });
    } catch { /* migration 424 optional */ }
    try {
      const { runImprovementCycle } = await import("./runtime/self-improvement.js");
      const full = getMission(db, missionId);
      await runImprovementCycle({
        db,
        mission: { ...mission, status: "completed", current_step: nextStep },
        stepLog: full?.step_log || [],
        dispatchMCP,
      });
    } catch { /* optional */ }
    try {
      const { saveCheckpoint } = await import("./runtime/agent-loop.js");
      saveCheckpoint(db, missionId, {
        stepIndex: nextStep,
        loopPhase: "learn",
        state: { status: "completed", steps: nextStep },
      });
    } catch { /* optional */ }
    try {
      db.prepare(`
        UPDATE mission_runtime_state
        SET missions_completed = missions_completed + 1, updated_at = ?
        WHERE id = 1
      `).run(nowSec());
    } catch { /* optional */ }
    return { ok: true, status: "completed", stepsExecuted: nextStep, durationMs };
  }

  db.prepare(`
    UPDATE mission_tasks
    SET current_step = ?, tick_count = ?, updated_at = ?, next_tick_at = ?
    WHERE id = ?
  `).run(nextStep, tickCount, nowSec(), nowSec() + DEFAULT_TICK_INTERVAL_S, missionId);

  return {
    ok: true,
    status: "running",
    stepIndex,
    tool: step.tool,
    nextStep,
    gateDecision: gateResult?.decision,
    executive: executiveEval,
    durationMs,
  };
}

function recentMissionExists(db, source, sourceRef, template, windowSec = 3600) {
  if (!sourceRef) return false;
  try {
    const row = db.prepare(`
      SELECT id FROM mission_tasks
      WHERE source = ? AND source_ref = ? AND template = ?
        AND created_at >= ?
        AND status NOT IN ('abandoned', 'failed')
      LIMIT 1
    `).get(source, sourceRef, template, nowSec() - windowSec);
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Autonomous mission spawner — called from heartbeat. Uses dispatchMCP to
 * read upstream organ state and spawn missions when signals warrant it.
 */
export async function spawnAutonomousMissions({ db, dispatchMCP, STATE = null }) {
  if (process.env.CONCORD_MISSION_RUNTIME === "0") {
    return { ok: true, spawned: 0, reason: "disabled" };
  }
  if (!db || typeof dispatchMCP !== "function") {
    return { ok: false, reason: "missing_inputs" };
  }
  if (!tablesReady(db)) return { ok: false, reason: "migration_required" };

  const active = countActiveMissions(db);
  if (active >= MAX_CONCURRENT_MISSIONS) {
    return { ok: true, spawned: 0, reason: "at_capacity", active };
  }

  const ctx = {
    actor: { id: "system", userId: "system", role: "system" },
    db,
    STATE: STATE || globalThis.STATE || null,
  };

  const candidates = [];

  let fleetCounter = 0;
  try {
    const st = db.prepare(`SELECT fleet_cycle_counter FROM mission_runtime_state WHERE id = 1`).get();
    fleetCounter = (st?.fleet_cycle_counter || 0) + 1;
    db.prepare(`
      UPDATE mission_runtime_state
      SET fleet_cycle_counter = ?, updated_at = ?
      WHERE id = 1
    `).run(fleetCounter, nowSec());
  } catch { /* optional */ }

  if (fleetCounter % FLEET_INTERVAL_CYCLES === 0) {
    candidates.push({
      source: "scheduled",
      sourceRef: `fleet_cycle_${fleetCounter}`,
      title: "Periodic fleet health",
      template: "fleet_health",
      dedupeWindowSec: 1800,
    });
  }

  try {
    const sweep = await dispatchMCP("sentinel_sweep", {}, { ...ctx, trace_id: traceId() });
    const level = sweep?.result?.observation?.alert_level
      || sweep?.result?.alert_level
      || "none";
    if (level === "warn" || level === "critical") {
      candidates.push({
        source: "sentinel",
        signal: "sentinel",
        level,
        sourceRef: `sentinel_${level}_${nowSec()}`,
        title: `Sentinel ${level} watch`,
        template: "watch_detect",
        severity: level === "critical" ? 1 : 0.5,
        spawnContext: { alert_level: level },
        dedupeWindowSec: 1800,
      });
    }
  } catch { /* sentinel optional */ }

  try {
    const inc = await dispatchMCP("incident_list", { status: "open", limit: 5 }, { ...ctx, trace_id: traceId() });
    const incidents = inc?.result?.observation?.incidents
      || inc?.result?.incidents
      || [];
    for (const item of incidents.slice(0, 3)) {
      const ref = item.incident_id || item.id;
      if (!ref) continue;
      candidates.push({
        source: "incident",
        signal: "incident",
        sourceRef: ref,
        title: `Incident: ${item.title || ref}`,
        template: "incident_response",
        severity: Number(item.severity || 0.8),
        spawnContext: { incident_id: ref },
        dedupeWindowSec: 3600,
      });
    }
  } catch { /* incident optional */ }

  try {
    const opp = await dispatchMCP("opportunity_list", { status: "open", limit: 5 }, { ...ctx, trace_id: traceId() });
    const opportunities = opp?.result?.observation?.opportunities
      || opp?.result?.opportunities
      || [];
    for (const item of opportunities.slice(0, 2)) {
      const ref = item.opportunity_id || item.id;
      if (!ref) continue;
      candidates.push({
        source: "opportunity",
        signal: "opportunity",
        sourceRef: ref,
        title: `Opportunity: ${item.title || ref}`,
        template: "opportunity_pipeline",
        confidence: Number(item.confidence || 0.6),
        spawnContext: { opportunity_id: ref },
        dedupeWindowSec: 7200,
      });
    }
  } catch { /* opportunity optional */ }

  try {
    const pred = await dispatchMCP("proactive_list_predictions", { horizon: "near", limit: 5 }, { ...ctx, trace_id: traceId() });
    const predictions = pred?.result?.observation?.predictions
      || pred?.result?.predictions
      || [];
    const pending = predictions.filter((p) => !p.outcome || p.outcome === "pending");
    for (const p of pending.slice(0, 2)) {
      const ref = p.prediction_id || p.id || `proactive_${nowSec()}`;
      candidates.push({
        source: "proactive",
        signal: "proactive",
        sourceRef: ref,
        title: "Proactive research follow-up",
        template: "proactive_research",
        confidence: Number(p.confidence || 0.5),
        spawnContext: { prediction_id: ref },
        dedupeWindowSec: 7200,
      });
    }
  } catch { /* proactive optional */ }

  try {
    const { concordBenchHistory } = await import("./pce/concord-bench.js");
    const hist = concordBenchHistory(db, { sinceDays: 3, limit: 50 });
    if (hist.ok && hist.total >= 5 && hist.passRate != null && hist.passRate < 0.9) {
      candidates.push({
        source: "benchmark",
        signal: "bench_regression",
        sourceRef: `bench_regression_${Math.floor(hist.passRate * 100)}`,
        title: "PCE empirical excellence cycle",
        template: "pce_excellence_cycle",
        severity: hist.passRate < 0.7 ? 1 : 0.6,
        spawnContext: { passRate: hist.passRate, failed: hist.failed },
        dedupeWindowSec: 7200,
      });
    } else if (fleetCounter % (FLEET_INTERVAL_CYCLES * 4) === 0) {
      candidates.push({
        source: "scheduled",
        sourceRef: `pce_excellence_${fleetCounter}`,
        title: "Periodic PCE excellence benchmark",
        template: "pce_excellence_cycle",
        dedupeWindowSec: 86400,
      });
    }
  } catch { /* bench optional */ }

  try {
    const init = await dispatchMCP("initiative_list", { status: "submitted", limit: 5 }, { ...ctx, trace_id: traceId() });
    const initiatives = init?.result?.observation?.initiatives
      || init?.result?.initiatives
      || [];
    for (const item of initiatives.slice(0, 2)) {
      const ref = item.initiative_id || item.id;
      if (!ref) continue;
      candidates.push({
        source: "initiative",
        signal: "initiative",
        sourceRef: ref,
        title: "Initiative monitor",
        template: "initiative_monitor",
        spawnContext: { initiative_id: ref },
        dedupeWindowSec: 14400,
      });
    }
  } catch { /* initiative optional */ }

  if (active === 0 && candidates.length === 0) {
    candidates.push({
      source: "heartbeat",
      sourceRef: `experience_${Math.floor(nowSec() / 86400)}`,
      title: "Experience consolidation",
      template: "experience_consolidate",
      dedupeWindowSec: 86400,
    });
  }

  const slots = Math.max(0, MAX_CONCURRENT_MISSIONS - active);
  const { spawnFromPriorityQueue } = await import("./runtime/mission-priority.js");
  const queue = await spawnFromPriorityQueue(db, candidates, {
    limit: Math.min(slots, 2),
    recentMissionExists,
  });
  const spawned = queue.spawned || [];

  if (spawned.length > 0) {
    try {
      db.prepare(`
        UPDATE mission_runtime_state
        SET last_autonomous_spawn_at = ?, updated_at = ?
        WHERE id = 1
      `).run(nowSec(), nowSec());
    } catch { /* optional */ }
  }

  return {
    ok: true,
    spawned: spawned.length,
    missions: spawned,
    active: countActiveMissions(db),
    candidates: candidates.length,
  };
}

export function runtimeOverview(db) {
  if (!db || !tablesReady(db)) {
    return { ok: false, reason: "migration_required", templates: listTemplateNames() };
  }
  const byStatus = {};
  try {
    const rows = db.prepare(`
      SELECT status, COUNT(*) AS c FROM mission_tasks GROUP BY status
    `).all();
    for (const row of rows) byStatus[row.status] = row.c;
  } catch { /* optional */ }

  let state = {};
  try {
    state = db.prepare(`SELECT * FROM mission_runtime_state WHERE id = 1`).get() || {};
  } catch { /* optional */ }

  return {
    ok: true,
    templates: listTemplateNames(),
    active: countActiveMissions(db),
    byStatus,
    runtimeState: state,
    killSwitch: process.env.CONCORD_MISSION_RUNTIME === "0",
    maxConcurrent: MAX_CONCURRENT_MISSIONS,
  };
}

/**
 * Plan a mission from a natural-language goal (async — may use LLM when enabled).
 */
export async function planMissionGoal(opts = {}) {
  return planMission(opts);
}
