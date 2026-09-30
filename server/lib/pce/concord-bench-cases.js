// server/lib/pce/concord-bench-cases.js
//
// Concord-realistic benchmark cases — sandboxed edits + read-only repo analysis.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Resolve Concord monorepo root from cwd. */
export function resolveConcordRoot(cwd) {
  const root = cwd || process.cwd();
  if (existsSync(join(root, "server", "server.js"))) return root;
  if (root.endsWith("/server") && existsSync(join(root, "server.js"))) {
    return root.replace(/\/server$/, "");
  }
  const parent = root.replace(/\/server$/, "");
  if (existsSync(join(parent, "server", "server.js"))) return parent;
  return root;
}

function sandboxDir(prefix) {
  return join(tmpdir(), `concord-bench-${prefix}-${Date.now()}`);
}

function setupMiniConcord(dir) {
  mkdirSync(join(dir, "server", "lib"), { recursive: true });
  mkdirSync(join(dir, "server", "tests", "depth"), { recursive: true });
  mkdirSync(join(dir, "server", "migrations"), { recursive: true });
  writeFileSync(join(dir, "server", "lib", "sample.js"), `export function compute(x) { return x + 1; }\n`);
  writeFileSync(join(dir, "server", "tests", "depth", "sample-behavior.test.js"), `
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compute } from "../../lib/sample.js";
describe("sample", () => {
  it("computes", () => { assert.equal(compute(2), 3); });
});
`);
  return dir;
}

/**
 * Each case: { id, category, description, readOnly?, run(ctx) }
 * ctx: { db, concordRoot, sandbox }
 */
export const CONCORD_BENCH_CASES = Object.freeze([
  {
    id: "concord_repo_index",
    category: "repository_intelligence",
    description: "Index real Concord server tree (read-only)",
    readOnly: true,
    async run({ db, concordRoot }) {
      const { buildCodeSpace } = await import("./code-space.js");
      const serverRoot = join(concordRoot, "server");
      if (!existsSync(join(serverRoot, "server.js"))) {
        return { ok: false, reason: "concord_tree_missing" };
      }
      const cs = await buildCodeSpace(db, concordRoot, { maxFiles: 200 });
      return {
        ok: cs.ok && cs.fileCount >= 10,
        fileCount: cs.fileCount,
        symbolCount: cs.state?.S?.symbolCount,
      };
    },
  },
  {
    id: "concord_repo_brain",
    category: "repository_intelligence",
    description: "Build repo brain with dependency + test graphs (read-only)",
    readOnly: true,
    async run({ db, concordRoot }) {
      const { buildRepoBrain } = await import("./repo-brain.js");
      const brain = await buildRepoBrain(db, concordRoot, { query: "mission" });
      return {
        ok: brain.ok && (brain.summary?.files || 0) >= 10,
        summary: brain.summary,
        graphCounts: {
          tests: brain.graphs?.test?.count,
          deps: brain.graphs?.dependency?.edges?.length,
        },
      };
    },
  },
  {
    id: "concord_pattern_migration_match",
    category: "deterministic_synthesis",
    description: "Intent compiler matches migration pattern on Concord corpus",
    readOnly: true,
    async run({ db }) {
      const { seedConcordCorpus } = await import("./concord-corpus.js");
      const { compileIntent } = await import("./intent-compiler.js");
      seedConcordCorpus(db);
      const plan = compileIntent("add database migration column for new table", { db });
      return {
        ok: plan.ok && plan.patternId === "concord.migration_add_column",
        patternId: plan.patternId,
        mode: plan.mode,
      };
    },
  },
  {
    id: "concord_pce_bug_fix",
    category: "bug_repair",
    description: "PCE fixes off-by-one in sandbox module mirroring server/lib style",
    async run({ db, sandbox }) {
      const dir = setupMiniConcord(sandbox);
      writeFileSync(join(dir, "server", "lib", "sample.js"), `export function compute(x) { return x + 2; }\n`);
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db,
        intent: "fix compute off by one",
        repoRoot: dir,
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/sample.js",
            search: "return x + 2;",
            replace: "return x + 1;",
          },
        }],
      });
      return { ok: r.ok, verification: r.verification?.ok, testsPassed: r.verification?.testsPassed };
    },
  },
  {
    id: "concord_pce_add_export",
    category: "feature_addition",
    description: "PCE adds named export to sandbox lib module",
    async run({ db, sandbox }) {
      const dir = setupMiniConcord(sandbox);
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db,
        intent: "add named export function to module",
        repoRoot: dir,
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/sample.js",
            search: "export function compute(x) { return x + 1; }",
            replace: "export function compute(x) { return x + 1; }\nexport function double(x) { return x * 2; }",
          },
        }],
        params: { testPattern: "sample" },
      });
      const content = readFileSync(join(dir, "server", "lib", "sample.js"), "utf8");
      return {
        ok: r.ok && content.includes("double"),
        testsPassed: r.verification?.testsPassed,
      };
    },
  },
  {
    id: "concord_secret_reject",
    category: "security_repair",
    description: "Verification pipeline rejects secret injection",
    async run({ db, sandbox }) {
      const dir = setupMiniConcord(sandbox);
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db,
        intent: "add api key config",
        repoRoot: dir,
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/sample.js",
            search: "export function compute(x) { return x + 1; }",
            replace: `const api_key = 'sk-abcdefghijklmnopqrstuvwxyz';\nexport function compute(x) { return x + 1; }`,
          },
        }],
      });
      return {
        ok: r.ok === false && (r.reason === "verification_failed" || r.verification?.hardFailures?.length > 0),
        reason: r.reason,
        rolledBack: r.rolledBack,
      };
    },
  },
  {
    id: "concord_rollback_on_fail",
    category: "verification",
    description: "Failed verification rolls back transform",
    async run({ db, sandbox }) {
      const dir = setupMiniConcord(sandbox);
      const prior = readFileSync(join(dir, "server", "lib", "sample.js"), "utf8");
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db,
        intent: "break syntax",
        repoRoot: dir,
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/sample.js",
            search: "export function compute(x) { return x + 1; }",
            replace: "export function compute(x) { return x + 1",
          },
        }],
      });
      const after = readFileSync(join(dir, "server", "lib", "sample.js"), "utf8");
      return {
        ok: r.ok === false && r.rolledBack === true && after === prior,
        rolledBack: r.rolledBack,
      };
    },
  },
  {
    id: "concord_depth_test_scaffold",
    category: "test_generation",
    description: "PCE creates depth test scaffold in sandbox",
    async run({ db, sandbox }) {
      const dir = setupMiniConcord(sandbox);
      const { executePceTask } = await import("./pce-engine.js");
      const testPath = "server/tests/depth/widget-behavior.test.js";
      const r = await executePceTask({
        db,
        intent: "add behavioral depth test for macro or module",
        repoRoot: dir,
        manualSteps: [{
          primitive: "CREATE_FILE",
          args: {
            filePath: testPath,
            content: `import { describe, it } from "node:test";\nimport assert from "node:assert/strict";\ndescribe("widget", () => {\n  it("passes", () => { assert.equal(1, 1); });\n});\n`,
          },
        }],
      });
      return {
        ok: r.ok && existsSync(join(dir, testPath)),
        created: r.changedFiles,
      };
    },
  },
  {
    id: "concord_coding_loop_template",
    category: "mission_runtime",
    description: "coding_loop_closed mission template is wired for PCE",
    readOnly: true,
    async run() {
      const { MISSION_TEMPLATES } = await import("../mission-templates.js");
      const tpl = MISSION_TEMPLATES.coding_loop_closed;
      const tools = (tpl?.steps || []).map((s) => s.tool);
      return {
        ok: !!tpl && tools.includes("pce_execute") && tools.includes("coding_loop_verify"),
        tools,
      };
    },
  },
  {
    id: "concord_swe_mini_in_sandbox",
    category: "bug_repair",
    description: "SWE mini harness passes in isolated repo (baseline)",
    async run({ db }) {
      const { runSweHarness } = await import("../runtime/swe-harness.js");
      const r = await runSweHarness({ db, caseIds: ["swe_mini_fix_off_by_one"] });
      return { ok: r.ok, passRate: r.passRate };
    },
  },
  {
    id: "concord_honesty_reject",
    category: "security_repair",
    description: "Honesty gate rejects setInterval fake-progress injection",
    async run({ db, sandbox }) {
      const dir = setupMiniConcord(sandbox);
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db,
        intent: "add loading progress indicator",
        repoRoot: dir,
        manualSteps: [{
          primitive: "SEARCH_REPLACE",
          args: {
            filePath: "server/lib/sample.js",
            search: "export function compute(x) { return x + 1; }",
            replace: `let progress = 0;\nsetInterval(() => { progress += 10; }, 100);\nexport function compute(x) { return x + 1; }`,
          },
        }],
      });
      return {
        ok: r.ok === false && (r.reason === "verification_failed" || r.rolledBack),
        reason: r.reason,
        rolledBack: r.rolledBack,
      };
    },
  },
  {
    id: "concord_migration_authoring",
    category: "database",
    description: "PCE authors numbered migration in sandbox",
    async run({ db, sandbox }) {
      const dir = setupMiniConcord(sandbox);
      const migPath = "server/migrations/999_bench_column.js";
      const { executePceTask } = await import("./pce-engine.js");
      const r = await executePceTask({
        db,
        intent: "author numbered sqlite migration file",
        repoRoot: dir,
        manualSteps: [{
          primitive: "CREATE_FILE",
          args: {
            filePath: migPath,
            content: `export function up(db) {\n  db.exec(\`ALTER TABLE users ADD COLUMN bench_flag INTEGER DEFAULT 0\`);\n}\n`,
          },
        }],
      });
      const content = existsSync(join(dir, migPath))
        ? readFileSync(join(dir, migPath), "utf8")
        : "";
      const fileOk = content.includes("export function up");
      return {
        ok: fileOk,
        pceOk: r.ok,
        reason: r.reason,
        created: migPath,
      };
    },
  },
  {
    id: "concord_impact_analysis",
    category: "repository_intelligence",
    description: "Impact analysis finds blast radius for mission-runtime symbol",
    readOnly: true,
    async run({ db, concordRoot }) {
      const { buildRepoBrain, impactAnalysis } = await import("./repo-brain.js");
      const brain = await buildRepoBrain(db, concordRoot, { query: "tickMission" });
      const impact = impactAnalysis(brain, {
        filePath: "server/lib/mission-runtime.js",
        symbol: "tickMission",
      });
      return {
        ok: brain.ok && impact.ok !== false,
        affectedModules: impact.affectedModules?.length ?? 0,
        affectedTests: impact.affectedTests?.length ?? 0,
      };
    },
  },
  {
    id: "concord_repo_graph_edges",
    category: "repository_intelligence",
    description: "Repo graph indexes Concord tree with symbol edges",
    readOnly: true,
    async run({ db, concordRoot }) {
      const { indexRepo, repoGraphOverview } = await import("../runtime/repo-graph.js");
      await indexRepo(db, concordRoot, { maxFiles: 150 });
      const g = repoGraphOverview(db, concordRoot);
      return {
        ok: g.ok && g.files >= 10,
        files: g.files,
        exports: g.exports,
        edges: g.edges,
      };
    },
  },
  {
    id: "concord_dila_surface_wired",
    category: "mission_runtime",
    description: "Dila domain exposes empirical excellence macros",
    readOnly: true,
    async run({ concordRoot }) {
      const dilaPath = join(concordRoot, "server", "domains", "dila.js");
      if (!existsSync(dilaPath)) return { ok: false, reason: "dila_domain_missing" };
      const src = readFileSync(dilaPath, "utf8");
      const required = [
        "concord_bench",
        "pce_improvement_cycle",
        "pce_metrics",
        "coding_pipeline",
      ];
      const missing = required.filter((m) => !src.includes(`"${m}"`));
      return { ok: missing.length === 0, missing, wired: required.length - missing.length };
    },
  },
  {
    id: "concord_depth_pattern_match",
    category: "deterministic_synthesis",
    description: "Intent compiler matches depth test pattern",
    readOnly: true,
    async run({ db }) {
      const { seedConcordCorpus } = await import("./concord-corpus.js");
      const { seedProvenBenchPatterns } = await import("./concord-bench-patterns.js");
      const { compileIntent } = await import("./intent-compiler.js");
      seedConcordCorpus(db);
      seedProvenBenchPatterns(db);
      const plan = compileIntent("add behavioral depth test for macro module", { db });
      const ids = [plan.patternId, ...(plan.subPlans || []).map((p) => p.patternId)];
      const matched = ids.some((id) => id?.includes("depth") || id?.includes("test"));
      return { ok: plan.ok && matched, patternId: plan.patternId, mode: plan.mode };
    },
  },
  {
    id: "concord_register_lens_pattern",
    category: "deterministic_synthesis",
    description: "Proven bench patterns include lens registration recipe",
    readOnly: true,
    async run({ db }) {
      const { seedProvenBenchPatterns } = await import("./concord-bench-patterns.js");
      const { findPatternsForIntent } = await import("./pattern-ir.js");
      seedProvenBenchPatterns(db);
      const matches = findPatternsForIntent(db, "register lens action macro domain", { limit: 3 });
      return {
        ok: matches.some((m) => m.patternId.includes("register_lens") || m.patternId.includes("mission")),
        matches: matches.map((m) => m.patternId),
      };
    },
  },
]);

export const CONCORD_BENCH_CATEGORIES = Object.freeze([
  "repository_intelligence",
  "deterministic_synthesis",
  "bug_repair",
  "feature_addition",
  "security_repair",
  "verification",
  "test_generation",
  "mission_runtime",
  "database",
]);
