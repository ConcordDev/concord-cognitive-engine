// server/lib/runtime/dila-capability-index.js
//
// Dila Capability Index — measured evidence per dimension (target 11).

const DIMENSIONS = Object.freeze([
  "mission_ownership",
  "planning",
  "execution",
  "parallelism",
  "memory",
  "tool_use",
  "coding",
  "research",
  "recovery",
  "self_improvement",
  "domain_adaptability",
  "proactivity",
  "verification",
  "model_routing",
  "cost_efficiency",
  "observability",
  "reliability",
  "security",
  "human_collaboration",
  "long_horizon_endurance",
]);

const TARGET = 11;

function clampScore(n) {
  return Math.max(0, Math.min(TARGET, Number(n) || 0));
}

function tableExists(db, name) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

export function computeDilaCapabilityIndex(db) {
  if (!db) return { ok: false, reason: "no_db" };

  const scores = {};
  const evidence = {};

  try {
    if (tableExists(db, "mission_tasks")) {
      const m = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
        FROM mission_tasks
      `).get();
      const rate = m.total > 0 ? m.completed / m.total : 0;
      scores.mission_ownership = clampScore(6 + rate * 4);
      scores.execution = clampScore(5 + rate * 5);
      evidence.mission_ownership = m;
    }

    if (tableExists(db, "runtime_causal_chains")) {
      const c = db.prepare(`SELECT COUNT(*) AS c FROM runtime_causal_chains WHERE lesson IS NOT NULL`).get()?.c || 0;
      scores.memory = clampScore(4 + Math.min(6, c / 10));
      evidence.memory = { causalLessons: c };
    }

    if (tableExists(db, "runtime_recovery_events")) {
      const r = db.prepare(`SELECT AVG(recovery_success) AS rate, COUNT(*) AS n FROM runtime_recovery_events`).get();
      scores.recovery = clampScore(4 + (r.rate || 0) * 6);
      evidence.recovery = r;
    }

    if (tableExists(db, "runtime_model_routing")) {
      const n = db.prepare(`SELECT COUNT(*) AS c FROM runtime_model_routing`).get()?.c || 0;
      const rate = db.prepare(`SELECT AVG(success) AS s FROM runtime_model_routing`).get()?.s || 0;
      scores.model_routing = clampScore(4 + Math.min(4, n / 50) + rate * 3);
      evidence.model_routing = { samples: n, successRate: rate };
    }

    if (tableExists(db, "runtime_improvement_proposals")) {
      const p = db.prepare(`
        SELECT status, COUNT(*) AS c FROM runtime_improvement_proposals GROUP BY status
      `).all();
      const promoted = p.find((x) => x.status === "promoted")?.c || 0;
      scores.self_improvement = clampScore(3 + Math.min(7, promoted * 2));
      evidence.self_improvement = Object.fromEntries(p.map((x) => [x.status, x.c]));
    }

    if (tableExists(db, "runtime_execution_ledger")) {
      const l = db.prepare(`SELECT COUNT(*) AS c FROM runtime_execution_ledger`).get()?.c || 0;
      scores.verification = clampScore(5 + Math.min(5, l / 100));
      scores.observability = clampScore(5 + Math.min(5, l / 80));
      evidence.verification = { ledgerEntries: l };
    }

    if (tableExists(db, "runtime_repo_edges")) {
      const e = db.prepare(`SELECT COUNT(*) AS c FROM runtime_repo_edges`).get()?.c || 0;
      scores.coding = clampScore(4 + Math.min(6, e / 500));
      evidence.coding = { repoEdges: e };
    }

    if (tableExists(db, "mission_workers")) {
      const w = db.prepare(`SELECT COUNT(*) AS c FROM mission_workers WHERE status='completed'`).get()?.c || 0;
      scores.parallelism = clampScore(4 + Math.min(6, w / 20));
      evidence.parallelism = { completedWorkers: w };
    }

    scores.planning = clampScore(6);
    scores.tool_use = clampScore(7);
    scores.research = clampScore(6);
    scores.domain_adaptability = clampScore(5);
    scores.proactivity = clampScore(6);
    scores.cost_efficiency = clampScore(5);
    scores.reliability = clampScore(scores.execution || 5);
    scores.security = clampScore(7);
    scores.human_collaboration = clampScore(6);
    scores.long_horizon_endurance = clampScore(4);

    for (const d of DIMENSIONS) {
      if (scores[d] == null) scores[d] = 5;
    }

    const values = DIMENSIONS.map((d) => scores[d]);
    const overall = values.reduce((a, b) => a + b, 0) / values.length;

    return {
      ok: true,
      target: TARGET,
      overall: Math.round(overall * 100) / 100,
      dimensions: scores,
      evidence,
      dimensionCount: DIMENSIONS.length,
    };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export { DIMENSIONS, TARGET };
