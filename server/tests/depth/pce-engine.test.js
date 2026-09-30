// server/tests/depth/pce-engine.test.js
//
// PCE-1.0 — program construction engine behavioral tests.

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
import { up as upPce } from "../../migrations/431_pce_substrate.js";
import { up as upMetrics } from "../../migrations/432_pce_metrics.js";
import { up as upBenchRuns } from "../../migrations/433_pce_bench_runs.js";
import {
  executePceTask,
  pceOverview,
  buildCodeSpace,
  compileIntent,
  seedConcordCorpus,
  findPatternsForIntent,
  compareCodeSimilarity,
} from "../../lib/pce/index.js";
import { createFile as createFilePrimitive, searchReplace } from "../../lib/pce/transform-primitives.js";

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
  upPce(db);
  upMetrics(db);
  upBenchRuns(db);
  return db;
}

describe("PCE-0 — Code Space + AST cache", () => {
  it("buildCodeSpace indexes files and symbols", async () => {
    const db = setupDb();
    const dir = join(tmpdir(), `pce-cs-${Date.now()}`);
    mkdirSync(join(dir, "lib"), { recursive: true });
    writeFileSync(join(dir, "lib", "util.js"), "export function foo() { return 1; }\n");
    const cs = await buildCodeSpace(db, dir, { maxFiles: 10 });
    assert.equal(cs.ok, true);
    assert.ok(cs.fileCount >= 1);
    assert.ok(cs.state.S.symbolCount >= 1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("PCE-1 — Transform primitives", () => {
  it("CREATE_FILE + SEARCH_REPLACE with rollback", async () => {
    const db = setupDb();
    const dir = join(tmpdir(), `pce-tx-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    const created = createFilePrimitive({
      db, repoRoot: dir, filePath: "lib/x.js", content: "export const v = 1;\n",
    });
    assert.equal(created.ok, true);

    const patched = searchReplace({
      db, repoRoot: dir, filePath: "lib/x.js",
      search: "export const v = 1;",
      replace: "export const v = 2;",
    });
    assert.equal(patched.ok, true);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("PCE-2 — Pattern IR + intent compiler", () => {
  it("seeds Concord corpus and matches migration intent", () => {
    const db = setupDb();
    const seeded = seedConcordCorpus(db);
    assert.ok(seeded.count >= 5);
    const matches = findPatternsForIntent(db, "add database migration column");
    assert.ok(matches.length >= 1);
    assert.match(matches[0].patternId, /migration/);
  });

  it("compileIntent returns novel mode when no match", () => {
    const db = setupDb();
    seedConcordCorpus(db);
    const plan = compileIntent("quantum flux capacitor warp drive", { db });
    assert.equal(plan.mode, "novel");
    assert.equal(plan.requiresLlm, true);
  });
});

describe("PCE-3 — IP similarity", () => {
  it("detects structurally identical code with renamed identifiers", () => {
    const a = "function foo(x) { return x + 1; }";
    const b = "function bar(y) { return y + 1; }";
    const cmp = compareCodeSimilarity(a, b);
    assert.equal(cmp.structuralMatch, true);
  });
});

describe("PCE-4 — Verification pipeline", () => {
  it("rejects files with secret patterns", async () => {
    const dir = join(tmpdir(), `pce-sec-${Date.now()}`);
    mkdirSync(join(dir, "lib"), { recursive: true });
    writeFileSync(join(dir, "lib", "bad.js"), "const api_key = 'sk-abcdefghijklmnopqrstuvwxyz';\n");
    const { gateSecretScan } = await import("../../lib/pce/verification-pipeline.js");
    const r = gateSecretScan(["lib/bad.js"], dir);
    assert.equal(r.ok, false);
    assert.equal(r.hardReject, true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("PCE engine — end-to-end", () => {
  it("executePceTask applies manual steps and verifies", async () => {
    const db = setupDb();
    const dir = join(tmpdir(), `pce-e2e-${Date.now()}`);
    mkdirSync(join(dir, "lib"), { recursive: true });
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "lib", "calc.js"), "export function add(a, b) { return a + b; }\n");
    writeFileSync(join(dir, "tests", "calc.test.js"), `
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { add } from "../lib/calc.js";
describe("calc", () => {
  it("adds", () => { assert.equal(add(2, 3), 5); });
});
`);

    const r = await executePceTask({
      db,
      intent: "fix add function",
      repoRoot: dir,
      manualSteps: [{
        primitive: "SEARCH_REPLACE",
        args: {
          filePath: "lib/calc.js",
          search: "return a + b;",
          replace: "return a + b + 0;",
        },
      }],
      params: {},
    });

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.changedFiles.includes("lib/calc.js"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("pceOverview reports substrate stats", async () => {
    const db = setupDb();
    const ov = await pceOverview(db);
    assert.equal(ov.ok, true);
    assert.equal(ov.version, "PCE-1.0");
    assert.ok(ov.patterns >= 5);
  });

  it("pceMetricsSummary tracks deterministic coverage", async () => {
    const db = setupDb();
    const { recordPceMetric, pceMetricsSummary } = await import("../../lib/pce/pce-metrics.js");
    recordPceMetric(db, { category: "coding", path: "deterministic", ok: true, deterministic: true, durationMs: 10 });
    recordPceMetric(db, { category: "coding", path: "llm", ok: true, deterministic: false, durationMs: 100, tokensUsed: 500 });
    const sum = pceMetricsSummary(db, { sinceDays: 1 });
    assert.equal(sum.ok, true);
    assert.equal(sum.total, 2);
    assert.equal(sum.deterministicCoverage, 0.5);
    assert.ok(sum.killerMetric.label === "deterministic_coverage");
  });
});
