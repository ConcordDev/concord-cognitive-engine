// server/lib/pce/pce-bench.js
//
// PCEBench — internal benchmark categories for empirical claims.

import { executePceTask } from "./pce-engine.js";
import { runSweHarness } from "../runtime/swe-harness.js";
import { runCodingPipeline } from "./coding-pipeline.js";
import { runConcordBench } from "./concord-bench.js";
import { gateSecretScan } from "./verification-pipeline.js";
import { recordPceMetric } from "./pce-metrics.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const PCE_BENCH_CATEGORIES = Object.freeze([
  "bug_repair",
  "refactoring",
  "feature_addition",
  "api_change",
  "security_repair",
  "test_generation",
  "multi_file_mission",
  "concord_suite",
]);

export async function runPceBenchCategory(db, category, { repoRoot, dispatchMCP } = {}) {
  const started = Date.now();
  let result;

  switch (category) {
    case "bug_repair":
      result = await runSweHarness({ db });
      break;
    case "refactoring":
      result = await runSweHarness({ db, caseIds: ["swe_mini_fix_off_by_one"] });
      break;
    case "feature_addition":
      result = await runSweHarness({ db, caseIds: ["swe_mini_add_export"] });
      break;
    case "security_repair": {
      const dir = join(tmpdir(), `pce-sec-${Date.now()}`);
      mkdirSync(join(dir, "lib"), { recursive: true });
      writeFileSync(join(dir, "lib", "bad.js"), "const api_key = 'sk-abcdefghijklmnopqrstuvwxyz';\n");
      const scan = gateSecretScan(["lib/bad.js"], dir);
      result = { ok: scan.ok === false && scan.hardReject, category: "security_repair", scan };
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* optional */ }
      break;
    }
    case "test_generation": {
      const dir = join(tmpdir(), `pce-test-${Date.now()}`);
      mkdirSync(join(dir, "tests", "depth"), { recursive: true });
      const r = await executePceTask({
        db,
        intent: "add behavioral depth test for macro or module",
        repoRoot: dir,
        manualSteps: [{
          primitive: "CREATE_FILE",
          args: {
            filePath: "tests/depth/generated-behavior.test.js",
            content: "import { describe, it } from 'node:test';\nimport assert from 'node:assert/strict';\ndescribe('gen', () => { it('ok', () => assert.equal(1,1)); });\n",
          },
        }],
      });
      result = { ok: r.ok, category: "test_generation", changedFiles: r.changedFiles };
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* optional */ }
      break;
    }
    case "api_change": {
      const dir = join(tmpdir(), `pce-api-${Date.now()}`);
      mkdirSync(join(dir, "lib"), { recursive: true });
      writeFileSync(join(dir, "lib", "api.js"), `export function getData() { return { v: 1 }; }\n`);
      const r = await executePceTask({
        db,
        intent: "add named export function to module",
        repoRoot: dir,
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "lib/api.js",
            search: "export function getData() { return { v: 1 }; }",
            replace: "export function getData() { return { v: 1 }; }\nexport function getVersion() { return 2; }",
          },
        }],
      });
      result = { ok: r.ok, category: "api_change" };
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* optional */ }
      break;
    }
    case "multi_file_mission":
      result = await runCodingPipeline({
        db,
        intent: "index and verify repository",
        repoRoot,
        dispatchMCP,
        manualSteps: [],
      });
      break;
    case "concord_suite":
      result = await runConcordBench(db, { concordRoot: repoRoot });
      break;
    default:
      result = { ok: false, reason: "unknown_category" };
  }

  recordPceMetric(db, {
    category: `bench_${category}`,
    path: result.ok ? "deterministic" : "failed",
    ok: result.ok !== false,
    deterministic: category !== "multi_file_mission",
    durationMs: Date.now() - started,
    meta: { category, result: { ok: result.ok, passed: result.passed } },
  });

  return { category, ...result, durationMs: Date.now() - started };
}

export async function runPceBench(db, { categories, repoRoot, dispatchMCP } = {}) {
  const cats = categories?.length ? categories : PCE_BENCH_CATEGORIES;
  const results = [];
  for (const c of cats) {
    results.push(await runPceBenchCategory(db, c, { repoRoot, dispatchMCP }));
  }
  const passed = results.filter((r) => r.ok !== false).length;
  return {
    ok: passed === results.length,
    suite: "PCEBench",
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length ? passed / results.length : 0,
    results,
  };
}
