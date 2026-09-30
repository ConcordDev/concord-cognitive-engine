// server/tests/depth/dila-runtime-v5.test.js
//
// Waves A–D — coding closure, SWE harness, worker adapters, priority queue,
// deployment profiles, capability promotion, observation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upPhases } from "../../migrations/424_runtime_phases.js";
import { up as upTier } from "../../migrations/425_runtime_tier.js";
import { up as upDila } from "../../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../../migrations/427_dila_runtime_v2.js";
import { up as upExec } from "../../migrations/428_dila_executive_closure.js";
import { up as upTier2 } from "../../migrations/429_dila_tier2_brain.js";
import { up as upWaves } from "../../migrations/430_dila_waves_abcd.js";
import { applySearchReplacePatch, runClosedCodingLoop } from "../../lib/runtime/coding-loop-closure.js";
import { runSweHarness, SWE_MINI_CASES } from "../../lib/runtime/swe-harness.js";
import { isWorkerAllowed, filterAllowedWorkers } from "../../lib/runtime/worker-adapters.js";
import { scoreCandidate, rankSpawnCandidates } from "../../lib/runtime/mission-priority.js";
import { applyDeploymentProfile, profileSummary } from "../../lib/runtime/deployment-profiles.js";
import { gatherObservationSnapshot } from "../../lib/runtime/continuous-observation.js";
import { promoteForgedCapability } from "../../lib/runtime/capability-promotion.js";
import { registerCapability } from "../../lib/capability-forge/index.js";
import { pickPackForSignal } from "../../lib/runtime/domain-packs.js";
import { resolveAuthGateMode } from "../../lib/auth-gate/policy.js";
import { getConfig } from "../../lib/runtime/runtime-config.js";

function setupDb() {
  const db = new Database(":memory:");
  upMission(db);
  upPhases(db);
  upTier(db);
  upDila(db);
  upV2(db);
  upExec(db);
  upTier2(db);
  upWaves(db);
  return db;
}

describe("Wave A — coding closure + SWE + workers", () => {
  it("applySearchReplacePatch edits within repo bounds", async () => {
    const dir = join(tmpdir(), `concord-patch-${Date.now()}`);
    mkdirSync(join(dir, "lib"), { recursive: true });
    const f = join(dir, "lib", "x.js");
    writeFileSync(f, "export const v = 1;\n");
    const r = await applySearchReplacePatch({
      repoRoot: dir,
      filePath: "lib/x.js",
      search: "export const v = 1;",
      replace: "export const v = 2;",
    });
    assert.equal(r.ok, true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("runSweHarness passes all mini cases", async () => {
    const db = setupDb();
    const r = await runSweHarness({ db });
    assert.equal(r.ok, true, JSON.stringify(r.results?.map((x) => ({ id: x.caseId, ok: x.ok }))));
    assert.equal(r.passed, SWE_MINI_CASES.length);
  });

  it("worker allowlist blocks cc-* and allows groq/mistral", () => {
    assert.equal(isWorkerAllowed("cc-haiku"), false);
    assert.equal(isWorkerAllowed("wr-groq-1"), true);
    assert.equal(isWorkerAllowed("wr-mistral-2"), true);
    const allowed = filterAllowedWorkers([{ name: "cc-haiku" }, { name: "wr-groq-1" }]);
    assert.equal(allowed.length, 1);
  });
});

describe("Wave B — priority + observation + F0 profile", () => {
  it("incident outranks heartbeat in priority queue", () => {
    const ranked = rankSpawnCandidates([
      { source: "heartbeat", title: "idle" },
      { source: "incident", title: "fire", severity: 0.9 },
    ]);
    assert.equal(ranked[0].source, "incident");
    assert.ok(scoreCandidate({ source: "incident" }) > scoreCandidate({ source: "heartbeat" }));
  });

  it("hybrid profile enables enforce_autonomous in KV", () => {
    const db = setupDb();
    const r = applyDeploymentProfile(db, "hybrid");
    assert.equal(r.ok, true);
    assert.equal(getConfig(db, "auth_gate.enforce_autonomous"), true);
    const mode = resolveAuthGateMode({ db, provenance: { source: "sentinel" } });
    assert.equal(mode, "enforce");
  });

  it("observation snapshot returns structured counts", () => {
    const db = setupDb();
    const obs = gatherObservationSnapshot(db);
    assert.equal(obs.ok, true);
    assert.ok(typeof obs.snapshot.activeMissions === "number");
  });
});

describe("Wave C — domain packs", () => {
  it("pickPackForSignal routes incident and opportunity", () => {
    assert.equal(pickPackForSignal({ type: "incident" }), "incident_ops");
    assert.equal(pickPackForSignal({ type: "opportunity" }), "opportunity_ops");
    assert.equal(pickPackForSignal({ type: "coding" }), "coding_audit");
  });
});

describe("Wave D — capability promotion + profiles", () => {
  it("promoteForgedCapability activates registry row", () => {
    const db = setupDb();
    registerCapability(db, {
      capabilityId: "cap_test",
      name: "test_cap",
      description: "test",
      status: "registered",
    });
    const r = promoteForgedCapability(db, { capabilityId: "cap_test" });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT status FROM runtime_capability_registry WHERE capability_id = ?`).get("cap_test");
    assert.equal(row.status, "active");
  });

  it("profileSummary reports active deployment profile", () => {
    const db = setupDb();
    applyDeploymentProfile(db, "local");
    const s = profileSummary(db);
    assert.equal(s.ok, true);
    assert.equal(s.profile, "local");
  });
});
