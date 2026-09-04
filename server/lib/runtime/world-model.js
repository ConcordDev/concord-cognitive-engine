// server/lib/runtime/world-model.js
//
// Stateful world model — repo graph + memory + traces + incidents.

import { buildFullRepoGraph, ensureRepoIndexFresh } from "./repo-graph.js";
import { memoryGraphOverview } from "./memory-graph.js";

export async function buildWorldModelSnapshot({ db, mission, dispatchMCP, repoRoot } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  let repoGraph = buildFullRepoGraph(db, repoRoot);
  if (repoGraph.stale) {
    const fresh = await ensureRepoIndexFresh(db, repoRoot);
    if (fresh.ok) repoGraph = buildFullRepoGraph(db, repoRoot);
  }
  const memory = memoryGraphOverview(db);

  let incidents = [];
  let traces = [];
  let predictions = [];

  if (typeof dispatchMCP === "function") {
    try {
      const inc = await dispatchMCP("incident_list", { active_only: true, limit: 10 }, { db });
      incidents = inc?.result?.observation?.incidents || inc?.result?.incidents || [];
    } catch { /* optional */ }
    try {
      const tr = await dispatchMCP("trace_recent", { limit: 15 }, { db });
      traces = tr?.result?.observation?.traces || tr?.result?.traces || [];
    } catch { /* optional */ }
    try {
      const pr = await dispatchMCP("proactive_list_predictions", { horizon: "near", limit: 5 }, { db });
      predictions = pr?.result?.observation?.predictions || pr?.result?.predictions || [];
    } catch { /* optional */ }
  }

  const snapshot = {
    missionId: mission?.id || null,
    objective: mission?.goal || mission?.title || null,
    repo: {
      files: repoGraph.graphs?.architecture?.files || 0,
      exports: repoGraph.graphs?.architecture?.exports || 0,
      edges: repoGraph.graphs?.dependency?.edges || 0,
      ok: repoGraph.ok,
      stale: repoGraph.stale,
    },
    memory: {
      nodesByClass: memory.nodesByClass || {},
      edgeCount: memory.edgeCount || 0,
    },
    incidents: incidents.slice(0, 10),
    recentTraces: traces.slice(0, 15),
    predictions: predictions.slice(0, 5),
    graphs: {
      architecture: repoGraph.graphs?.architecture || {},
      dependency: repoGraph.graphs?.dependency || {},
      migration: repoGraph.graphs?.migration || {},
      api: repoGraph.graphs?.api || {},
      test: repoGraph.graphs?.test || {},
      runtime: "supervisor_tree",
      incident: "incident_engine",
    },
    updatedAt: Math.floor(Date.now() / 1000),
  };

  return { ok: true, snapshot };
}

export function summarizeWorldModelForPlan(snapshot) {
  if (!snapshot?.ok) return { ok: false, reason: "no_snapshot" };
  const s = snapshot.snapshot;
  return {
    ok: true,
    summary: {
      repoFiles: s.repo.files,
      memoryNodes: Object.values(s.memory.nodesByClass || {}).reduce((a, b) => a + b, 0),
      activeIncidents: s.incidents.length,
      openPredictions: s.predictions.filter((p) => !p.outcome || p.outcome === "pending").length,
    },
  };
}
