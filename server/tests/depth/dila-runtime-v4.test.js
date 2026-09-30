// server/tests/depth/dila-runtime-v4.test.js
//
// Tier 2–3 — causal memory, workspace sensor, parallel decomposition,
// runtime config KV, capability index, mission control plane, capability forge.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upPhases } from "../../migrations/424_runtime_phases.js";
import { up as upTier } from "../../migrations/425_runtime_tier.js";
import { up as upDila } from "../../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../../migrations/427_dila_runtime_v2.js";
import { up as upExec } from "../../migrations/428_dila_executive_closure.js";
import { up as upTier2 } from "../../migrations/429_dila_tier2_brain.js";
import {
  recordCausalChain,
  retrieveRelevantLessons,
  recordMissionStepCausal,
  causalMemoryOverview,
} from "../../lib/runtime/causal-memory.js";
import {
  captureWorkspaceSnapshot,
  detectWorkspaceChanges,
} from "../../lib/runtime/workspace-sensor.js";
import {
  decomposeToParallelSteps,
  mergeParallelResults,
} from "../../lib/runtime/mission-decomposer.js";
import { getConfig, setConfig, applyImprovementPatch } from "../../lib/runtime/runtime-config.js";
import { getMaxRecoveryAttempts } from "../../lib/runtime/recovery.js";
import { computeDilaCapabilityIndex } from "../../lib/runtime/dila-capability-index.js";
import {
  getMissionControlPlane,
  getMissionControlDetail,
} from "../../lib/runtime/mission-control.js";
import {
  registerCapability,
  forgeCapabilityFromNeed,
  listCapabilities,
} from "../../lib/capability-forge/index.js";
import { parseFileAst } from "../../lib/runtime/repo-graph-ast.js";
import { createMission } from "../../lib/mission-runtime.js";

function setupDb() {
  const db = new Database(":memory:");
  upMission(db);
  upPhases(db);
  upTier(db);
  upDila(db);
  upV2(db);
  upExec(db);
  upTier2(db);
  return db;
}

describe("Tier 2 — causal memory", () => {
  it("records and retrieves causal chains with lessons", () => {
    const db = setupDb();
    const r = recordCausalChain(db, {
      missionId: "mis_test",
      event: { kind: "mission_step", tool: "sentinel_sweep" },
      action: { tool: "sentinel_sweep" },
      result: { ok: true },
      lesson: "sentinel_sweep succeeded for fleet audit",
    });
    assert.equal(r.ok, true);
    assert.ok(r.chainId);

    const lessons = retrieveRelevantLessons(db, { tool: "sentinel_sweep", limit: 5 });
    assert.ok(lessons.length >= 1);
    assert.match(lessons[0].lesson, /sentinel_sweep/);

    const overview = causalMemoryOverview(db);
    assert.equal(overview.ok, true);
    assert.ok(overview.total >= 1);
  });

  it("recordMissionStepCausal writes lesson on failure path", () => {
    const db = setupDb();
    const r = recordMissionStepCausal(db, {
      mission: { id: "mis_x", template: "fleet_health", current_step: 1 },
      step: { tool: "concordia_assemble", args: {} },
      gateResult: { result: { ok: false, reason: "timeout" } },
      executionOutcome: "FAILED",
      critic: { verdict: "reject", progression: "recover", recommendation: "retry" },
      recovery: { recoveryAction: "retry_same" },
    });
    assert.equal(r.ok, true);
    const lessons = retrieveRelevantLessons(db, { tool: "concordia_assemble" });
    assert.ok(lessons.some((l) => /retry_same/.test(l.lesson || "")));
  });
});

describe("Tier 2 — workspace sensor", () => {
  it("captures snapshot and detects file changes", async () => {
    const db = setupDb();
    const dir = join(tmpdir(), `concord-ws-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "probe.txt");
    writeFileSync(f, "v1");

    const snap1 = await captureWorkspaceSnapshot(db, {
      missionId: "mis_ws",
      repoRoot: dir,
      watchPaths: ["probe.txt"],
    });
    assert.equal(snap1.ok, true);
    assert.equal(snap1.persisted, true);

    writeFileSync(f, "v2");
    const delta = await detectWorkspaceChanges(db, {
      missionId: "mis_ws",
      repoRoot: dir,
      watchPaths: ["probe.txt"],
    });
    assert.equal(delta.ok, true);
    assert.equal(delta.changed, true);
    assert.ok(delta.changes.fileChanges.length >= 1);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Tier 2 — parallel decomposition", () => {
  it("decomposes comprehensive fleet goal into parallel_batch", () => {
    const plan = decomposeToParallelSteps(
      "Full comprehensive system fleet audit with parallel checks",
      { executionMode: "parallel" },
    );
    assert.equal(plan.ok, true);
    assert.equal(plan.executionMode, "parallel");
    assert.ok(plan.steps.some((s) => s.tool === "parallel_batch"));
    const batch = plan.steps.find((s) => s.tool === "parallel_batch");
    assert.ok(Array.isArray(batch.args.tasks));
    assert.ok(batch.args.tasks.length >= 2);
  });

  it("createMission accepts decomposeParallel goal", () => {
    const db = setupDb();
    const c = createMission(db, {
      goal: "Full comprehensive system fleet audit with parallel research and code",
      source: "operator",
      decomposeParallel: true,
    });
    assert.equal(c.ok, true);
    const row = db.prepare(`SELECT steps_json, execution_mode FROM mission_tasks WHERE id = ?`).get(c.missionId);
    const steps = JSON.parse(row.steps_json);
    assert.ok(steps.some((s) => s.tool === "parallel_batch"));
    assert.equal(row.execution_mode, "parallel");
  });

  it("mergeParallelResults summarizes batch outcomes", () => {
    const merged = mergeParallelResults({
      results: [{ ok: true }, { ok: false }, { ok: true }],
    });
    assert.equal(merged.completed, 2);
    assert.equal(merged.failed, 1);
    assert.equal(merged.partial, true);
  });
});

describe("Tier 2 — runtime config + recovery", () => {
  it("stores config KV and recovery reads promoted max attempts", () => {
    const db = setupDb();
    setConfig(db, "recovery.max_attempts", { value: 5, reason: "test" });
    assert.deepEqual(getConfig(db, "recovery.max_attempts"), { value: 5, reason: "test" });
    assert.equal(getMaxRecoveryAttempts(db), 5);

    const applied = applyImprovementPatch(db, "imp_test", {
      "critic.require_evidence": { value: true },
    });
    assert.equal(applied.ok, true);
    assert.ok(applied.applied.includes("critic.require_evidence"));
  });
});

describe("Tier 2 — capability index + mission control", () => {
  it("computes 20-dimension capability index", () => {
    const db = setupDb();
    createMission(db, { template: "fleet_health", source: "operator" });
    const idx = computeDilaCapabilityIndex(db);
    assert.equal(idx.ok, true);
    assert.equal(idx.dimensionCount, 20);
    assert.ok(idx.overall > 0);
    assert.ok(idx.dimensions.mission_ownership > 0);
  });

  it("mission control plane returns aggregate + detail", () => {
    const db = setupDb();
    const c = createMission(db, { template: "fleet_health", source: "operator", title: "Fleet probe" });
    const plane = getMissionControlPlane(db);
    assert.equal(plane.ok, true);
    assert.ok(plane.capabilityIndex?.overall > 0);
    assert.ok(plane.missions);

    const detail = getMissionControlDetail(db, c.missionId);
    assert.equal(detail.ok, true);
    assert.equal(detail.mission.id, c.missionId);
    assert.ok(detail.why?.goal);
  });
});

describe("Tier 2 — capability forge + AST", () => {
  it("registers and lists forged capabilities", () => {
    const db = setupDb();
    const forged = forgeCapabilityFromNeed(db, {
      need: "SWE-bench patch verification",
      tools: ["coding_loop_verify", "repo_graph_index"],
      domainPack: "coding",
    });
    assert.equal(forged.ok, true);
    const caps = listCapabilities(db);
    assert.ok(caps.some((c) => c.capability_id === forged.capabilityId));

    const reg = registerCapability(db, {
      capabilityId: "cap_test_manual",
      name: "Manual test cap",
      tools: ["sentinel_sweep"],
    });
    assert.equal(reg.ok, true);
  });

  it("parseFileAst extracts functions and calls", () => {
    const src = `export function hello() { world(); }\nclass Foo {}\n`;
    const ast = parseFileAst("test.js", src);
    assert.equal(ast.parseError, false);
    assert.ok(ast.symbols.some((s) => s.name === "hello"));
    assert.ok(ast.calls.some((c) => c.name === "world"));
  });
});
