// server/lib/runtime/model-router.js
//
// Unified runtime model router — task-class → provider/model/worker.
// Learns from outcomes via runtime_model_routing table.

import { pickBrainEndpoint } from "../brain-config.js";
import { DILA_AGENT_ID } from "./constants.js";
import { pickWorkerForTask, listWorkersForTask } from "./agent-org.js";

const TASK_CLASS_DIRECTOR = Object.freeze({
  coding: "engineering",
  reasoning: "research",
  research: "research",
  vision: "engineering",
  classification: "operations",
  local: "operations",
  private: "operations",
  cheap: "operations",
});

const TASK_CLASS_RULES = Object.freeze({
  coding: { brain: "utility", workerPrefix: "wr-grok-code", fallbackWorker: "wr-mistral-2" },
  reasoning: { brain: "conscious", workerPrefix: "wr-grok-reasoning", fallbackWorker: "cc-be" },
  research: { brain: "conscious", workerPrefix: "wr-gemini", fallbackWorker: "wr-kimi-k2.5" },
  vision: { brain: "multimodal", workerPrefix: "wr-vision", fallbackWorker: "oc-vision" },
  classification: { brain: "repair", workerPrefix: "wr-summary", fallbackWorker: "wr-distill" },
  local: { brain: "utility", workerPrefix: "oc-", fallbackWorker: "oc-lightning" },
  private: { brain: "subconscious", workerPrefix: "oc-", fallbackWorker: "oc-pickle" },
  cheap: { brain: "repair", workerPrefix: "wr-groq", fallbackWorker: "wr-groq-1" },
});

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_model_routing'`).get();
  } catch {
    return false;
  }
}

function classifyTask({ taskClass, hint, tool, goal } = {}) {
  if (taskClass && TASK_CLASS_RULES[taskClass]) return taskClass;
  const h = `${hint || ""} ${tool || ""} ${goal || ""}`.toLowerCase();
  if (/code|refactor|implement|migration|test|debug|repo/.test(h)) return "coding";
  if (/research|cite|source|news|evidence/.test(h)) return "research";
  if (/image|vision|screenshot|ocr/.test(h)) return "vision";
  if (/classify|tag|route|cheap/.test(h)) return "classification";
  if (/private|local|offline/.test(h)) return "private";
  if (/reason|plan|hypothesis|predict/.test(h)) return "reasoning";
  return "reasoning";
}

async function pickWorkerForClass(taskClass, roster = []) {
  const rule = TASK_CLASS_RULES[taskClass] || TASK_CLASS_RULES.reasoning;
  const prefix = rule.workerPrefix;
  const alive = roster.filter((w) => w.alive);
  const match = alive.find((w) => w.name?.startsWith(prefix))
    || alive.find((w) => w.name === rule.fallbackWorker)
    || alive[0];
  return match?.name || rule.fallbackWorker;
}

function learnedPreference(db, taskClass) {
  if (!db || !tablesReady(db)) return null;
  try {
    const rows = db.prepare(`
      SELECT provider, model, worker_id,
             AVG(success) AS success_rate,
             AVG(latency_ms) AS avg_latency,
             COUNT(*) AS n
      FROM runtime_model_routing
      WHERE task_class = ? AND created_at >= unixepoch() - 604800
      GROUP BY provider, model, worker_id
      HAVING n >= 3
      ORDER BY success_rate DESC, avg_latency ASC
      LIMIT 1
    `).get(taskClass);
    return rows || null;
  } catch {
    return null;
  }
}

/**
 * Route a task to the best provider/model/worker for the runtime.
 */
export async function routeModel({ db, taskClass, hint, tool, goal, missionId, traceId, roster, routeHints } = {}) {
  const cls = classifyTask({ taskClass, hint, tool, goal });
  const learned = learnedPreference(db, cls);
  const rule = TASK_CLASS_RULES[cls] || TASK_CLASS_RULES.reasoning;
  const brain = rule.brain;
  const endpoint = pickBrainEndpoint(brain, { includeCloud: process.env.CONCORD_HIGH_POWER_ROUTING === "1" });

  let workerRoster = roster;
  if (!workerRoster) {
    try {
      const { getWorkerRoster } = await import("../dila-workers.js");
      workerRoster = await getWorkerRoster();
    } catch {
      workerRoster = [];
    }
  }
  const workerId = learned?.worker_id
    || pickWorkerForTask(db, {
      director: TASK_CLASS_DIRECTOR[cls] || "engineering",
      specialization: cls === "coding" ? "coding" : cls === "research" ? "research" : "general",
      taskUrgency: /urgent|critical|incident/i.test(goal || "") ? 0.9 : 0.5,
    })
    || await pickWorkerForClass(cls, workerRoster);

  const ranked = listWorkersForTask(db, {
    director: TASK_CLASS_DIRECTOR[cls],
    specialization: cls === "coding" ? "coding" : "general",
  });

  const route = {
    ok: true,
    taskClass: cls,
    brain,
    endpoint,
    provider: learned?.provider || (endpoint?.startsWith("cloud:") ? endpoint : "ollama"),
    model: learned?.model || brain,
    workerId,
    principal: DILA_AGENT_ID,
    learned: !!learned,
    maxResponseTokens: routeHints?.maxResponseTokens,
    dtuBudgetPct: routeHints?.dtuBudgetPct,
    minimumRepresentation: routeHints?.minimumRepresentation,
    workerCandidates: ranked.slice(0, 3).map((w) => ({
      id: w.worker_id,
      score: w.score,
      reliability: w.reliability_score,
    })),
  };

  return route;
}

export function recordRoutingOutcome(db, {
  taskClass, provider, model, workerId, success, latencyMs, costEstimate, missionId, traceId,
} = {}) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  try {
    db.prepare(`
      INSERT INTO runtime_model_routing
        (task_class, provider, model, worker_id, success, latency_ms, cost_estimate, mission_id, trace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskClass,
      provider || "unknown",
      model || null,
      workerId || null,
      success ? 1 : 0,
      latencyMs ?? null,
      costEstimate ?? null,
      missionId || null,
      traceId || null,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function routingStats(db, taskClass) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  try {
    const rows = db.prepare(`
      SELECT task_class, provider, model, worker_id,
             COUNT(*) AS calls,
             AVG(success) AS success_rate,
             AVG(latency_ms) AS avg_latency_ms
      FROM runtime_model_routing
      WHERE (? IS NULL OR task_class = ?)
      GROUP BY task_class, provider, model, worker_id
      ORDER BY success_rate DESC
      LIMIT 50
    `).all(taskClass || null, taskClass || null);
    return { ok: true, stats: rows };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}
