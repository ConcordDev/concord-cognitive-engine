// server/lib/runtime/context-assembler.js
//
// Assembles optimal context for executive reasoning — mission + ledger + route + memory hints.

import { compactLedgerForContext } from "./execution-ledger.js";
import { gatherObservationSnapshot } from "./continuous-observation.js";
import { compileExecutiveCognition } from "./dhtp-compiler.js";
import { getEconomicPathConfig, getBlindPathConfig } from "./cognitive-economics.js";
import { compileToolUniverse } from "./tool-universe-compiler.js";
import { buildRepoContextForTask } from "./repository-world-model.js";

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

  const goal = mission?.goal || mission?.title || "";
  const taskClass = route?.taskClass || mission?.template || "";
  const isCodingTask = /code|repo|swe|coding|debug|implement|refactor/i.test(`${taskClass} ${goal} ${step?.tool || ""}`);

  if (isCodingTask && db) {
    try {
      base.repoContext = buildRepoContextForTask(db, {
        intent: goal,
        symbol: step?.tool,
        keywords: [taskClass, step?.tool].filter(Boolean),
      });
    } catch { /* optional */ }
  }

  try {
    const compiledTools = compileToolUniverse(`${goal} ${step?.tool || ""}`, {
      budget: 8,
      includeReflected: false,
      alwaysInclude: ["dtu_search", "trace_recent", "dhtp_compress"],
    });
    if (compiledTools.tools?.length) {
      base.toolHints = compiledTools.tools.map((t) => t.name);
      base.toolCompile = {
        selectedCount: compiledTools.selectedCount,
        catalogSize: compiledTools.catalogSize,
        compressionRatio: compiledTools.compressionRatio,
      };
    }
  } catch { /* optional */ }

  let cognition = null;
  try {
    const blindPath = mission?.spawn_context?.blindPath || process.env.COGNITIVE_BLIND_PATH;
    const econPath = mission?.spawn_context?.econPath || process.env.COGNITIVE_ECON_PATH;
    const pathId = blindPath || econPath;
    const pathCfg = pathId
      ? (blindPath ? getBlindPathConfig(pathId) : getEconomicPathConfig(pathId))
      : null;
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
