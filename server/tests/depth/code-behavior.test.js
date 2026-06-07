// tests/depth/code-behavior.test.js — REAL behavioral tests for the `code`
// domain (the dev/IDE lens; registerLensAction family, via lensRun). Exact-value
// assertions on the deterministic macros (complexity/dependency/coverage calcs,
// the whitespace formatter, the node:vm exec evaluator, project-wide search, and
// the heuristic Problems-panel diagnostics) + virtual-workspace CRUD round-trips
// (projects/files, git stage→commit→log, snippet save→list). LLM-backed macros
// (codebase-chat, lsp-*, multi-file-plan, explain, refactor-suggest, tab-completion,
// inline-edit, test-generate) are intentionally SKIPPED — they need a live model.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("code — deterministic analysis macros (exact values)", () => {
  it("complexityAnalysis: cyclomatic = 1+branches+loops; cognitive = branches+loops*2+nestingPenalty", async () => {
    const r = await lensRun("code", "complexityAnalysis", {
      data: { modules: [{ name: "m", lines: 10, functions: 2, branches: 3, loops: 1, nestingDepth: 2 }] },
    });
    assert.equal(r.ok, true);
    const mod = r.result.modules[0];
    assert.equal(mod.cyclomaticComplexity, 5);   // 1 + 3 + 1
    assert.equal(mod.cognitiveComplexity, 8);     // 3 + 1*2 + (2*3/2=3)
    assert.equal(r.result.totalLines, 10);
    assert.equal(r.result.totalModules, 1);
  });

  it("dependencyAudit: a GPL dep is flagged high-risk copyleft; license summary counts it", async () => {
    const r = await lensRun("code", "dependencyAudit", {
      data: { dependencies: [{ name: "gpllib", version: "1.0.0", license: "GPL-3.0" }] },
    });
    assert.equal(r.ok, true);
    const dep = r.result.dependencies[0];
    assert.equal(dep.riskLevel, "high");
    assert.ok(dep.issues.some((i) => i.type === "copyleft_license"));
    assert.equal(r.result.licenseSummary.copyleft, 1);
    assert.equal(r.result.licenseSummary.permissive, 0);
  });

  it("coverageAnalysis: combined = stmt*0.5 + branch*0.3 + fn*0.2; overall threshold check", async () => {
    const r = await lensRun("code", "coverageAnalysis", {
      data: { coverage: [{ file: "a.js", statements: 10, statementsHit: 9, branches: 4, branchesHit: 2, functions: 2, functionsHit: 2 }] },
    });
    assert.equal(r.ok, true);
    const f = r.result.files[0];
    assert.equal(f.statementCoverage, 90);  // 9/10
    assert.equal(f.branchCoverage, 50);     // 2/4
    assert.equal(f.functionCoverage, 100);  // 2/2
    assert.equal(f.combinedScore, 80);      // 0.9*0.5 + 0.5*0.3 + 1*0.2 = 0.45+0.15+0.20
    assert.equal(r.result.overall.statementCoverage, 90);
    assert.equal(r.result.meetsThreshold80, true);  // overallStatement 90 >= 80
  });

  it("format-code: tabs→2 spaces, trailing whitespace trimmed, final newline ensured", async () => {
    const r = await lensRun("code", "format-code", { params: { code: "\tlet x = 1   ", language: "javascript" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.formatted, "  let x = 1\n");  // tab→2sp, trailing trimmed, newline added
    assert.equal(r.result.bytesOut, 12);                // "  let x = 1\n" = 2+9 chars + newline
  });

  it("exec: node:vm evaluates the last expression — `1 + 2 + 3` → stdout `6`, exit 0", async () => {
    const r = await lensRun("code", "exec", { params: { code: "1 + 2 + 3", language: "javascript" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.stdout, "6");
    assert.equal(r.result.exitCode, 0);
    assert.equal(r.result.supported, true);
  });

  it("exec: console.log output is captured verbatim", async () => {
    const r = await lensRun("code", "exec", { params: { code: "console.log('hi'); console.log(2*21)", language: "js" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.stdout, "hi\n42");
    assert.equal(r.result.exitCode, 0);
  });

  it("search-project: stateless file array yields exact line/column hits", async () => {
    const r = await lensRun("code", "search-project", {
      params: {
        query: "foo",
        files: [{ name: "a.js", content: "const foo = 1;\nbar();\nfoo();" }],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.hits.length, 2);
    assert.equal(r.result.hits[0].line, 1);
    assert.equal(r.result.hits[0].column, 7);   // "const foo" → foo at col 7
    assert.equal(r.result.hits[1].line, 3);
    assert.equal(r.result.hits[1].matchText, "foo");
  });

  it("diagnostics: an unbalanced bracket is reported as a bracket-balance error", async () => {
    const ctx = await depthCtx(`code-diag-${randomUUID()}`);
    const proj = await lensRun("code", "projects-create", { params: { name: "diagproj" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "bad.js", content: "function f() {\n  return 1;\n" } }, ctx);
    const r = await lensRun("code", "diagnostics", { params: { projectId, path: "bad.js" } }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.problems.some((p) => p.rule === "bracket-balance" && p.severity === "error"));
    assert.equal(r.result.bySeverity.error, 1);
  });
});

describe("code — virtual workspace CRUD round-trips", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`code-crud-${randomUUID()}`); });

  it("projects-create → projects-list → files-write → files-read round-trip", async () => {
    const created = await lensRun("code", "projects-create", { params: { name: "Round Trip" } }, ctx);
    assert.equal(created.ok, true);
    const projectId = created.result.project.id;
    assert.ok(projectId);

    const list = await lensRun("code", "projects-list", {}, ctx);
    assert.ok(list.result.projects.some((p) => p.id === projectId));

    const w = await lensRun("code", "files-write", { params: { projectId, path: "src/x.ts", content: "export const x = 1;" } }, ctx);
    assert.equal(w.ok, true);
    assert.equal(w.result.created, true);
    assert.equal(w.result.language, "typescript");  // langFromPath(.ts)

    const read = await lensRun("code", "files-read", { params: { projectId, path: "src/x.ts" } }, ctx);
    assert.equal(read.ok, true);
    assert.equal(read.result.content, "export const x = 1;");
  });

  it("git: files-write marks modified → stage → commit → log shows the commit", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "Git Proj" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "main.js", content: "console.log(1)" } }, ctx);

    const status = await lensRun("code", "git-status", { params: { projectId } }, ctx);
    assert.ok(status.result.modified.includes("main.js"));

    const staged = await lensRun("code", "git-stage", { params: { projectId, path: "main.js" } }, ctx);
    assert.ok(staged.result.staged.includes("main.js"));

    const commit = await lensRun("code", "git-commit", { params: { projectId, message: "initial commit" } }, ctx);
    assert.equal(commit.ok, true);
    const commitId = commit.result.commit.id;
    assert.ok(commitId);

    const log = await lensRun("code", "git-log", { params: { projectId } }, ctx);
    assert.ok(log.result.log.some((c) => c.id === commitId && c.message === "initial commit"));
  });

  it("snippets-save → snippets-list reads it back", async () => {
    const title = `snip-${randomUUID()}`;
    const saved = await lensRun("code", "snippets-save", { params: { title, code: "const a = 1;\nconst b = 2;", language: "javascript" } }, ctx);
    assert.equal(saved.ok, true);
    const id = saved.result.id;
    assert.ok(id);

    const list = await lensRun("code", "snippets-list", { params: { language: "javascript" } }, ctx);
    assert.ok(list.result.snippets.some((sn) => sn.id === id));
  });
});

describe("code — validation rejections", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`code-reject-${randomUUID()}`); });

  it("projects-create without a name is rejected", async () => {
    const bad = await lensRun("code", "projects-create", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });

  it("snippets-save without code is rejected", async () => {
    const bad = await lensRun("code", "snippets-save", { params: { title: "only-a-title" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title and code are required/);
  });

  it("git-commit with nothing staged is rejected", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "Empty Stage" } }, ctx);
    const projectId = proj.result.project.id;
    const bad = await lensRun("code", "git-commit", { params: { projectId, message: "nothing here" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /nothing staged/);
  });
});
