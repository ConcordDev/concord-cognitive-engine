// server/lib/runtime/mission-control.js
//
// Mission control plane — observable autonomous operations.

import { countActiveMissions, listMissions, runtimeOverview } from "../mission-runtime.js";
import { orgOverview } from "./agent-org.js";
import { recoveryOverview } from "./recovery.js";
import { memoryGraphOverview } from "./memory-graph.js";
import { causalMemoryOverview } from "./causal-memory.js";
import { computeDilaCapabilityIndex } from "./dila-capability-index.js";
import { listImprovementProposals } from "./self-improvement.js";
import { routingStats } from "./model-router.js";

function safeParse(json, fallback = null) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

export function getMissionControlDetail(db, missionId) {
  if (!db || !missionId) return { ok: false, reason: "missing_inputs" };
  try {
    const mission = db.prepare(`SELECT * FROM mission_tasks WHERE id = ?`).get(missionId);
    if (!mission) return { ok: false, reason: "not_found" };

    const steps = db.prepare(`
      SELECT * FROM mission_step_log WHERE mission_id = ? ORDER BY step_index ASC
    `).all(missionId);

    const ledger = db.prepare(`
      SELECT step_index, ledger_json, created_at FROM runtime_execution_ledger
      WHERE mission_id = ? ORDER BY created_at DESC LIMIT 20
    `).all(missionId);

    const recovery = db.prepare(`
      SELECT * FROM runtime_recovery_events WHERE mission_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(missionId);

    const causal = db.prepare(`
      SELECT lesson, action_json, result_json, created_at FROM runtime_causal_chains
      WHERE mission_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(missionId);

    const workers = db.prepare(`
      SELECT * FROM mission_workers WHERE mission_id = ? ORDER BY worker_index ASC
    `).all(missionId);

    return {
      ok: true,
      mission: {
        ...mission,
        steps_plan: safeParse(mission.steps_json, []),
        route: safeParse(mission.last_route_json, null),
        executive_state: safeParse(mission.executive_state_json, null),
      },
      why: { goal: mission.goal, source: mission.source, template: mission.template },
      what: { currentStep: mission.current_step, totalSteps: mission.total_steps, status: mission.status },
      who: { owner: mission.owner_agent_id, assignedWorker: mission.assigned_worker_id, userId: mission.user_id },
      tools: steps.map((s) => ({ step: s.step_index, tool: s.tool_name, status: s.status, durationMs: s.duration_ms })),
      evidence: ledger.map((l) => ({ step: l.step_index, ledger: safeParse(l.ledger_json, {}), at: l.created_at })),
      decisions: safeParse(mission.executive_state_json, null),
      failures: steps.filter((s) => s.status === "failed"),
      recovery,
      memory: causal,
      parallelWorkers: workers,
      result: { status: mission.status, error: mission.error_reason, completedAt: mission.completed_at },
    };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function getMissionControlPlane(db) {
  if (!db) return { ok: false, reason: "no_db" };

  const overview = runtimeOverview(db);
  const active = countActiveMissions(db);
  const running = listMissions(db, { status: "running", limit: 20 });
  const pending = listMissions(db, { status: "pending", limit: 10 });
  const failed = listMissions(db, { status: "failed", limit: 5 });

  let workerStats = { active: 0, idle: 0, degraded: 0 };
  try {
    const org = orgOverview(db);
    if (org.ok) {
      for (const rows of Object.values(org.directors || {})) {
        for (const w of rows) {
          if (w.current_mission_id) workerStats.active++;
          else if ((w.reliability_score || 0) < 0.4) workerStats.degraded++;
          else workerStats.idle++;
        }
      }
    }
  } catch { /* optional */ }

  return {
    ok: true,
    dila: { principal: "hermes", status: "autonomous" },
    missions: {
      active,
      running: running.length,
      waiting: pending.length,
      failed: failed.length,
      recent: running.slice(0, 7).map((m) => ({
        id: m.id,
        title: m.title,
        template: m.template,
        step: `${m.current_step}/${m.total_steps}`,
        status: m.status,
      })),
    },
    workers: workerStats,
    capabilityIndex: computeDilaCapabilityIndex(db),
    recovery: recoveryOverview(db),
    memory: memoryGraphOverview(db),
    causal: causalMemoryOverview(db),
    routing: routingStats(db),
    improvements: listImprovementProposals(db, 5),
    overview,
  };
}
