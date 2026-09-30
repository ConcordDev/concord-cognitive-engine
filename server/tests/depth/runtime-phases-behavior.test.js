// server/tests/depth/runtime-phases-behavior.test.js
//
// P1–P6 — Mission planner, parallel fabric, memory graph, domain packs,
// repo graph, supervisor, benchmark harness.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upPhases } from "../../migrations/424_runtime_phases.js";
import { up as upTier } from "../../migrations/425_runtime_tier.js";
import { up as upDila } from "../../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../../migrations/427_dila_runtime_v2.js";
import { up as upMarathon } from "../../migrations/171_agent_marathon_sessions.js";
import {
  createMission,
  getMission,
  tickMission,
  planMissionGoal,
} from "../../lib/mission-runtime.js";
import { planDeterministic } from "../../lib/mission-planner.js";
import { runParallelBatch } from "../../lib/parallel-agent-fabric.js";
import { ingestMissionCompletion, memoryGraphOverview } from "../../lib/runtime/memory-graph.js";
import { expandDomainPack, listDomainPacks } from "../../lib/runtime/domain-packs.js";
import { collectSupervisorStatus } from "../../lib/runtime/supervisor.js";
import { runBenchmark } from "../../lib/runtime/agent-benchmark.js";

function setupDb() {
  const db = new Database(":memory:");
  upMission(db);
  upPhases(db);
  upTier(db);
  upMarathon(db);
  upDila(db);
  upV2(db);
  return db;
}

function mockDispatch(results = {}) {
  const dispatchMCP = async (tool) => {
    if (results[tool]) return results[tool];
    return { ok: true, decision: "ALLOW", result: { ok: true, observation: { tool } } };
  };
  return { dispatchMCP };
}

describe("P1 mission planner", () => {
  it("routes fleet health goal to fleet_health template", () => {
    const plan = planDeterministic("verify fleet health and assemble organs");
    assert.equal(plan.ok, true);
    assert.equal(plan.template, "fleet_health");
    assert.ok(plan.steps.length >= 3);
  });

  it("planMissionGoal returns deterministic plan by default", async () => {
    const plan = await planMissionGoal({ goal: "watch for incidents and alerts" });
    assert.equal(plan.ok, true);
    assert.equal(plan.template, "watch_detect");
  });
});

describe("P2 parallel agent fabric", () => {
  it("runs a parallel batch and persists workers", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();
    const created = createMission(db, { template: "fleet_health", source: "operator" });
    const batch = await runParallelBatch({
      db,
      missionId: created.missionId,
      traceId: "t1",
      tasks: [
        { tool: "sentinel_sweep", args: {} },
        { tool: "economic_check", args: {} },
      ],
      dispatchMCP,
    });
    assert.equal(batch.ok, true);
    assert.equal(batch.workers, 2);
    const workers = db.prepare(`SELECT COUNT(*) AS c FROM mission_workers`).get();
    assert.equal(workers.c, 2);
  });
});

describe("P3 memory graph", () => {
  it("ingests mission completion as episodic memory", () => {
    const db = setupDb();
    const created = createMission(db, { template: "fleet_health", source: "scheduled" });
    const m = getMission(db, created.missionId);
    const r = ingestMissionCompletion(db, { ...m, status: "completed" });
    assert.equal(r.ok, true);
    const ov = memoryGraphOverview(db);
    assert.equal(ov.ok, true);
    assert.ok((ov.nodesByClass.episodic || 0) >= 1);
  });
});

describe("P4 domain packs + supervisor", () => {
  it("lists domain packs and expands fleet_ops", () => {
    const packs = listDomainPacks();
    assert.ok(packs.length >= 4);
    const expanded = expandDomainPack("fleet_ops");
    assert.equal(expanded.ok, true);
    assert.ok(expanded.steps.length >= 1);
  });

  it("collectSupervisorStatus returns overall status", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();
    const status = await collectSupervisorStatus({ db, dispatchMCP });
    assert.ok(["RUNNING", "DEGRADED", "FAILED", "DISABLED"].includes(status.overall));
    assert.ok(status.subsystems.mission_runtime);
  });
});

describe("P1 goal-based createMission", () => {
  it("creates mission from goal without explicit template", () => {
    const db = setupDb();
    const r = createMission(db, { goal: "consolidate experience and learn", source: "operator" });
    assert.equal(r.ok, true);
    const m = getMission(db, r.missionId);
    assert.equal(m.template, "experience_consolidate");
  });
});

describe("P6 agent benchmark", () => {
  it("runs benchmark scenarios with mock dispatch", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();
    const r = await runBenchmark({ db, dispatchMCP });
    assert.equal(r.ok, true);
    assert.ok(r.summary.total >= 4);
    assert.equal(r.summary.passed, r.summary.total);
  });
});

describe("internal runtime tools in tickMission", () => {
  it("executes repo_graph_index step without F0 dispatch", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();
    const created = createMission(db, {
      source: "operator",
      steps: [{ tool: "repo_graph_index", args: {} }],
    });
    const tick = await tickMission({ db, missionId: created.missionId, dispatchMCP });
    assert.equal(tick.status, "completed");
    const m = getMission(db, created.missionId);
    assert.equal(m.status, "completed");
  });
});
