// server/lib/runtime/dila-bench.js
//
// DilaBench — expanded benchmark categories for long-horizon reliability.

import crypto from "node:crypto";
import { BENCHMARK_SCENARIOS, runBenchmark as runCoreBenchmark } from "./agent-benchmark.js";
import { createMission, tickMission, getMission } from "../mission-runtime.js";
import { runAgentLoopPhase } from "./agent-loop.js";
import { critiqueResult } from "./critic.js";
import { buildWorldModelSnapshot } from "./world-model.js";
import { loadLatestCheckpoint, saveCheckpoint } from "./agent-loop.js";
import { attemptRecovery } from "./recovery.js";
import { runSoakSimulation } from "./soak-harness.js";

export const DILA_BENCH_SUITES = Object.freeze({
  dila_core: "runtime_p6",
  coding: "dila_coding",
  autonomy: "dila_autonomy",
  memory: "dila_memory",
  recovery: "dila_recovery",
  multi_agent: "dila_multi_agent",
});

const EXTENDED_SCENARIOS = Object.freeze([
  {
    id: "world_model_snapshot",
    category: "memory",
    description: "World model builds repo + memory + incident snapshot",
    run: async ({ db, dispatchMCP }) => {
      const wm = await buildWorldModelSnapshot({ db, dispatchMCP });
      return { passed: wm.ok === true && wm.snapshot?.repo != null, details: wm.snapshot };
    },
  },
  {
    id: "agent_loop_checkpoint",
    category: "autonomy",
    description: "Agent loop saves and restores checkpoint",
    run: async ({ db, dispatchMCP }) => {
      const created = createMission(db, {
        template: "fleet_health",
        source: "operator",
        asDila: true,
        goal: "verify fleet and research opportunities",
      });
      if (!created.ok) return { passed: false, details: created };
      const mission = getMission(db, created.missionId);
      const phase = await runAgentLoopPhase({ db, mission, dispatchMCP, phase: "world_model" });
      const cp = loadLatestCheckpoint(db, created.missionId);
      return { passed: phase.ok && !!cp?.state, details: { phase: phase.currentPhase, checkpoint: !!cp } };
    },
  },
  {
    id: "critic_rejects_bad_result",
    category: "coding",
    description: "Critic rejects result without evidence or with failed tests",
    run: async () => {
      const c = critiqueResult({
        objective: "migrate repository schema",
        result: { ok: true, summary: "done" },
        testsPassed: false,
        intentVerified: false,
      });
      return { passed: c.verdict === "reject", details: c };
    },
  },
  {
    id: "recovery_checkpoint_resume",
    category: "recovery",
    description: "Recovery resumes from checkpoint on infrastructure failure",
    run: async ({ db }) => {
      const created = createMission(db, { template: "fleet_health", source: "operator", asDila: true });
      saveCheckpoint(db, created.missionId, {
        stepIndex: 1,
        loopPhase: "execute",
        state: { note: "saved" },
      });
      const mission = getMission(db, created.missionId);
      const r = await attemptRecovery({
        db,
        mission,
        failure: { gateResult: { reason: "migration_required" }, tool: "test" },
        loadCheckpoint: loadLatestCheckpoint,
      });
      return { passed: r.ok && r.recoveryAction === "checkpoint_resume", details: r };
    },
  },
  {
    id: "long_horizon_mission_ticks",
    category: "autonomy",
    description: "Mission survives multiple ticks without collapsing",
    run: async ({ db, dispatchMCP }) => {
      const created = createMission(db, {
        template: "coding_loop",
        source: "operator",
        asDila: true,
        goal: "refactor mission runtime tests",
      });
      if (!created.ok) return { passed: false, details: created };
      let last;
      for (let i = 0; i < 4; i++) {
        last = await tickMission({ db, missionId: created.missionId, dispatchMCP });
        if (last.status === "failed") break;
      }
      const m = getMission(db, created.missionId);
      return {
        passed: m.status !== "failed" && m.current_step >= 1,
        details: { status: m.status, step: m.current_step, ticks: m.tick_count },
      };
    },
  },
  {
    id: "swe_mini_harness",
    category: "coding",
    description: "Synthetic SWE mini cases pass patch+test loop",
    run: async ({ db }) => {
      const { runSweHarness } = await import("./swe-harness.js");
      const r = await runSweHarness({ db });
      return { passed: r.ok && r.passRate >= 1, details: r };
    },
  },
  {
    id: "worker_adapter_allowlist",
    category: "multi_agent",
    description: "Worker adapters block cc-* and wr-grok without keys",
    run: async () => {
      const { isWorkerAllowed } = await import("./worker-adapters.js");
      return {
        passed: !isWorkerAllowed("cc-haiku") && isWorkerAllowed("wr-groq-1"),
        details: { groq: isWorkerAllowed("wr-groq-1"), claude: isWorkerAllowed("cc-haiku") },
      };
    },
  },
  {
    id: "mission_priority_scoring",
    category: "autonomy",
    description: "Incident candidates outrank idle heartbeat",
    run: async () => {
      const { scoreCandidate } = await import("./mission-priority.js");
      const incident = scoreCandidate({ source: "incident", severity: 0.9 });
      const idle = scoreCandidate({ source: "heartbeat" });
      return { passed: incident > idle, details: { incident, idle } };
    },
  },
  {
    id: "dila_principal_binding",
    category: "multi_agent",
    description: "Dila-owned missions bind owner_agent_id=hermes",
    run: async ({ db }) => {
      const created = createMission(db, {
        template: "fleet_health",
        source: "operator",
        asDila: true,
      });
      if (!created.ok) return { passed: false, details: created };
      const row = db.prepare(`SELECT owner_agent_id FROM mission_tasks WHERE id = ?`).get(created.missionId);
      return { passed: row?.owner_agent_id === "hermes", details: row };
    },
  },
  {
    id: "seven_day_mission_coherence",
    category: "autonomy",
    description: "7 virtual-day soak maintains checkpoint coherence",
    run: async ({ db, dispatchMCP }) => {
      const soak = await runSoakSimulation({
        db,
        dispatchMCP,
        days: 7,
        ticksPerDay: 2,
      });
      return {
        passed: soak.ok && soak.summary?.pass === true,
        details: soak.summary,
      };
    },
  },
]);

const SUITE_SCENARIOS = Object.freeze({
  dila_core: [...BENCHMARK_SCENARIOS],
  dila_coding: EXTENDED_SCENARIOS.filter((s) => s.category === "coding"),
  dila_autonomy: EXTENDED_SCENARIOS.filter((s) => s.category === "autonomy"),
  dila_memory: EXTENDED_SCENARIOS.filter((s) => s.category === "memory"),
  dila_recovery: EXTENDED_SCENARIOS.filter((s) => s.category === "recovery"),
  dila_multi_agent: EXTENDED_SCENARIOS.filter((s) => s.category === "multi_agent"),
  dila_soak: EXTENDED_SCENARIOS.filter((s) => s.id === "seven_day_mission_coherence"),
  dila_full: [...BENCHMARK_SCENARIOS, ...EXTENDED_SCENARIOS],
});

export async function runBenchmark({ db, dispatchMCP, suite = "dila_core", scenarioIds } = {}) {
  if (scenarioIds?.length) {
    const all = [...BENCHMARK_SCENARIOS, ...EXTENDED_SCENARIOS];
    const picked = all.filter((s) => scenarioIds.includes(s.id));
    return runScenarioSet({ db, dispatchMCP, scenarios: picked, suite: "custom" });
  }
  if (suite === "runtime_p6" || suite === "dila_core") {
    return runCoreBenchmark({ db, dispatchMCP });
  }
  const scenarios = SUITE_SCENARIOS[suite] || SUITE_SCENARIOS.dila_full;
  return runScenarioSet({ db, dispatchMCP, scenarios, suite });
}

async function runScenarioSet({ db, dispatchMCP, scenarios, suite }) {
  if (!db) return { ok: false, reason: "no_db" };
  const id = `bench_${crypto.randomUUID().slice(0, 12)}`;
  try {
    db.prepare(`INSERT INTO runtime_benchmark_runs (id, suite, status) VALUES (?, ?, 'running')`).run(id, suite);
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
    results.push({ scenarioId: scenario.id, category: scenario.category, ...outcome, durationMs });
    try {
      db.prepare(`
        INSERT INTO runtime_benchmark_results (run_id, scenario_id, passed, duration_ms, details_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, scenario.id, outcome.passed ? 1 : 0, durationMs, JSON.stringify(outcome.details || {}));
    } catch { /* best effort */ }
  }

  const summary = {
    suite,
    total: scenarios.length,
    passed,
    failed: scenarios.length - passed,
    passRate: scenarios.length ? passed / scenarios.length : 0,
    durationMs: Date.now() - started,
  };

  try {
    db.prepare(`
      UPDATE runtime_benchmark_runs
      SET status = ?, completed_at = ?, summary_json = ? WHERE id = ?
    `).run(passed === scenarios.length ? "completed" : "failed", Math.floor(Date.now() / 1000), JSON.stringify(summary), id);
  } catch { /* best effort */ }

  return { ok: true, runId: id, summary, results };
}

export { BENCHMARK_SCENARIOS, EXTENDED_SCENARIOS };
