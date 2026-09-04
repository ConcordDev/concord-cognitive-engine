// server/lib/runtime/swe-harness.js
//
// Synthetic SWE-style harness — patch apply + test verify (no external dataset).

import crypto from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runClosedCodingLoop } from "./coding-loop-closure.js";

export const SWE_MINI_CASES = Object.freeze([
  {
    id: "swe_mini_add_export",
    description: "Add named export to a stub module",
    setup: (dir) => {
      const f = join(dir, "lib", "stub.js");
      mkdirSync(join(dir, "lib"), { recursive: true });
      writeFileSync(f, `export function hello() { return "hi"; }\n`);
      const testF = join(dir, "tests", "stub.test.js");
      mkdirSync(join(dir, "tests"), { recursive: true });
      writeFileSync(testF, `
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hello, goodbye } from "../lib/stub.js";
describe("stub", () => {
  it("hello works", () => { assert.equal(hello(), "hi"); });
  it("goodbye works", () => { assert.equal(goodbye(), "bye"); });
});
`);
      return { filePath: "lib/stub.js", testPattern: "goodbye" };
    },
    patch: {
      filePath: "lib/stub.js",
      search: `export function hello() { return "hi"; }`,
      replace: `export function hello() { return "hi"; }\nexport function goodbye() { return "bye"; }`,
    },
  },
  {
    id: "swe_mini_fix_off_by_one",
    description: "Fix off-by-one in sum helper",
    setup: (dir) => {
      const f = join(dir, "lib", "math-util.js");
      mkdirSync(join(dir, "lib"), { recursive: true });
      writeFileSync(f, `export function sum(a, b) { return a + b + 1; }\n`);
      const testF = join(dir, "tests", "math-util.test.js");
      mkdirSync(join(dir, "tests"), { recursive: true });
      writeFileSync(testF, `
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sum } from "../lib/math-util.js";
describe("math-util", () => {
  it("sum is correct", () => { assert.equal(sum(2, 3), 5); });
});
`);
      return { filePath: "lib/math-util.js", testPattern: "sum" };
    },
    patch: {
      filePath: "lib/math-util.js",
      search: `return a + b + 1`,
      replace: `return a + b`,
    },
  },
  {
    id: "swe_mini_add_guard",
    description: "Add null guard to parser",
    setup: (dir) => {
      const f = join(dir, "lib", "parse.js");
      mkdirSync(join(dir, "lib"), { recursive: true });
      writeFileSync(f, `export function parseId(v) { return String(v).trim(); }\n`);
      const testF = join(dir, "tests", "parse.test.js");
      mkdirSync(join(dir, "tests"), { recursive: true });
      writeFileSync(testF, `
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseId } from "../lib/parse.js";
describe("parse", () => {
  it("null returns empty", () => { assert.equal(parseId(null), ""); });
  it("trims", () => { assert.equal(parseId(" x "), "x"); });
});
`);
      return { filePath: "lib/parse.js", testPattern: "null" };
    },
    patch: {
      filePath: "lib/parse.js",
      search: `export function parseId(v) { return String(v).trim(); }`,
      replace: `export function parseId(v) { if (v == null) return ""; return String(v).trim(); }`,
    },
  },
]);

function runId() {
  return `swe_${crypto.randomUUID().slice(0, 12)}`;
}

export async function runSweMiniCase(caseId, { persistDb } = {}) {
  const spec = SWE_MINI_CASES.find((c) => c.id === caseId);
  if (!spec) return { ok: false, reason: "unknown_case", caseId };

  const dir = join(tmpdir(), `concord-swe-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const meta = spec.setup(dir);

  try {
    const result = await runClosedCodingLoop({
      goal: spec.description,
      patches: [spec.patch],
      testPattern: meta.testPattern,
      repoRoot: dir,
      maxIterations: 3,
    });

    if (persistDb) {
      try {
        persistDb.prepare(`
          INSERT INTO runtime_swe_runs (id, suite, case_id, status, patch_json, result_json, duration_ms, completed_at)
          VALUES (?, 'swe_mini', ?, ?, ?, ?, ?, ?)
        `).run(
          runId(),
          caseId,
          result.ok ? "passed" : "failed",
          JSON.stringify(spec.patch),
          JSON.stringify({ ok: result.ok, iterations: result.iterations }),
          null,
          Math.floor(Date.now() / 1000),
        );
      } catch { /* migration optional */ }
    }

    return { ok: result.ok, caseId, description: spec.description, result };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* optional */ }
  }
}

export async function runSweHarness({ db, caseIds } = {}) {
  const ids = caseIds?.length ? caseIds : SWE_MINI_CASES.map((c) => c.id);
  const results = [];
  for (const id of ids) {
    const r = await runSweMiniCase(id, { persistDb: db });
    results.push(r);
  }
  const passed = results.filter((r) => r.ok).length;
  return {
    ok: passed === results.length,
    suite: "swe_mini",
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length ? passed / results.length : 0,
    results,
  };
}
