// server/tests/depth/runtime-tier-climb.test.js
//
// Top-tier climb — F0 gates, coding loop, marathon bridge, expanded benchmark.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upPhases } from "../../migrations/424_runtime_phases.js";
import { up as upTier } from "../../migrations/425_runtime_tier.js";
import { up as upDila } from "../../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../../migrations/427_dila_runtime_v2.js";
import { up as upMarathon } from "../../migrations/171_agent_marathon_sessions.js";
import { createMission, tickMission, getMission } from "../../lib/mission-runtime.js";
import { planCodingLoop, searchCodingTargets } from "../../lib/coding-loop.js";
import { spawnMarathonForMission, checkMarathonMissionProgress, listLinkedMarathons } from "../../lib/mission-marathon-bridge.js";
import { check as checkResource } from "../../lib/auth-gate/gates/resource.js";
import { check as checkRollback } from "../../lib/auth-gate/gates/rollback.js";
import { runBenchmark } from "../../lib/runtime/agent-benchmark.js";
import { collectSupervisorStatus } from "../../lib/runtime/supervisor.js";

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

function mockDispatch() {
  return async (tool) => ({ ok: true, decision: "ALLOW", result: { ok: true, observation: { tool } } });
}

describe("F0 resource + rollback gates", () => {
  it("resource gate skips when budget check disabled", async () => {
    const prev = process.env.CONCORD_AUTH_GATE_BUDGET_CHECK;
    delete process.env.CONCORD_AUTH_GATE_BUDGET_CHECK;
    const r = await checkResource({ WHAT: "sentinel_sweep", RISK: "read", RESOURCE: {} }, {});
    assert.equal(r.pass, true);
    if (prev) process.env.CONCORD_AUTH_GATE_BUDGET_CHECK = prev;
  });

  it("rollback gate skips when not required", async () => {
    const r = await checkRollback({ WHAT: "sentinel_sweep", RISK: "read", ROLLBACK: null });
    assert.equal(r.pass, true);
  });
});

describe("P7 coding loop", () => {
  it("plans the closed PCE coding loop with an index + verify step", () => {
    // planCodingLoop was moved to the PCE-based closed loop (2026-09-07):
    // repo_graph_index -> pce_execute -> coding_loop_verify.
    const plan = planCodingLoop("refactor mission runtime for better tests");
    assert.equal(plan.ok, true);
    assert.equal(plan.template, "coding_loop_closed");
    assert.equal(plan.planner, "pce");
    assert.ok(plan.steps.some((s) => s.tool === "repo_graph_index"));
    assert.ok(plan.steps.some((s) => s.tool === "coding_loop_verify"));
  });

  it("searchCodingTargets returns matches after index", async () => {
    const db = setupDb();
    const { indexRepo } = await import("../../lib/runtime/repo-graph.js");
    await indexRepo(db);
    const search = await searchCodingTargets(db, { query: "mission" });
    assert.equal(search.ok, true);
  });
});

describe("P7/P8 marathon bridge", () => {
  it("spawns marathon and links to mission", () => {
    const db = setupDb();
    const created = createMission(db, {
      template: "marathon_delegate",
      source: "operator",
      title: "Bridge test",
      goal: "Open-ended refactor",
    });
    assert.equal(created.ok, true);
    const mission = getMission(db, created.missionId);
    const spawn = spawnMarathonForMission(db, mission);
    assert.equal(spawn.ok, true);
    const progress = checkMarathonMissionProgress(db, created.missionId);
    assert.equal(progress.ok, true);
    assert.equal(progress.marathonId, spawn.sessionId);
    const links = listLinkedMarathons(db);
    assert.equal(links.length, 1);
  });
});

describe("mission internal tools — marathon + coding", () => {
  it("ticks marathon_spawn internal step", async () => {
    const db = setupDb();
    const dispatchMCP = mockDispatch();
    const created = createMission(db, {
      source: "operator",
      title: "Spawn test",
      goal: "Test marathon spawn",
      steps: [{ tool: "marathon_spawn", args: {} }],
    });
    const tick = await tickMission({ db, missionId: created.missionId, dispatchMCP });
    assert.equal(tick.ok, true);
    const progress = checkMarathonMissionProgress(db, created.missionId);
    assert.equal(progress.ok, true);
  });

  it("marathon_delegate waits while marathon is still running", async () => {
    const db = setupDb();
    const dispatchMCP = mockDispatch();
    const created = createMission(db, {
      template: "marathon_delegate",
      source: "operator",
      title: "Wait test",
      goal: "Long task",
    });
    await tickMission({ db, missionId: created.missionId, dispatchMCP });
    await tickMission({ db, missionId: created.missionId, dispatchMCP });
    const waitTick = await tickMission({ db, missionId: created.missionId, dispatchMCP });
    assert.equal(waitTick.status, "waiting_marathon");
    const mission = getMission(db, created.missionId);
    assert.equal(mission.status, "running");
    assert.notEqual(mission.status, "completed");
  });

  it("initiative_handoff validates without auto-record by default", async () => {
    const db = setupDb();
    const dispatchMCP = async (tool) => {
      if (tool === "initiative_list") {
        return { ok: true, result: { initiatives: [{ id: "init-1" }] } };
      }
      if (tool === "initiative_validate") {
        return { ok: true, result: { valid: true } };
      }
      return { ok: true, result: { ok: true } };
    };
    const created = createMission(db, {
      source: "operator",
      title: "Handoff test",
      goal: "Record initiative outcomes",
      steps: [{ tool: "initiative_handoff", args: {} }],
    });
    const tick = await tickMission({ db, missionId: created.missionId, dispatchMCP });
    assert.equal(tick.ok, true);
    assert.equal(tick.status, "completed");
  });
});

describe("expanded supervisor + benchmark", () => {
  it("supervisor includes auth_gate and marathon_bridge", async () => {
    const db = setupDb();
    const status = await collectSupervisorStatus({ db, dispatchMCP: mockDispatch() });
    assert.ok(status.subsystems.auth_gate);
    assert.ok(status.subsystems.marathon_bridge);
    assert.ok(status.subsystems.coding_intelligence);
  });

  it("benchmark runs 7 scenarios", async () => {
    const db = setupDb();
    const r = await runBenchmark({ db, dispatchMCP: mockDispatch() });
    assert.equal(r.ok, true);
    assert.equal(r.summary.total, 7);
    assert.equal(r.summary.passed, 7);
  });
});
