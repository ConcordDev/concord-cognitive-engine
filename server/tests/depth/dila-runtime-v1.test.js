// server/tests/depth/dila-runtime-v1.test.js
//
// Dila runtime v1 — principal, supervisor tree, model router, agent loop,
// critic, recovery, DilaBench, workspace audit.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upPhases } from "../../migrations/424_runtime_phases.js";
import { up as upTier } from "../../migrations/425_runtime_tier.js";
import { up as upDila } from "../../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../../migrations/427_dila_runtime_v2.js";
import { up as upMarathon } from "../../migrations/171_agent_marathon_sessions.js";
import { createDilaMission, kickoffDilaMission } from "../../lib/dila-mission.js";
import { routeModel, recordRoutingOutcome, routingStats } from "../../lib/runtime/model-router.js";
import { buildSupervisorTree, syncWorkersIntoTree } from "../../lib/runtime/supervisor-tree.js";
import { syncOrgFromRoster, pickWorkerForTask, recordWorkerOutcome } from "../../lib/runtime/agent-org.js";
import { runAgentLoopPhase, loadLatestCheckpoint } from "../../lib/runtime/agent-loop.js";
import { critiqueResult } from "../../lib/runtime/critic.js";
import { buildWorldModelSnapshot } from "../../lib/runtime/world-model.js";
import { attemptRecovery, recoveryOverview } from "../../lib/runtime/recovery.js";
import { runBenchmark } from "../../lib/runtime/dila-bench.js";
import { runWorkspaceAudit } from "../../lib/runtime/workspace-audit.js";
import { kickstartLinkedMarathon } from "../../lib/mission-marathon-bridge.js";
import { startMarathon } from "../../lib/agent-marathon.js";
import { getMission } from "../../lib/mission-runtime.js";

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

describe("Dila mission principal", () => {
  it("createDilaMission binds owner_agent_id=hermes", () => {
    const db = setupDb();
    const r = createDilaMission(db, { template: "fleet_health", goal: "audit infrastructure" });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT owner_agent_id, user_id FROM mission_tasks WHERE id = ?`).get(r.missionId);
    assert.equal(row.owner_agent_id, "hermes");
    assert.equal(row.user_id, "hermes");
  });

  it("kickoffDilaMission runs agent loop phases", async () => {
    const db = setupDb();
    const r = await kickoffDilaMission({
      db,
      goal: "research opportunities and verify fleet health",
      dispatchMCP: mockDispatch(),
      opts: { loopPhases: 3 },
    });
    assert.equal(r.ok, true);
    assert.ok(r.loop?.phases >= 1);
    const cp = loadLatestCheckpoint(db, r.missionId);
    assert.ok(cp?.state);
  });
});

describe("Model router", () => {
  it("routes coding tasks to coding class", async () => {
    const db = setupDb();
    const r = await routeModel({ db, goal: "refactor mission runtime migration" });
    assert.equal(r.ok, true);
    assert.equal(r.taskClass, "coding");
    assert.ok(r.workerId);
  });

  it("records and reports routing outcomes", async () => {
    const db = setupDb();
    recordRoutingOutcome(db, {
      taskClass: "coding",
      provider: "ollama",
      model: "utility",
      workerId: "wr-mistral-2",
      success: true,
      latencyMs: 120,
    });
    const stats = routingStats(db, "coding");
    assert.equal(stats.ok, true);
    assert.equal(stats.stats.length, 1);
  });
});

describe("Supervisor tree + org", () => {
  it("seeds hierarchical supervisor tree", () => {
    const db = setupDb();
    const tree = buildSupervisorTree(db);
    assert.equal(tree.ok, true);
    assert.ok(tree.nodeCount >= 8);
    assert.equal(tree.roots[0]?.id, "dila");
  });

  it("syncs org workers from roster or degrades gracefully", async () => {
    const db = setupDb();
    const r = await syncOrgFromRoster(db);
    assert.ok(r.ok === true || r.reason === "roster_unavailable");
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO runtime_org_workers (worker_id, director, specialization, reliability_score, updated_at)
      VALUES ('wr-mistral-2', 'engineering', 'coding', 0.95, ?)
      ON CONFLICT(worker_id) DO UPDATE SET reliability_score = 0.95, updated_at = excluded.updated_at
    `).run(now);
    recordWorkerOutcome(db, "wr-mistral-2", { success: true, missionId: "mis_test" });
    const picked = pickWorkerForTask(db, { director: "engineering", specialization: "coding" });
    assert.equal(picked, "wr-mistral-2");
  });
});

describe("Agent loop + critic + recovery", () => {
  it("critic rejects misleading pass", () => {
    const c = critiqueResult({
      objective: "migrate schema across repo",
      result: { ok: true },
      testsPassed: false,
      intentVerified: false,
    });
    assert.equal(c.verdict, "reject");
  });

  it("world model snapshot builds", async () => {
    const db = setupDb();
    const wm = await buildWorldModelSnapshot({ db, dispatchMCP: mockDispatch() });
    assert.equal(wm.ok, true);
    assert.ok(wm.snapshot.repo);
  });

  it("recovery records infrastructure failure", async () => {
    const db = setupDb();
    const created = createDilaMission(db, { template: "fleet_health" });
    const mission = getMission(db, created.missionId);
    const r = await attemptRecovery({
      db,
      mission,
      failure: { gateResult: { reason: "migration_required" }, tool: "test" },
      loadCheckpoint: loadLatestCheckpoint,
    });
    assert.equal(r.ok, true);
    const overview = recoveryOverview(db);
    assert.equal(overview.ok, true);
    assert.ok(overview.stats.total >= 1);
  });
});

describe("Marathon kickstart", () => {
  it("kickstartLinkedMarathon moves pending to running", () => {
    const db = setupDb();
    const s = startMarathon(db, "hermes", { goal: "long task" });
    assert.equal(s.ok, true);
    const before = db.prepare(`SELECT status FROM agent_marathon_sessions WHERE id = ?`).get(s.sessionId);
    assert.equal(before.status, "pending");
    kickstartLinkedMarathon(db, s.sessionId);
    const after = db.prepare(`SELECT status FROM agent_marathon_sessions WHERE id = ?`).get(s.sessionId);
    assert.equal(after.status, "running");
  });
});

describe("DilaBench extended", () => {
  it("runs dila_full suite", async () => {
    const db = setupDb();
    const r = await runBenchmark({ db, dispatchMCP: mockDispatch(), suite: "dila_full" });
    assert.equal(r.ok, true);
    assert.ok(r.summary.total >= 10);
  });
});

describe("Workspace audit", () => {
  it("audits env key names without printing values", async () => {
    const db = setupDb();
    const r = await runWorkspaceAudit({ db });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.summary.envKeyNames));
    assert.ok(Array.isArray(r.summary.dataSources));
    assert.ok(r.summary.connectors.length >= 0);
  });
});
