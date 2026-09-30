// server/lib/runtime/agent-loop.js
//
// Dila executive loop — survives model failure via checkpoints + deterministic fallbacks.

import { LOOP_PHASES } from "./constants.js";
import { buildWorldModelSnapshot, summarizeWorldModelForPlan } from "./world-model.js";
import { runCriticPass } from "./critic.js";
import { routeModel, recordRoutingOutcome } from "./model-router.js";
import { pickWorkerForTask, recordWorkerOutcome } from "./agent-org.js";

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_mission_checkpoints'`).get();
  } catch {
    return false;
  }
}

export function saveCheckpoint(db, missionId, { stepIndex, loopPhase, state } = {}) {
  if (!db || !missionId || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify(state || {});
  try {
    db.prepare(`
      INSERT INTO runtime_mission_checkpoints (mission_id, step_index, loop_phase, state_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(missionId, stepIndex ?? 0, loopPhase || "execute", payload, now);
    db.prepare(`
      UPDATE mission_tasks SET checkpoint_json = ?, loop_phase = ?, updated_at = ? WHERE id = ?
    `).run(payload, loopPhase || "execute", now, missionId);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function loadLatestCheckpoint(db, missionId) {
  if (!db || !missionId || !tablesReady(db)) return null;
  try {
    const row = db.prepare(`
      SELECT * FROM runtime_mission_checkpoints
      WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(missionId);
    if (!row) return null;
    return {
      ...row,
      state: row.state_json ? JSON.parse(row.state_json) : null,
    };
  } catch {
    return null;
  }
}

function decomposeGoal(goal) {
  const g = String(goal || "").trim();
  if (!g) return [];
  const parts = g.split(/[.;]\s+|\band\b/i).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [g];
}

function buildPlanDag(goal) {
  const tasks = decomposeGoal(goal);
  return tasks.map((t, i) => ({
    id: `dag_${i}`,
    label: t,
    dependsOn: i > 0 ? [`dag_${i - 1}`] : [],
    status: "pending",
  }));
}

/**
 * One executive loop iteration — deterministic when LLM unavailable.
 */
export async function runAgentLoopPhase({
  db, mission, dispatchMCP, phase,
} = {}) {
  if (!db || !mission) return { ok: false, reason: "missing_inputs" };
  const currentPhase = phase || mission.loop_phase || "understand";
  const idx = LOOP_PHASES.indexOf(currentPhase);
  const nextPhase = LOOP_PHASES[Math.min(idx + 1, LOOP_PHASES.length - 1)];

  const route = await routeModel({
    db,
    taskClass: currentPhase === "execute" ? "coding" : "reasoning",
    goal: mission.goal,
    missionId: mission.id,
    traceId: mission.trace_id,
  });

  let output = { phase: currentPhase, route };

  switch (currentPhase) {
    case "understand":
    case "world_model": {
      const wm = await buildWorldModelSnapshot({ db, mission, dispatchMCP });
      output.worldModel = wm;
      output.summary = summarizeWorldModelForPlan(wm);
      break;
    }
    case "decompose":
    case "plan_dag": {
      const dag = buildPlanDag(mission.goal);
      output.dag = dag;
      try {
        db.prepare(`UPDATE mission_tasks SET dag_json = ?, updated_at = ? WHERE id = ?`)
          .run(JSON.stringify(dag), Math.floor(Date.now() / 1000), mission.id);
      } catch { /* optional */ }
      break;
    }
    case "allocate": {
      const director = /research|audit|opportunity/i.test(mission.goal || "") ? "research" : "engineering";
      const workerId = pickWorkerForTask(db, { director, specialization: director === "research" ? "research" : "coding" })
        || route.workerId;
      output.allocatedWorker = workerId;
      break;
    }
    case "critique": {
      output.critique = await runCriticPass({ db, mission, stepResult: mission.lastStepResult, dispatchMCP });
      break;
    }
    case "learn":
    case "update_world_model": {
      output.learned = { checkpoint: true, at: Math.floor(Date.now() / 1000) };
      break;
    }
    default:
      output.note = "phase_deferred_to_mission_runtime";
  }

  saveCheckpoint(db, mission.id, {
    stepIndex: mission.current_step,
    loopPhase: currentPhase,
    state: output,
  });

  try {
    db.prepare(`UPDATE mission_tasks SET loop_phase = ?, updated_at = ? WHERE id = ?`)
      .run(nextPhase, Math.floor(Date.now() / 1000), mission.id);
  } catch { /* optional */ }

  recordRoutingOutcome(db, {
    taskClass: route.taskClass,
    provider: route.provider,
    model: route.model,
    workerId: output.allocatedWorker || route.workerId,
    success: 1,
    missionId: mission.id,
    traceId: mission.trace_id,
  });
  if (output.allocatedWorker) {
    recordWorkerOutcome(db, output.allocatedWorker, { success: true, missionId: mission.id });
  }

  return { ok: true, currentPhase, nextPhase, output };
}

export async function runFullAgentLoopOnMission({ db, mission, dispatchMCP, maxPhases = 5 } = {}) {
  const results = [];
  let m = { ...mission };
  for (let i = 0; i < maxPhases; i++) {
    const r = await runAgentLoopPhase({ db, mission: m, dispatchMCP, phase: m.loop_phase });
    results.push(r);
    if (!r.ok) break;
    m = { ...m, loop_phase: r.nextPhase };
    if (r.nextPhase === "continue" || r.nextPhase === "execute") break;
  }
  return { ok: true, phases: results.length, results };
}
