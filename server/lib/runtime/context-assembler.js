// server/lib/runtime/context-assembler.js
//
// Assembles optimal context for executive reasoning — mission + ledger + route + memory hints.

import { compactLedgerForContext } from "./execution-ledger.js";
import { gatherObservationSnapshot } from "./continuous-observation.js";
import { compileExecutiveCognition } from "./dhtp-compiler.js";
import { getEconomicPathConfig } from "./cognitive-economics.js";

export async function assembleExecutiveContext({
  db, mission, step, stepIndex, route, ledger, dispatchMCP, lessons = [],
} = {}) {
  const base = {
    missionId: mission?.id,
    goal: mission?.goal || mission?.title,
    template: mission?.template,
    source: mission?.source,
    stepIndex,
    stepTool: step?.tool,
    totalSteps: mission?.total_steps,
    recoveryAttempts: mission?.recovery_attempts || 0,
    assignedWorker: mission?.assigned_worker_id || route?.workerId || null,
    route: route ? {
      taskClass: route.taskClass,
      workerId: route.workerId,
      provider: route.provider,
      model: route.model,
    } : null,
    ledger: compactLedgerForContext(ledger || {}),
    lessons: (lessons || []).slice(0, 3).map((l) => l.lesson).filter(Boolean),
  };

  if (typeof dispatchMCP === "function" && mission?.trace_id) {
    try {
      const trace = await dispatchMCP("trace_recent", { limit: 3, trace_id: mission.trace_id }, { db });
      const rows = trace?.result?.observation?.traces || trace?.result?.traces || [];
      base.recentTraces = rows.slice(0, 3).map((t) => ({
        tool: t.tool || t.name,
        ok: t.ok,
        at: t.created_at || t.at,
      }));
    } catch { /* optional */ }
  }

  if (db && mission?.id) {
    try {
      const prior = db.prepare(`
        SELECT tool_name, status FROM mission_step_log
        WHERE mission_id = ? AND step_index < ?
        ORDER BY step_index DESC LIMIT 5
      `).all(mission.id, stepIndex);
      base.priorSteps = prior;
    } catch { /* optional */ }
  }

  try {
    const obs = gatherObservationSnapshot(db);
    if (obs.ok) base.observation = obs.snapshot;
  } catch { /* optional */ }

  let cognition = null;
  try {
    const econPath = mission?.spawn_context?.econPath || process.env.COGNITIVE_ECON_PATH;
    const pathCfg = econPath ? getEconomicPathConfig(econPath) : null;
    cognition = await compileExecutiveCognition({
      db, mission, step, stepIndex, route, ledger, lessons, context: base,
      ...(pathCfg?.compile || {}),
    });
  } catch { /* optional pre-migration */ }

  return {
    ok: true,
    context: base,
    cognition,
    dhtp: cognition?.dhtp || null,
    routeHints: cognition?.routeHints || null,
    compiledPrompt: cognition?.systemPrompt || null,
  };
}
