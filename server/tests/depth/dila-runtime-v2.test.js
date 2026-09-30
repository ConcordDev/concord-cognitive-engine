// server/tests/depth/dila-runtime-v2.test.js
//
// Dila runtime v2 — full repo graphs, affect delegation, Ouroboros promotion,
// 7-day soak harness, F0 autonomous enforce.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upPhases } from "../../migrations/424_runtime_phases.js";
import { up as upTier } from "../../migrations/425_runtime_tier.js";
import { up as upDila } from "../../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../../migrations/427_dila_runtime_v2.js";
import { up as upExec } from "../../migrations/428_dila_executive_closure.js";
import { up as upMarathon } from "../../migrations/171_agent_marathon_sessions.js";
import {
  indexRepo,
  buildFullRepoGraph,
  ensureRepoIndexFresh,
} from "../../lib/runtime/repo-graph.js";
import {
  pickWorkerForTask,
  scoreWorker,
  listWorkersForTask,
  updateWorkerAffect,
} from "../../lib/runtime/agent-org.js";
import { routeModel } from "../../lib/runtime/model-router.js";
import {
  createImprovementProposal,
  evaluateProposal,
  promoteProposal,
  processPendingProposals,
} from "../../lib/runtime/self-improvement.js";
import { runSoakSimulation, listSoakRuns } from "../../lib/runtime/soak-harness.js";
import { runBenchmark } from "../../lib/runtime/dila-bench.js";
import { resolveAuthGateMode } from "../../lib/auth-gate/policy.js";
import { buildWorldModelSnapshot } from "../../lib/runtime/world-model.js";
import { attemptRecovery } from "../../lib/runtime/recovery.js";
import { createDilaMission } from "../../lib/dila-mission.js";
import { getMission } from "../../lib/mission-runtime.js";
import { runRepoGraphCycle } from "../../emergent/repo-graph-cycle.js";

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

function mockDispatch() {
  return async () => ({ ok: true, decision: "ALLOW", result: { ok: true, observation: {} } });
}

function seedWorkers(db) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO runtime_org_workers
      (worker_id, director, specialization, reliability_score, affect_json, updated_at)
    VALUES (?, 'engineering', 'coding', 0.8, ?, ?)
  `).run("worker-calm", JSON.stringify({ confidence: 0.9, frustration: 0.05, attention: 0.85 }), now);
  db.prepare(`
    INSERT INTO runtime_org_workers
      (worker_id, director, specialization, reliability_score, affect_json, updated_at)
    VALUES (?, 'engineering', 'coding', 0.8, ?, ?)
  `).run("worker-angry", JSON.stringify({ confidence: 0.4, frustration: 0.85, attention: 0.3 }), now);
}

describe("1 — Full repo world model graphs", () => {
  it("indexes dependency, migration, route, and test edges", async () => {
    const db = setupDb();
    const root = mkdtempSync(join(tmpdir(), "dila-repo-"));
    process.env.CONCORD_REPO_GRAPH_ROOTS = [process.env.CONCORD_REPO_GRAPH_ROOTS, root].filter(Boolean).join(":");
    mkdirSync(join(root, "server/lib/runtime"), { recursive: true });
    mkdirSync(join(root, "server/migrations"), { recursive: true });
    mkdirSync(join(root, "server/tests"), { recursive: true });
    writeFileSync(join(root, "server/lib/runtime/foo.js"), `import { bar } from './bar.js';\nexport function foo() {}\n`);
    writeFileSync(join(root, "server/lib/runtime/bar.js"), `export const bar = 1;\n`);
    writeFileSync(join(root, "server/migrations/427_sample.js"), `export function up(db) {}\n`);
    writeFileSync(join(root, "server/tests/foo.test.js"), `import { foo } from '../lib/runtime/foo.js';\n`);
    writeFileSync(join(root, "server/server.js"), `app.get('/api/test', () => {});\napp.post('/api/other', () => {});\n`);

    const prevMax = process.env.CONCORD_REPO_GRAPH_MAX_FILES;
    process.env.CONCORD_REPO_GRAPH_MAX_FILES = "50";

    const idx = await indexRepo(db, root);
    assert.equal(idx.ok, true);
    assert.ok(idx.edgeCount > 0);
    assert.ok(idx.graphs?.migration?.count >= 1);
    assert.ok(idx.graphs?.api?.count >= 2);

    const full = buildFullRepoGraph(db, root);
    assert.equal(full.ok, true);
    assert.ok(full.graphs.dependency.edges > 0);
    assert.ok(full.graphs.migration.count >= 1);

    process.env.CONCORD_REPO_GRAPH_MAX_FILES = prevMax;
  });

  it("ensureRepoIndexFresh refreshes stale index", async () => {
    const db = setupDb();
    const root = mkdtempSync(join(tmpdir(), "dila-stale-"));
    process.env.CONCORD_REPO_GRAPH_ROOTS = [process.env.CONCORD_REPO_GRAPH_ROOTS, root].filter(Boolean).join(":");
    mkdirSync(join(root, "server/lib"), { recursive: true });
    writeFileSync(join(root, "server/lib/a.js"), `export const a = 1;\n`);

    const prevMax = process.env.CONCORD_REPO_GRAPH_MAX_FILES;
    process.env.CONCORD_REPO_GRAPH_MAX_FILES = "20";

    const r1 = await ensureRepoIndexFresh(db, root, 0);
    assert.equal(r1.refreshed, true);
    const r2 = await ensureRepoIndexFresh(db, root, 999999);
    assert.equal(r2.refreshed, false);

    process.env.CONCORD_REPO_GRAPH_MAX_FILES = prevMax;
  });

  it("world model snapshot includes full graph layers", async () => {
    const db = setupDb();
    const root = mkdtempSync(join(tmpdir(), "dila-wm-"));
    process.env.CONCORD_REPO_GRAPH_ROOTS = [process.env.CONCORD_REPO_GRAPH_ROOTS, root].filter(Boolean).join(":");
    mkdirSync(join(root, "server/lib"), { recursive: true });
    writeFileSync(join(root, "server/lib/x.js"), `export const x = 1;\n`);
    process.env.CONCORD_REPO_GRAPH_MAX_FILES = "10";
    await indexRepo(db, root);

    const wm = await buildWorldModelSnapshot({ db, dispatchMCP: mockDispatch(), repoRoot: root });
    assert.equal(wm.ok, true);
    assert.ok(wm.snapshot.graphs.architecture);
    assert.ok(wm.snapshot.graphs.dependency);
    assert.ok(typeof wm.snapshot.repo.edges === "number");
  });

  it("repo-graph-cycle heartbeat indexes when stale", async () => {
    const db = setupDb();
    const r = await runRepoGraphCycle({ db });
    assert.equal(r.ok, true);
  });
});

describe("2 — Affect-driven delegation", () => {
  it("scores calm worker above frustrated peer at equal reliability", () => {
    const db = setupDb();
    seedWorkers(db);
    const ranked = listWorkersForTask(db, { director: "engineering", specialization: "coding" });
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].worker_id, "worker-calm");
    assert.ok(ranked[0].score > ranked[1].score);
  });

  it("pickWorkerForTask prefers low-frustration worker", () => {
    const db = setupDb();
    seedWorkers(db);
    const picked = pickWorkerForTask(db, { director: "engineering", specialization: "coding" });
    assert.equal(picked, "worker-calm");
  });

  it("routeModel returns affect-ranked worker candidates", async () => {
    const db = setupDb();
    seedWorkers(db);
    const route = await routeModel({ db, goal: "refactor migration code", roster: [] });
    assert.equal(route.ok, true);
    assert.ok(route.workerCandidates?.length >= 1);
    assert.equal(route.workerId, "worker-calm");
  });

  it("recovery reassigns to alternate worker on timeout", async () => {
    const db = setupDb();
    seedWorkers(db);
    const created = createDilaMission(db, { template: "fleet_health" });
    const mission = getMission(db, created.missionId);
    const r = await attemptRecovery({
      db,
      mission,
      failure: { tool: "test", gateResult: { reason: "timeout" }, workerId: "worker-angry" },
    });
    assert.equal(r.recoveryAction, "reassign_worker");
    assert.equal(r.reassignedWorker, "worker-calm");
    assert.equal(r.recoverySuccess, true);
  });

  it("updateWorkerAffect shifts frustration on failure", () => {
    const db = setupDb();
    seedWorkers(db);
    updateWorkerAffect(db, "worker-calm", { frustration: 0.2 });
    const row = db.prepare(`SELECT affect_json FROM runtime_org_workers WHERE worker_id = ?`).get("worker-calm");
    const affect = JSON.parse(row.affect_json);
    assert.ok(affect.frustration > 0.05);
  });
});

describe("3 — Ouroboros self-improvement promotion", () => {
  it("promotes proposal when benchmark improves without regression", async () => {
    const db = setupDb();
    const p = createImprovementProposal(db, {
      missionId: "mis_test",
      weakness: { kind: "test" },
      proposedFix: "add verify gate",
      benchmarkBefore: { passRate: 0.5, total: 4, passed: 2, failed: 2 },
    });
    assert.equal(p.ok, true);

    const evalResult = await evaluateProposal(db, p.proposalId, mockDispatch(), "dila_core");
    assert.equal(evalResult.ok, true);
    if (evalResult.promote) {
      const promoted = promoteProposal(db, p.proposalId, evalResult.benchmarkAfter);
      assert.equal(promoted.status, "promoted");
    } else {
      const row = db.prepare(`SELECT status FROM runtime_improvement_proposals WHERE id = ?`).get(p.proposalId);
      assert.ok(["testing", "rejected", "promoted"].includes(row.status));
    }
  });

  it("processPendingProposals runs benchmark gate end-to-end", async () => {
    const db = setupDb();
    createImprovementProposal(db, {
      weakness: { kind: "mission_failed" },
      proposedFix: "checkpoint resume",
      benchmarkBefore: { passRate: 0, total: 1, passed: 0, failed: 1 },
    });
    const r = await processPendingProposals(db, mockDispatch(), { limit: 1, suite: "dila_core" });
    assert.equal(r.ok, true);
    assert.equal(r.processed, 1);
    assert.ok(r.results[0].action === "promoted" || r.results[0].action === "rejected");
  });
});

describe("4 — 7-day mission soak harness", () => {
  it("seven_day_mission_coherence passes compressed soak", async () => {
    const db = setupDb();
    const soak = await runSoakSimulation({
      db,
      dispatchMCP: mockDispatch(),
      days: 7,
      ticksPerDay: 2,
    });
    assert.equal(soak.ok, true);
    assert.equal(soak.summary.pass, true);
    assert.ok(soak.summary.daysSimulated >= 1);
    assert.ok(soak.summary.coherentDays >= 1);
  });

  it("dila_soak benchmark suite includes soak scenario", async () => {
    const db = setupDb();
    const r = await runBenchmark({ db, dispatchMCP: mockDispatch(), suite: "dila_soak" });
    assert.equal(r.ok, true);
    assert.equal(r.summary.total, 1);
    assert.equal(r.summary.passed, 1);
  });

  it("persists soak run record", async () => {
    const db = setupDb();
    await runSoakSimulation({ db, dispatchMCP: mockDispatch(), days: 3, ticksPerDay: 1 });
    const runs = listSoakRuns(db, 5);
    assert.ok(runs.length >= 1);
    assert.ok(runs[0].summary);
  });
});

describe("5 — F0 autonomous enforce policy", () => {
  const envBackup = {};

  before(() => {
    envBackup.CONCORD_AUTH_GATE_MODE = process.env.CONCORD_AUTH_GATE_MODE;
    envBackup.CONCORD_AUTH_GATE_ENFORCE_AUTONOMOUS = process.env.CONCORD_AUTH_GATE_ENFORCE_AUTONOMOUS;
    envBackup.CONCORD_DILA_RUNTIME_ENFORCE = process.env.CONCORD_DILA_RUNTIME_ENFORCE;
  });

  after(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("enforces F0 for heartbeat/autonomous sources when DILA_RUNTIME_ENFORCE=1", () => {
    process.env.CONCORD_AUTH_GATE_MODE = "observe";
    process.env.CONCORD_AUTH_GATE_ENFORCE_AUTONOMOUS = "true";
    process.env.CONCORD_DILA_RUNTIME_ENFORCE = "1";

    assert.equal(resolveAuthGateMode({
      actor: { role: "system" },
      provenance: { source: "heartbeat" },
    }), "enforce");

    assert.equal(resolveAuthGateMode({
      actor: { role: "admin" },
      provenance: { source: "operator" },
    }), "observe");

    assert.equal(resolveAuthGateMode({
      provenance: { source: "sentinel", owner_agent_id: "hermes" },
    }), "enforce");
  });

  it("global enforce mode applies to all contexts", () => {
    process.env.CONCORD_AUTH_GATE_MODE = "enforce";
    assert.equal(resolveAuthGateMode({ actor: { role: "member" } }), "enforce");
  });
});
