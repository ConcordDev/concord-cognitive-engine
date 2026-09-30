// server/lib/pce/concord-adversarial-cases.js
//
// Adversarial benchmarks — nasty tasks that stress verification and learning.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function setupTrapRepo(dir) {
  mkdirSync(join(dir, "server", "lib"), { recursive: true });
  mkdirSync(join(dir, "server", "tests", "depth"), { recursive: true });
  writeFileSync(join(dir, "server", "lib", "compute.js"), `export function compute(x) { return x + 1; }\n`);
  writeFileSync(join(dir, "server", "lib", "compute-helper.js"), `export function compute(x) { return x + 99; }\n`);
  writeFileSync(join(dir, "server", "lib", "sample.js"), `export function compute(x) { return x + 1; }\n`);
  writeFileSync(join(dir, "server", "tests", "depth", "compute-behavior.test.js"), `
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compute } from "../../lib/compute.js";
describe("compute", () => { it("adds one", () => assert.equal(compute(2), 3)); });
`);
  return dir;
}

export const ADVERSARIAL_BENCH_CASES = Object.freeze([
  {
    id: "adv_misleading_filename",
    category: "misdirection",
    description: "Must patch compute.js not compute-helper.js (misleading similar names)",
    adversarial: true,
    async run({ db, sandbox }) {
      const dir = setupTrapRepo(sandbox);
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db, repoRoot: dir, intent: "fix compute in compute.js to add 2",
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/compute.js",
            search: "return x + 1;",
            replace: "return x + 2;",
          },
        }],
        params: { filePath: "server/lib/compute.js" },
      });
      const helper = readFileSync(join(dir, "server", "lib", "compute-helper.js"), "utf8");
      const main = readFileSync(join(dir, "server", "lib", "compute.js"), "utf8");
      return {
        ok: main.includes("x + 2") && helper.includes("x + 99"),
        patchedCorrectFile: main.includes("x + 2"),
        helperUntouched: helper.includes("x + 99"),
        pceOk: r.ok,
      };
    },
  },
  {
    id: "adv_similar_pattern_trap",
    category: "misdirection",
    description: "Two files export compute — only target file changes",
    adversarial: true,
    async run({ db, sandbox }) {
      const dir = setupTrapRepo(sandbox);
      const priorSample = readFileSync(join(dir, "server", "lib", "sample.js"), "utf8");
      const { executePceTask } = await import("./pce-engine.js");
      await executePceTask({
        db, repoRoot: dir, intent: "update sample.js compute",
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/sample.js",
            search: "return x + 1;",
            replace: "return x + 5;",
          },
        }],
      });
      const sample = readFileSync(join(dir, "server", "lib", "sample.js"), "utf8");
      const compute = readFileSync(join(dir, "server", "lib", "compute.js"), "utf8");
      return {
        ok: sample.includes("x + 5") && compute.includes("x + 1") && priorSample !== sample,
      };
    },
  },
  {
    id: "adv_cascade_dependency",
    category: "cascade",
    description: "Export rename requires dependent import update",
    adversarial: true,
    async run({ db, sandbox }) {
      const dir = setupTrapRepo(sandbox);
      writeFileSync(join(dir, "server", "lib", "api.js"), `export function fetchData() { return []; }\n`);
      writeFileSync(join(dir, "server", "lib", "consumer.js"), `import { fetchData } from './api.js';\nexport function run() { return fetchData(); }\n`);
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db, repoRoot: dir, intent: "rename fetchData to loadData with cascade",
        manualSteps: [
          {
            primitive: "SEARCH_REPLACE",
            args: {
              filePath: "server/lib/api.js",
              search: "export function fetchData()",
              replace: "export function loadData()",
            },
          },
          {
            primitive: "SEARCH_REPLACE",
            args: {
              filePath: "server/lib/consumer.js",
              search: "import { fetchData } from './api.js';\nexport function run() { return fetchData(); }",
              replace: "import { loadData } from './api.js';\nexport function run() { return loadData(); }",
            },
          },
        ],
      });
      const consumer = readFileSync(join(dir, "server", "lib", "consumer.js"), "utf8");
      return { ok: consumer.includes("loadData") && !consumer.includes("fetchData"), pceOk: r.ok };
    },
  },
  {
    id: "adv_broken_test_honest_fail",
    category: "broken_tests",
    description: "Broken test file fails verification honestly (no silent pass)",
    adversarial: true,
    async run({ db, sandbox }) {
      const dir = setupTrapRepo(sandbox);
      writeFileSync(join(dir, "server", "tests", "depth", "broken.test.js"), `
import { describe, it } from "node:test";
describe("broken", () => { it("syntax error", () => { assert.equal(1, 1); });
`);
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db, repoRoot: dir, intent: "fix compute",
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: { filePath: "server/lib/compute.js", search: "return x + 1;", replace: "return x + 2;" },
        }],
        params: { testPattern: "broken" },
      });
      return { ok: r.ok === false || r.verification?.testsPassed === false, honest: true };
    },
  },
  {
    id: "adv_partial_failure_rollback",
    category: "rollback",
    description: "Second transform fails syntax — first transform rolled back",
    adversarial: true,
    async run({ db, sandbox }) {
      const dir = setupTrapRepo(sandbox);
      const prior = readFileSync(join(dir, "server", "lib", "compute.js"), "utf8");
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db, repoRoot: dir, intent: "multi step with syntax break",
        manualSteps: [
          {
            primitive: "SEARCH_REPLACE",
            args: { filePath: "server/lib/compute.js", search: "return x + 1;", replace: "return x + 2;" },
          },
          {
            primitive: "SEARCH_REPLACE",
            args: { filePath: "server/lib/compute.js", search: "return x + 2;", replace: "return x + 2" },
          },
        ],
      });
      const after = readFileSync(join(dir, "server", "lib", "compute.js"), "utf8");
      return { ok: r.ok === false && r.rolledBack === true && after === prior };
    },
  },
  {
    id: "adv_security_sql_injection",
    category: "security",
    description: "Rejects SQL injection in migration content",
    adversarial: true,
    async run({ db, sandbox }) {
      const dir = setupTrapRepo(sandbox);
      mkdirSync(join(dir, "server", "migrations"), { recursive: true });
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db, repoRoot: dir, intent: "add migration",
        manualSteps: [{
          primitive: "CREATE_FILE",
          args: {
            filePath: "server/migrations/999_evil.js",
            content: `export function up(db) {\n  db.exec("DROP TABLE users; --");\n}\n`,
          },
        }],
      });
      return { ok: r.ok === false, reason: r.reason, rolledBack: r.rolledBack };
    },
  },
  {
    id: "adv_conflicting_requirements",
    category: "conflict",
    description: "Impossible search/replace fails without corrupting file",
    adversarial: true,
    async run({ db, sandbox }) {
      const dir = setupTrapRepo(sandbox);
      const prior = readFileSync(join(dir, "server", "lib", "compute.js"), "utf8");
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db, repoRoot: dir, intent: "impossible patch",
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/compute.js",
            search: "THIS_STRING_DOES_NOT_EXIST",
            replace: "anything",
          },
        }],
      });
      const after = readFileSync(join(dir, "server", "lib", "compute.js"), "utf8");
      return { ok: r.ok === false && after === prior, reason: r.reason || r.transform?.reason };
    },
  },
  {
    id: "adv_rollback_then_recover",
    category: "rollback",
    description: "Bad patch rolled back, then valid patch succeeds",
    adversarial: true,
    async run({ db, sandbox }) {
      const dir = setupTrapRepo(sandbox);
      const { executePceTask } = await import("./pce-engine.js");
      const bad = await executePceTask({
        db, repoRoot: dir, intent: "break",
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/compute.js",
            search: "export function compute(x) { return x + 1; }",
            replace: "export function compute(x) { return x + 1",
          },
        }],
      });
      const good = await executePceTask({
        db, repoRoot: dir, intent: "fix",
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/compute.js",
            search: "return x + 1;",
            replace: "return x + 3;",
          },
        }],
      });
      const content = readFileSync(join(dir, "server", "lib", "compute.js"), "utf8");
      return { ok: bad.rolledBack && good.ok && content.includes("x + 3") };
    },
  },
  {
    id: "adv_secret_in_comment_ok",
    category: "security",
    description: "Distinguishes real secrets from safe placeholder comments",
    adversarial: true,
    async run({ db, sandbox }) {
      const dir = setupTrapRepo(sandbox);
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db, repoRoot: dir, intent: "add config comment",
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/compute.js",
            search: "export function compute(x) { return x + 1; }",
            replace: "// configure api_key in env\nexport function compute(x) { return x + 1; }",
          },
        }],
      });
      return { ok: r.ok === true, allowsComment: true };
    },
  },
  {
    id: "adv_no_llm_for_deterministic",
    category: "deterministic",
    description: "Known off-by-one solved without requires_llm",
    adversarial: true,
    async run({ db, sandbox }) {
      const dir = setupTrapRepo(sandbox);
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db, repoRoot: dir, intent: "fix off by one",
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: { filePath: "server/lib/compute.js", search: "return x + 1;", replace: "return x + 0;" },
        }],
      });
      return {
        ok: r.ok !== false && r.reason !== "requires_llm",
        deterministic: r.deterministic !== false,
        mode: r.mode,
      };
    },
  },
]);

export const ADVERSARIAL_CATEGORIES = Object.freeze([
  "misdirection",
  "cascade",
  "broken_tests",
  "rollback",
  "security",
  "conflict",
  "deterministic",
]);
