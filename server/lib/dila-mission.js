// server/lib/dila-mission.js
//
// Dila as mission principal — create and own missions as hermes.

import { DILA_AGENT_ID } from "./runtime/constants.js";
import { createMission, getMission, tickMission } from "./mission-runtime.js";
import { runFullAgentLoopOnMission } from "./runtime/agent-loop.js";
import { runImprovementCycle } from "./runtime/self-improvement.js";

export { DILA_AGENT_ID };

/**
 * Create a mission owned by Dila (hermes principal).
 */
export function createDilaMission(db, opts = {}) {
  return createMission(db, {
    ...opts,
    userId: DILA_AGENT_ID,
    asDila: true,
    ownerAgentId: DILA_AGENT_ID,
    source: opts.source || "operator",
  });
}

/**
 * Full Dila mission kickoff: plan + agent loop priming.
 */
export async function kickoffDilaMission({ db, goal, template, dispatchMCP, opts = {} } = {}) {
  if (!db || !goal) return { ok: false, reason: "missing_inputs" };
  const created = createDilaMission(db, {
    goal,
    template,
    title: opts.title || `Dila: ${goal.slice(0, 60)}`,
    source: opts.source || "operator",
    steps: opts.steps,
    domainPack: opts.domainPack,
  });
  if (!created.ok) return created;

  const mission = getMission(db, created.missionId);
  const loop = await runFullAgentLoopOnMission({
    db,
    mission,
    dispatchMCP,
    maxPhases: opts.loopPhases || 4,
  });

  return { ok: true, missionId: created.missionId, traceId: created.traceId, loop };
}

export async function finalizeDilaMission({ db, missionId, dispatchMCP } = {}) {
  const mission = getMission(db, missionId);
  if (!mission) return { ok: false, reason: "not_found" };
  const stepLog = mission.steps || [];
  return runImprovementCycle({ db, mission, stepLog, dispatchMCP });
}

export async function tickDilaMission({ db, missionId, dispatchMCP, STATE } = {}) {
  return tickMission({ db, missionId, dispatchMCP, STATE });
}
