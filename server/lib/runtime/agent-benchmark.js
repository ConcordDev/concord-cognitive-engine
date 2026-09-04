// server/lib/runtime/agent-benchmark.js
//
// P6 — Agent benchmark harness. Runs standard mission scenarios and scores
// completion, latency, and safety compliance.

import crypto from "node:crypto";
import { createMission, tickMission, getMission } from "../mission-runtime.js";
import { planDeterministic } from "../mission-planner.js";

export const BENCHMARK_SCENARIOS = Object.freeze([
  {
    id: "planner_keyword_routing",
    description: "Deterministic planner routes 'fleet health' to fleet_health template",
    run: async ({ db }) => {
      const plan = planDeterministic("verify fleet health and assemble organs");
      return {
        passed: plan.ok && plan.template === "fleet_health" && plan.steps.length >= 3,
        details: { template: plan.template, stepCount: plan.steps?.length },
      };
    },
  },
  {
    id: "mission_create_and_tick",
    description: "Create mission + tick one step with mock dispatch",
    run: async ({ db, dispatchMCP }) => {
      const created = createMission(db, { template: "fleet_health", source: "operator" });
      if (!created.ok) return { passed: false, details: created };
      const tick = await tickMission({ db, missionId: created.missionId, dispatchMCP });
      const m = getMission(db, created.missionId);
      return {
        passed: tick.ok && m.current_step >= 1,
        details: { tick, currentStep: m.current_step },
      };
    },
  },
  {
    id: "autonomous_tool_block",
    description: "Autonomous source cannot use research_invoke",
    run: async ({ db }) => {
      const r = createMission(db, {
        source: "proactive",
        steps: [{ tool: "research_invoke", args: {} }],
      });
      return { passed: r.ok === false && r.reason === "tool_not_allowed", details: r };
    },
  },
  {
    id: "mission_full_completion",
    description: "fleet_health mission completes all steps",
    run: async ({ db, dispatchMCP }) => {
      const created = createMission(db, { template: "fleet_health", source: "scheduled" });
      if (!created.ok) return { passed: false, details: created };
      let last;
      for (let i = 0; i < 6; i++) {
        last = await tickMission({ db, missionId: created.missionId, dispatchMCP });
        if (last.status === "completed" || last.status === "failed") break;
      }
      const m = getMission(db, created.missionId);
      return {
        passed: m.status === "completed",
        details: { status: m.status, steps: m.current_step },
      };
    },
  },
  {
    id: "coding_loop_planner",
    description: "Planner routes implement/refactor goals to coding_loop template",
    run: async ({ db }) => {
      const plan = planDeterministic("implement refactor for mission runtime");
      return {
        passed: plan.ok && plan.template === "coding_loop" && plan.steps.some((s) => s.tool === "coding_loop_search"),
        details: { template: plan.template, tools: plan.steps?.map((s) => s.tool) },
      };
    },
  },
  {
    id: "marathon_bridge_spawn",
    description: "Mission spawns linked marathon session",
    run: async ({ db }) => {
      const { spawnMarathonForMission } = await import("../mission-marathon-bridge.js");
      const created = createMission(db, {
        template: "marathon_delegate",
        source: "operator",
        title: "Bench marathon",
        goal: "Benchmark marathon delegate",
      });
      if (!created.ok) return { passed: false, details: created };
      const mission = getMission(db, created.missionId);
      const spawn = spawnMarathonForMission(db, mission);
      return {
        passed: spawn.ok === true && !!spawn.sessionId,
        details: spawn,
      };
    },
  },
  {
    id: "f0_autonomous_enforce_ready",
    description: "Autonomous sources blocked from forbidden tools even in observe",
    run: async ({ db }) => {
      const r = createMission(db, {
        source: "sentinel",
        steps: [{ tool: "capability_register", args: {} }],
      });
      return { passed: r.ok === false && r.reason === "tool_not_allowed", details: r };
    },
  },
]);

function runId() {
  return `bench_${crypto.randomUUID().slice(0, 12)}`;
}

/**
 * @param {object} opts
 * @param {object} opts.db
 * @param {Function} opts.dispatchMCP
 * @param {string[]} [opts.scenarioIds]
 */
export async function runBenchmark({ db, dispatchMCP, scenarioIds } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  const id = runId();
  const suite = scenarioIds?.length ? "custom" : "runtime_p6";
  const scenarios = scenarioIds
    ? BENCHMARK_SCENARIOS.filter((s) => scenarioIds.includes(s.id))
    : [...BENCHMARK_SCENARIOS];

  try {
    db.prepare(`
      INSERT INTO runtime_benchmark_runs (id, suite, status) VALUES (?, ?, 'running')
    `).run(id, suite);
  } catch {
    return { ok: false, reason: "migration_required" };
  }

  const results = [];
  let passed = 0;
  const started = Date.now();

  for (const scenario of scenarios) {
    const t0 = Date.now();
    let outcome;
    try {
      outcome = await scenario.run({ db, dispatchMCP });
    } catch (e) {
      outcome = { passed: false, details: { error: e?.message || String(e) } };
    }
    const durationMs = Date.now() - t0;
    if (outcome.passed) passed++;
    results.push({ scenarioId: scenario.id, ...outcome, durationMs });
    try {
      db.prepare(`
        INSERT INTO runtime_benchmark_results (run_id, scenario_id, passed, duration_ms, details_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, scenario.id, outcome.passed ? 1 : 0, durationMs, JSON.stringify(outcome.details || {}));
    } catch { /* best effort */ }
  }

  const summary = {
    total: scenarios.length,
    passed,
    failed: scenarios.length - passed,
    passRate: scenarios.length ? passed / scenarios.length : 0,
    durationMs: Date.now() - started,
  };

  try {
    db.prepare(`
      UPDATE runtime_benchmark_runs
      SET status = ?, completed_at = ?, summary_json = ?
      WHERE id = ?
    `).run(
      passed === scenarios.length ? "completed" : "failed",
      Math.floor(Date.now() / 1000),
      JSON.stringify(summary),
      id,
    );
    db.prepare(`
      UPDATE runtime_tier_state SET last_benchmark_at = ?, updated_at = ? WHERE id = 1
    `).run(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
  } catch { /* best effort */ }

  return { ok: true, runId: id, summary, results };
}

export function getBenchmarkRun(db, runId) {
  if (!db || !runId) return null;
  try {
    const run = db.prepare(`SELECT * FROM runtime_benchmark_runs WHERE id = ?`).get(runId);
    if (!run) return null;
    const results = db.prepare(`
      SELECT scenario_id, passed, duration_ms, details_json
      FROM runtime_benchmark_results WHERE run_id = ? ORDER BY id ASC
    `).all(runId);
    return {
      ...run,
      summary: run.summary_json ? JSON.parse(run.summary_json) : null,
      results: results.map((r) => ({
        ...r,
        details: r.details_json ? JSON.parse(r.details_json) : null,
      })),
    };
  } catch {
    return null;
  }
}

export function listBenchmarkRuns(db, limit = 20) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT id, suite, status, started_at, completed_at, summary_json
      FROM runtime_benchmark_runs ORDER BY started_at DESC LIMIT ?
    `).all(Math.min(limit, 100));
  } catch {
    return [];
  }
}
