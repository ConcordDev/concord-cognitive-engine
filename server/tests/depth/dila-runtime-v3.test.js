// server/tests/depth/dila-runtime-v3.test.js
//
// Tier 1 — Executive closure: worker roster, executive tick, critic control,
// recovery retry, execution ledger, heartbeat integration.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upPhases } from "../../migrations/424_runtime_phases.js";
import { up as upTier } from "../../migrations/425_runtime_tier.js";
import { up as upDila } from "../../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../../migrations/427_dila_runtime_v2.js";
import { up as upExec } from "../../migrations/428_dila_executive_closure.js";
import { up as upMarathon } from "../../migrations/171_agent_marathon_sessions.js";
import { getWorkerRoster, listDilaWorkers } from "../../lib/dila-workers.js";
import { syncOrgFromRoster } from "../../lib/runtime/agent-org.js";
import {
  classifyExecutionResult,
  runCriticPass,
} from "../../lib/runtime/critic.js";
import {
  loadLedger,
  saveLedger,
  recordLedgerEvent,
  failureSignature,
} from "../../lib/runtime/execution-ledger.js";
import { assembleExecutiveContext } from "../../lib/runtime/context-assembler.js";
import {
  prepareExecutiveStep,
  evaluateExecutiveStep,
} from "../../lib/runtime/executive-tick.js";
import {
  attemptRecovery,
  applyMissionRecovery,
  planRecoveryAction,
} from "../../lib/runtime/recovery.js";
import { createMission, tickMission, getMission } from "../../lib/mission-runtime.js";
import { runMissionRuntimeCycle } from "../../emergent/mission-runtime-cycle.js";

function setupDb() {
  const db = new Database(":memory:");
  upMission(db);
  upPhases(db);
  upTier(db);
  upMarathon(db);
  upDila(db);
  upV2(db);
  upExec(db);
  return db;
}

function mockDispatch(results = {}) {
  const calls = [];
  const dispatchMCP = async (tool, args, ctx) => {
    calls.push({ tool, args, ctx });
    if (results[tool]) return results[tool];
    return { ok: true, decision: "ALLOW", result: { ok: true, observation: { tool } } };
  };
  return { dispatchMCP, calls };
}

describe("Tier 1 — getWorkerRoster fix", () => {
  it("exports getWorkerRoster as array with name/alive", async () => {
    const roster = await getWorkerRoster({ limit: 5 });
    assert.ok(Array.isArray(roster));
    if (roster.length) {
      assert.ok(roster[0].name);
      assert.ok("alive" in roster[0]);
    }
    const listed = await listDilaWorkers({ limit: 5 });
    assert.equal(listed.ok, true);
    assert.ok(listed.workers.length >= roster.length);
  });

  it("syncOrgFromRoster succeeds with getWorkerRoster", async () => {
    const db = setupDb();
    const sync = await syncOrgFromRoster(db);
    assert.equal(sync.ok, true);
    assert.ok(sync.synced > 0);
    const count = db.prepare(`SELECT COUNT(*) AS c FROM runtime_org_workers`).get();
    assert.ok(count.c > 0);
  });
});

describe("Tier 1 — execution ledger", () => {
  it("records observed/attempted/verified per step", () => {
    const db = setupDb();
    let ledger = loadLedger(db, "mis_test", 0);
    ledger = recordLedgerEvent(ledger, "attempted", { tool: "sentinel_sweep" });
    ledger = recordLedgerEvent(ledger, "verified", { ok: true });
    saveLedger(db, "mis_test", 0, ledger, { tickCount: 1 });
    const loaded = loadLedger(db, "mis_test", 0);
    assert.equal(loaded.attempted.length, 1);
    assert.equal(loaded.verified.length, 1);
    assert.ok(failureSignature({ tool: "x", reason: "y" }).length === 24);
  });
});

describe("Tier 1 — critic controls progression", () => {
  it("classifies SUCCESS vs FAILED vs PARTIAL", () => {
    assert.equal(classifyExecutionResult({ stepOk: true, gateResult: { result: { ok: true } } }), "SUCCESS");
    assert.equal(classifyExecutionResult({ stepOk: false, gateResult: { result: { reason: "down" } } }), "FAILED");
    assert.equal(classifyExecutionResult({ stepOk: true, gateResult: { result: { partial: true } } }), "PARTIAL");
  });

  it("reject progression on FAILED outcome", async () => {
    const db = setupDb();
    const critic = await runCriticPass({
      db,
      mission: { goal: "verify fleet", trace_id: "t1" },
      stepResult: { ok: false, reason: "organ_down" },
      executionOutcome: "FAILED",
    });
    assert.equal(critic.verdict, "reject");
    assert.equal(critic.progression, "recover");
  });
});

describe("Tier 1 — recovery actually retries", () => {
  it("applyMissionRecovery resets mission to running", () => {
    const db = setupDb();
    const c = createMission(db, { template: "fleet_health", source: "operator" });
    db.prepare(`UPDATE mission_tasks SET status = 'failed', recovery_attempts = 0 WHERE id = ?`).run(c.missionId);
    const applied = applyMissionRecovery(db, c.missionId, {
      reassignedWorker: "wr-grok-code",
      recoveryAction: "retry_same",
    });
    assert.equal(applied.ok, true);
    const m = db.prepare(`SELECT status, recovery_attempts, assigned_worker_id FROM mission_tasks WHERE id = ?`).get(c.missionId);
    assert.equal(m.status, "running");
    assert.equal(m.recovery_attempts, 1);
    assert.equal(m.assigned_worker_id, "wr-grok-code");
  });

  it("escalation ladder progresses by attempt", async () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO runtime_org_workers (worker_id, director, specialization, reliability_score, updated_at)
      VALUES ('worker-a', 'engineering', 'coding', 0.9, ?),
             ('worker-b', 'engineering', 'coding', 0.85, ?)
    `).run(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));

    const plan0 = await planRecoveryAction({ db, mission: { recovery_attempts: 0 }, diagnosis: { kind: "execution" } });
    assert.equal(plan0.recoveryAction, "retry_same");

    const plan1 = await planRecoveryAction({
      db,
      mission: { recovery_attempts: 1, goal: "fix code", template: "coding_loop" },
      diagnosis: { kind: "timeout" },
      failedWorker: "worker-a",
      attempt: 1,
    });
    assert.equal(plan1.recoveryAction, "reassign_worker");
    assert.equal(plan1.reassignedWorker, "worker-b");
  });
});

describe("Tier 1 — executive tick in mission path", () => {
  it("tickMission routes, criticizes, and completes fleet_health", async () => {
    const db = setupDb();
    const { dispatchMCP } = mockDispatch();
    const created = createMission(db, { template: "fleet_health", source: "scheduled" });
    let last;
    for (let i = 0; i < 6; i++) {
      last = await tickMission({ db, missionId: created.missionId, dispatchMCP });
      if (last.status === "completed") break;
    }
    assert.equal(last.status, "completed");
    const m = getMission(db, created.missionId);
    assert.equal(m.status, "completed");
    const ledgerRows = db.prepare(`SELECT COUNT(*) AS c FROM runtime_execution_ledger WHERE mission_id = ?`).get(created.missionId);
    assert.ok(ledgerRows.c >= 4);
  });

  it("tickMission recovers on transient failure then completes", async () => {
    const db = setupDb();
    let callCount = 0;
    const dispatchMCP = async (tool) => {
      if (tool === "concordia_assemble") {
        callCount++;
        if (callCount === 1) {
          return { ok: true, decision: "ALLOW", result: { ok: false, reason: "timeout" } };
        }
      }
      return { ok: true, decision: "ALLOW", result: { ok: true, observation: { tool } } };
    };
    const created = createMission(db, { template: "fleet_health", source: "operator" });
    const r1 = await tickMission({ db, missionId: created.missionId, dispatchMCP });
    assert.equal(r1.status, "recovering");
    assert.ok(r1.recoveryAction);

    let last = r1;
    for (let i = 0; i < 8; i++) {
      last = await tickMission({ db, missionId: created.missionId, dispatchMCP });
      if (last.status === "completed") break;
    }
    assert.equal(last.status, "completed");
  });

  it("prepareExecutiveStep persists route and context", async () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO runtime_org_workers (worker_id, director, specialization, reliability_score, updated_at)
      VALUES ('wr-grok-code', 'engineering', 'coding', 0.9, ?)
    `).run(Math.floor(Date.now() / 1000));
    const c = createMission(db, { template: "coding_loop", source: "operator" });
    const mission = db.prepare(`SELECT * FROM mission_tasks WHERE id = ?`).get(c.missionId);
    const step = { tool: "repo_graph_index", args: {} };
    const { dispatchMCP } = mockDispatch();
    const prep = await prepareExecutiveStep({ db, mission, step, stepIndex: 0, dispatchMCP });
    assert.ok(prep.route?.taskClass);
    assert.ok(prep.context?.context?.missionId);
    const ctx = await assembleExecutiveContext({
      db, mission, step, stepIndex: 0, route: prep.route, ledger: prep.ledger, dispatchMCP,
    });
    assert.equal(ctx.ok, true);
    assert.equal(ctx.context.stepTool, "repo_graph_index");
  });
});

describe("Tier 1 — heartbeat integration", () => {
  const prevRecovery = process.env.CONCORD_MISSION_RECOVERY;

  after(() => {
    if (prevRecovery === undefined) delete process.env.CONCORD_MISSION_RECOVERY;
    else process.env.CONCORD_MISSION_RECOVERY = prevRecovery;
  });

  it("runMissionRuntimeCycle spawns, syncs org, and ticks", async () => {
    const db = setupDb();
    process.env.CONCORD_MISSION_RECOVERY = "0";
    db.prepare(`UPDATE mission_runtime_state SET fleet_cycle_counter = 19 WHERE id = 1`).run();

    const calls = [];
    const dispatchMCP = async (tool, args, ctx) => {
      calls.push(tool);
      if (tool === "sentinel_sweep") {
        return { ok: true, result: { observation: { alert_level: "none" } } };
      }
      if (tool === "proactive_list_predictions") {
        return { ok: true, result: { observation: { predictions: [] } } };
      }
      if (tool === "initiative_list") {
        return { ok: true, result: { observation: { initiatives: [] } } };
      }
      return { ok: true, decision: "ALLOW", result: { ok: true, observation: { tool } } };
    };

    globalThis._concordDB = db;
    const cycle = await runMissionRuntimeCycle({ db });
    assert.equal(cycle.ok, true);
    assert.ok(cycle.spawned >= 1);
    assert.equal(cycle.orgSync?.ok, true);
    assert.ok(cycle.orgSync?.synced > 0);
    assert.ok(cycle.ticked >= 0);
    delete globalThis._concordDB;
  });
});
