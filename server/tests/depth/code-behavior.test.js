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

describe("code — analysis + diagnostics (wave 7 top-up)", () => {
  it("changeRiskAssessment: churn 250 + 6 bugs + no coverage → riskScore 7, level critical", async () => {
    const r = await lensRun("code", "changeRiskAssessment", {
      data: { changes: [{ file: "hot.js", linesAdded: 150, linesRemoved: 100, recentBugCount: 6, hasCoverage: false }] },
    });
    const f = r.result.files[0];
    assert.equal(f.churn, 250);
    assert.equal(f.riskScore, 7);          // large_change(2) + high_bug_history(3) + no_test_coverage(2)
    assert.equal(f.riskLevel, "critical");
    assert.equal(r.result.overallRisk, "critical");
    assert.ok(r.result.criticalFiles.includes("hot.js"));
    assert.ok(r.result.recommendations.includes("Add tests for uncovered files before merging"));
  });

  it("symbols-outline: extracts a class + method + arrow function with exact line numbers", async () => {
    const ctx = await depthCtx(`code-outline-${randomUUID()}`);
    const proj = await lensRun("code", "projects-create", { params: { name: "outline" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", {
      params: { projectId, path: "mod.ts", content: "export class Widget {\n  render() {\n    return 1;\n  }\n}\nconst go = () => 2;" },
    }, ctx);
    const r = await lensRun("code", "symbols-outline", { params: { projectId, path: "mod.ts" } }, ctx);
    const cls = r.result.symbols.find((sm) => sm.name === "Widget");
    assert.equal(cls.kind, "class");
    assert.equal(cls.line, 1);
    assert.ok(r.result.symbols.find((sm) => sm.name === "render" && sm.kind === "method"));
    const arrow = r.result.symbols.find((sm) => sm.name === "go");
    assert.equal(arrow.kind, "function");
    assert.equal(arrow.line, 6);
  });

  it("find-references: counts whole-word symbol hits across project files", async () => {
    const ctx = await depthCtx(`code-refs-${randomUUID()}`);
    const proj = await lensRun("code", "projects-create", { params: { name: "refs" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "a.js", content: "const tally = 1;\ntally += tally;" } }, ctx);
    await lensRun("code", "files-write", { params: { projectId, path: "b.js", content: "tallyhoo();\ntally();" } }, ctx);
    const r = await lensRun("code", "find-references", { params: { projectId, symbol: "tally" } }, ctx);
    assert.equal(r.result.symbol, "tally");
    // whole-word: a.js line1, a.js line2, b.js line2 — `tallyhoo` does NOT match.
    assert.equal(r.result.count, 3);
    assert.ok(r.result.references.some((ref) => ref.path === "b.js" && ref.line === 2));
    assert.ok(!r.result.references.some((ref) => ref.snippet.includes("tallyhoo")));
  });

  it("todo-scan: tags TODO/FIXME with line + tally by tag", async () => {
    const ctx = await depthCtx(`code-todo-${randomUUID()}`);
    const proj = await lensRun("code", "projects-create", { params: { name: "todo" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "t.js", content: "// TODO: wire it\nok();\n// FIXME broken\n// TODO another" } }, ctx);
    const r = await lensRun("code", "todo-scan", { params: { projectId } }, ctx);
    assert.equal(r.result.total, 3);
    assert.equal(r.result.byTag.TODO, 2);
    assert.equal(r.result.byTag.FIXME, 1);
    assert.ok(r.result.todos.some((t) => t.tag === "FIXME" && t.line === 3));
  });

  it("debug-run: breakpoint probe captures the hit line + console output", async () => {
    const r = await lensRun("code", "debug-run", {
      params: { code: "let x = 5;\nconsole.log(x * 2);\nlet y = x + 1;", language: "javascript", breakpoints: [2] },
    });
    assert.equal(r.result.exitCode, 0);
    assert.equal(r.result.hitCount, 1);
    assert.equal(r.result.frames[0].line, 2);
    assert.equal(r.result.stdout, "10");
    assert.ok(r.result.breakpoints.includes(2));
  });

  it("lsp-completions: prefix filter returns project symbols starting with the prefix", async () => {
    const ctx = await depthCtx(`code-comp-${randomUUID()}`);
    const proj = await lensRun("code", "projects-create", { params: { name: "comp" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "c.js", content: "function calculate() {}\nfunction render() {}\nconst calcTotal = 1;" } }, ctx);
    const r = await lensRun("code", "lsp-completions", { params: { projectId, prefix: "calc" } }, ctx);
    assert.equal(r.result.prefix, "calc");
    assert.ok(r.result.completions.some((c) => c.label === "calculate"));
    assert.ok(r.result.completions.some((c) => c.label === "calcTotal"));
    assert.ok(!r.result.completions.some((c) => c.label === "render"));
  });
});

describe("code — file + git operations (wave 7 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`code-fileops-${randomUUID()}`); });

  it("files-rename moves content; files-tree + files-read reflect the new path", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "rename-fs" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "old.py", content: "print('hi')" } }, ctx);
    const ren = await lensRun("code", "files-rename", { params: { projectId, from: "old.py", to: "new.py" } }, ctx);
    assert.equal(ren.result.to, "new.py");
    const tree = await lensRun("code", "files-tree", { params: { projectId } }, ctx);
    assert.ok(tree.result.tree.some((n) => n.path === "new.py" && n.language === "python"));
    assert.ok(!tree.result.tree.some((n) => n.path === "old.py"));
    const read = await lensRun("code", "files-read", { params: { projectId, path: "new.py" } }, ctx);
    assert.equal(read.result.content, "print('hi')");
  });

  it("files-rename onto an existing target path is rejected", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "rename-clash" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "src.js", content: "a" } }, ctx);
    await lensRun("code", "files-write", { params: { projectId, path: "dst.js", content: "b" } }, ctx);
    const bad = await lensRun("code", "files-rename", { params: { projectId, from: "src.js", to: "dst.js" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /target path exists/);
  });

  it("git-diff vs HEAD: a committed-then-edited file reports added + removed line counts", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "diff" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "f.js", content: "line1\nline2" } }, ctx);
    await lensRun("code", "git-stage", { params: { projectId, path: "f.js" } }, ctx);
    await lensRun("code", "git-commit", { params: { projectId, message: "base" } }, ctx);
    await lensRun("code", "files-write", { params: { projectId, path: "f.js", content: "line1\nCHANGED\nline3" } }, ctx);
    const r = await lensRun("code", "git-diff", { params: { projectId, path: "f.js" } }, ctx);
    assert.equal(r.result.status, "modified");
    assert.equal(r.result.unchanged, false);
    assert.equal(r.result.linesAdded, 2);   // CHANGED + line3
    assert.equal(r.result.linesRemoved, 1); // line2
  });

  it("git branch-create + checkout restores the committed working tree of each branch", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "branches" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "app.js", content: "v1" } }, ctx);
    await lensRun("code", "git-stage", { params: { projectId, path: "app.js" } }, ctx);
    await lensRun("code", "git-commit", { params: { projectId, message: "main v1" } }, ctx);

    const br = await lensRun("code", "git-branch-create", { params: { projectId, name: "feature", checkout: true } }, ctx);
    assert.equal(br.result.current, "feature");
    assert.ok(br.result.branches.includes("feature"));
    await lensRun("code", "files-write", { params: { projectId, path: "app.js", content: "v2-feature" } }, ctx);
    await lensRun("code", "git-stage", { params: { projectId, path: "app.js" } }, ctx);
    await lensRun("code", "git-commit", { params: { projectId, message: "feature v2" } }, ctx);

    // back to main → working tree must restore to v1
    const co = await lensRun("code", "git-checkout", { params: { projectId, branch: "main" } }, ctx);
    assert.equal(co.result.branch, "main");
    const onMain = await lensRun("code", "files-read", { params: { projectId, path: "app.js" } }, ctx);
    assert.equal(onMain.result.content, "v1");
  });

  it("git-merge fast-forwards a non-conflicting file change from another branch", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "merge" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "base.js", content: "base" } }, ctx);
    await lensRun("code", "git-stage", { params: { projectId, path: "base.js" } }, ctx);
    await lensRun("code", "git-commit", { params: { projectId, message: "root" } }, ctx);

    await lensRun("code", "git-branch-create", { params: { projectId, name: "topic", checkout: true } }, ctx);
    await lensRun("code", "files-write", { params: { projectId, path: "topic.js", content: "from-topic" } }, ctx);
    await lensRun("code", "git-stage", { params: { projectId, path: "topic.js" } }, ctx);
    await lensRun("code", "git-commit", { params: { projectId, message: "topic add" } }, ctx);

    await lensRun("code", "git-checkout", { params: { projectId, branch: "main" } }, ctx);
    const merged = await lensRun("code", "git-merge", { params: { projectId, from: "topic" } }, ctx);
    assert.equal(merged.result.merged, true);
    const read = await lensRun("code", "files-read", { params: { projectId, path: "topic.js" } }, ctx);
    assert.equal(read.result.content, "from-topic");
  });

  it("git-stash banks dirty changes to HEAD then git-stash-pop restores them", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "stash" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "s.js", content: "committed" } }, ctx);
    await lensRun("code", "git-stage", { params: { projectId, path: "s.js" } }, ctx);
    await lensRun("code", "git-commit", { params: { projectId, message: "base" } }, ctx);
    await lensRun("code", "files-write", { params: { projectId, path: "s.js", content: "wip-edit" } }, ctx);

    const stash = await lensRun("code", "git-stash", { params: { projectId, message: "wip" } }, ctx);
    assert.equal(stash.result.stashedFiles, 1);
    const reverted = await lensRun("code", "files-read", { params: { projectId, path: "s.js" } }, ctx);
    assert.equal(reverted.result.content, "committed");   // reverted to HEAD

    const listed = await lensRun("code", "git-stash-list", { params: { projectId } }, ctx);
    assert.ok(listed.result.stashes.some((e) => e.id === stash.result.stashId));

    const pop = await lensRun("code", "git-stash-pop", { params: { projectId } }, ctx);
    assert.equal(pop.result.restoredFiles, 1);
    const restored = await lensRun("code", "files-read", { params: { projectId, path: "s.js" } }, ctx);
    assert.equal(restored.result.content, "wip-edit");    // working edit restored
  });

  it("git-blame attributes a committed line to its commit", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "blame" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "bl.js", content: "alpha\nbeta" } }, ctx);
    await lensRun("code", "git-stage", { params: { projectId, path: "bl.js" } }, ctx);
    const commit = await lensRun("code", "git-commit", { params: { projectId, message: "two lines" } }, ctx);
    const r = await lensRun("code", "git-blame", { params: { projectId, path: "bl.js" } }, ctx);
    assert.equal(r.result.lineCount, 2);
    assert.ok(r.result.blame.some((b) => b.lineNo === 1 && b.text === "alpha" && b.commitId === commit.result.commit.id));
  });

  it("rename-symbol replaces whole-word occurrences project-wide and rejects invalid identifiers", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "rename-sym" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "r.js", content: "let foo = 1;\nfoo();\nfoobar();" } }, ctx);
    const r = await lensRun("code", "rename-symbol", { params: { projectId, from: "foo", to: "bar" } }, ctx);
    assert.equal(r.result.totalOccurrences, 2);   // `foobar` not touched (whole-word)
    const read = await lensRun("code", "files-read", { params: { projectId, path: "r.js" } }, ctx);
    assert.equal(read.result.content, "let bar = 1;\nbar();\nfoobar();");
    const bad = await lensRun("code", "rename-symbol", { params: { projectId, from: "bar", to: "1bad" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not a valid identifier/);
  });

  it("replace-project dryRun counts matches without mutating files", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "replace" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "p.js", content: "cat cat dog\ncat" } }, ctx);
    const dry = await lensRun("code", "replace-project", { params: { projectId, query: "cat", replacement: "fox", dryRun: true } }, ctx);
    assert.equal(dry.result.totalReplacements, 3);
    assert.equal(dry.result.dryRun, true);
    const unchanged = await lensRun("code", "files-read", { params: { projectId, path: "p.js" } }, ctx);
    assert.equal(unchanged.result.content, "cat cat dog\ncat");   // dry run left it alone
    const wet = await lensRun("code", "replace-project", { params: { projectId, query: "cat", replacement: "fox" } }, ctx);
    assert.equal(wet.result.totalReplacements, 3);
    const after = await lensRun("code", "files-read", { params: { projectId, path: "p.js" } }, ctx);
    assert.equal(after.result.content, "fox fox dog\nfox");
  });
});

describe("code — editor settings + collaboration (wave 7 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`code-editor-${randomUUID()}`); });

  it("run-config-save → run-config-list reads back the saved task", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "runcfg" } }, ctx);
    const projectId = proj.result.project.id;
    const saved = await lensRun("code", "run-config-save", { params: { projectId, name: "dev", command: "npm run dev" } }, ctx);
    assert.equal(saved.result.config.command, "npm run dev");
    const list = await lensRun("code", "run-config-list", { params: { projectId } }, ctx);
    assert.ok(list.result.configs.some((c) => c.id === saved.result.config.id && c.name === "dev"));
  });

  it("bookmark-add dedupes on (path,line); bookmark-list returns sorted marks", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "bookmarks" } }, ctx);
    const projectId = proj.result.project.id;
    const first = await lensRun("code", "bookmark-add", { params: { projectId, path: "m.js", line: 5, label: "here" } }, ctx);
    assert.equal(first.result.bookmark.line, 5);
    const dupe = await lensRun("code", "bookmark-add", { params: { projectId, path: "m.js", line: 5 } }, ctx);
    assert.equal(dupe.result.existed, true);
    const list = await lensRun("code", "bookmark-list", { params: { projectId } }, ctx);
    assert.equal(list.result.bookmarks.filter((b) => b.path === "m.js" && b.line === 5).length, 1);
  });

  it("extensions-install from the catalog, then extensions-toggle flips enabled", async () => {
    const cat = await lensRun("code", "extensions-catalog", {}, ctx);
    assert.ok(cat.result.catalog.some((e) => e.id === "prettier-fmt"));
    const inst = await lensRun("code", "extensions-install", { params: { extensionId: "eslint-lint" } }, ctx);
    assert.equal(inst.result.extension.id, "eslint-lint");
    assert.equal(inst.result.extension.enabled, true);
    const off = await lensRun("code", "extensions-toggle", { params: { extensionId: "eslint-lint", enabled: false } }, ctx);
    assert.equal(off.result.extension.enabled, false);
    const list = await lensRun("code", "extensions-list", {}, ctx);
    assert.ok(list.result.extensions.some((e) => e.id === "eslint-lint" && e.enabled === false));
  });

  it("extensions-install rejects an unknown extension id", async () => {
    const bad = await lensRun("code", "extensions-install", { params: { extensionId: "does-not-exist" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unknown extension/);
  });

  it("liveshare start → join → edit → poll surfaces the op to a since-cursor", async () => {
    const host = await depthCtx(`code-ls-host-${randomUUID()}`);
    const proj = await lensRun("code", "projects-create", { params: { name: "ls" } }, host);
    const projectId = proj.result.project.id;
    const session = await lensRun("code", "liveshare-start", { params: { projectId, name: "pair" } }, host);
    const code = session.result.session.code;
    assert.ok(code);

    const guest = await depthCtx(`code-ls-guest-${randomUUID()}`);
    const joined = await lensRun("code", "liveshare-join", { params: { code } }, guest);
    assert.equal(joined.result.session.participantCount, 2);

    const edit = await lensRun("code", "liveshare-edit", { params: { code, path: "shared.js", content: "hello" } }, guest);
    assert.equal(edit.result.op.kind, "edit");
    const poll = await lensRun("code", "liveshare-poll", { params: { code, since: edit.result.op.seq } }, host);
    assert.ok(poll.result.ops.some((o) => o.kind === "edit" && o.path === "shared.js" && o.content === "hello"));
  });

  it("liveshare-join rejects an unknown session code", async () => {
    const bad = await lensRun("code", "liveshare-join", { params: { code: "ZZZ999" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /session not found/);
  });

  it("commit-snapshot bundles tabs into a DTU; snapshots-list reads it back", async () => {
    const snap = await lensRun("code", "commit-snapshot", {
      params: { message: "checkpoint", files: [{ name: "a.js", language: "javascript", content: "1\n2\n3" }] },
    }, ctx);
    assert.equal(snap.result.snapshot.fileCount, 1);
    assert.equal(snap.result.snapshot.message, "checkpoint");
    const list = await lensRun("code", "snapshots-list", {}, ctx);
    assert.ok(list.result.snapshots.some((sn) => sn.id === snap.result.id && sn.message === "checkpoint"));
  });

  it("workspace-summary counts projects, files, and dirty projects for the caller", async () => {
    const sumCtx = await depthCtx(`code-summary-${randomUUID()}`);
    const proj = await lensRun("code", "projects-create", { params: { name: "summed" } }, sumCtx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "x.js", content: "x" } }, sumCtx);
    await lensRun("code", "files-write", { params: { projectId, path: "y.js", content: "y" } }, sumCtx);
    const r = await lensRun("code", "workspace-summary", {}, sumCtx);
    assert.equal(r.result.projectCount, 1);
    assert.equal(r.result.fileCount, 2);
    assert.equal(r.result.dirtyProjects, 1);   // files-write marks modified, uncommitted
  });
});

describe("code — LSP intellisense + diagnostics heuristics (wave 7 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`code-lsp-${randomUUID()}`); });

  it("lsp-hover resolves a project function declaration with its kind + signature + defined-at line", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "hover" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "h.ts", content: "const a = 1;\nfunction tally(x, y) {\n  return x + y;\n}" } }, ctx);
    const r = await lensRun("code", "lsp-hover", { params: { projectId, path: "h.ts", symbol: "tally" } }, ctx);
    assert.equal(r.result.found, true);
    assert.equal(r.result.kind, "function");
    assert.equal(r.result.source, "project");
    assert.equal(r.result.definedAt.line, 2);
    assert.ok(r.result.hover.includes("function") && r.result.hover.includes("tally"));
  });

  it("lsp-hover falls back to the builtin doc table for a runtime global (console)", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "hover-builtin" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "b.js", content: "let z = 0;" } }, ctx);
    const r = await lensRun("code", "lsp-hover", { params: { projectId, path: "b.js", symbol: "console" } }, ctx);
    assert.equal(r.result.found, true);
    assert.equal(r.result.source, "builtin");
    assert.equal(r.result.kind, "namespace");
    assert.equal(r.result.type, "Console");
  });

  it("lsp-hover reports found:false when no declaration and no builtin matches", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "hover-miss" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "m.js", content: "const q = 1;" } }, ctx);
    const r = await lensRun("code", "lsp-hover", { params: { projectId, path: "m.js", symbol: "nonexistentXyz" } }, ctx);
    assert.equal(r.result.found, false);
    assert.ok(r.result.hover.includes("no declaration found"));
  });

  it("lsp-signature returns the parsed parameter list of a project function", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "sig" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "s.ts", content: "function add(a, b) {\n  return a + b;\n}" } }, ctx);
    const r = await lensRun("code", "lsp-signature", { params: { projectId, symbol: "add" } }, ctx);
    assert.equal(r.result.found, true);
    assert.equal(r.result.source, "project");
    assert.deepEqual(r.result.parameters.map((p) => p.name), ["a", "b"]);
  });

  it("lsp-signature on a non-function symbol reports found:false with empty parameters", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "sig-miss" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "v.js", content: "const colorName = 'red';" } }, ctx);
    const r = await lensRun("code", "lsp-signature", { params: { projectId, symbol: "colorName" } }, ctx);
    assert.equal(r.result.found, false);
    assert.deepEqual(r.result.parameters, []);
  });

  it("diagnostics flags var/loose-equality/console as info+warning rules with line numbers", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "diag-rules" } }, ctx);
    const projectId = proj.result.project.id;
    // line1 var (info), line2 == (warning), line3 console.log (info) — balanced brackets.
    await lensRun("code", "files-write", { params: { projectId, path: "lint.js", content: "var x = 1;\nif (x == 2) {}\nconsole.log(x);" } }, ctx);
    const r = await lensRun("code", "diagnostics", { params: { projectId, path: "lint.js" } }, ctx);
    assert.ok(r.result.problems.some((p) => p.rule === "no-var" && p.line === 1 && p.severity === "info"));
    assert.ok(r.result.problems.some((p) => p.rule === "eqeqeq" && p.line === 2 && p.severity === "warning"));
    assert.ok(r.result.problems.some((p) => p.rule === "no-console" && p.line === 3 && p.severity === "info"));
    assert.equal(r.result.bySeverity.warning, 1);
  });

  it("diagnostics on clean balanced code reports zero problems", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "diag-clean" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "ok.js", content: "const sum = (a, b) => {\n  return a + b;\n};" } }, ctx);
    const r = await lensRun("code", "diagnostics", { params: { projectId, path: "ok.js" } }, ctx);
    assert.equal(r.result.total, 0);
    assert.equal(r.result.bySeverity.error, 0);
  });
});

describe("code — file/git delete + restore + layout (wave 7 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`code-del-${randomUUID()}`); });

  it("files-delete removes the file from the tree and rejects a re-read", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "fdel" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "gone.js", content: "bye" } }, ctx);
    const del = await lensRun("code", "files-delete", { params: { projectId, path: "gone.js" } }, ctx);
    assert.equal(del.result.deleted, true);
    const tree = await lensRun("code", "files-tree", { params: { projectId } }, ctx);
    assert.ok(!tree.result.tree.some((n) => n.path === "gone.js"));
    const read = await lensRun("code", "files-read", { params: { projectId, path: "gone.js" } }, ctx);
    assert.equal(read.result.ok, false);
    assert.match(read.result.error, /file not found/);
  });

  it("projects-delete removes the project; projects-list no longer shows it", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "pdel" } }, ctx);
    const projectId = proj.result.project.id;
    const del = await lensRun("code", "projects-delete", { params: { id: projectId } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("code", "projects-list", {}, ctx);
    assert.ok(!list.result.projects.some((p) => p.id === projectId));
    const again = await lensRun("code", "projects-delete", { params: { id: projectId } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /project not found/);
  });

  it("git-unstage moves a staged path back to modified", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "unstage" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "u.js", content: "x" } }, ctx);
    await lensRun("code", "git-stage", { params: { projectId, path: "u.js" } }, ctx);
    const un = await lensRun("code", "git-unstage", { params: { projectId, path: "u.js" } }, ctx);
    assert.ok(un.result.modified.includes("u.js"));
    assert.ok(!un.result.staged.includes("u.js"));
  });

  it("git-discard reverts a working edit back to the committed HEAD content", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "discard" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "d.js", content: "committed" } }, ctx);
    await lensRun("code", "git-stage", { params: { projectId, path: "d.js" } }, ctx);
    await lensRun("code", "git-commit", { params: { projectId, message: "base" } }, ctx);
    await lensRun("code", "files-write", { params: { projectId, path: "d.js", content: "dirty-edit" } }, ctx);
    const disc = await lensRun("code", "git-discard", { params: { projectId, path: "d.js" } }, ctx);
    assert.equal(disc.result.restored, true);
    const read = await lensRun("code", "files-read", { params: { projectId, path: "d.js" } }, ctx);
    assert.equal(read.result.content, "committed");
  });

  it("git-discard on a never-committed file removes it entirely", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "discard-new" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "fresh.js", content: "uncommitted" } }, ctx);
    const disc = await lensRun("code", "git-discard", { params: { projectId, path: "fresh.js" } }, ctx);
    assert.equal(disc.result.restored, false);
    const read = await lensRun("code", "files-read", { params: { projectId, path: "fresh.js" } }, ctx);
    assert.equal(read.result.ok, false);
    assert.match(read.result.error, /file not found/);
  });

  it("git-diff classifies a brand-new uncommitted file as 'added' with all lines added", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "diff-add" } }, ctx);
    const projectId = proj.result.project.id;
    await lensRun("code", "files-write", { params: { projectId, path: "new.js", content: "a\nb\nc" } }, ctx);
    const r = await lensRun("code", "git-diff", { params: { projectId, path: "new.js" } }, ctx);
    assert.equal(r.result.status, "added");   // committed side empty → status 'added'
    assert.equal(r.result.linesAdded, 3);     // a, b, c all added vs the empty HEAD
    assert.equal(r.result.unchanged, false);
  });

  it("layout-save normalizes panes (clamps to 4) and layout-get reads it back", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "layout" } }, ctx);
    const projectId = proj.result.project.id;
    const saved = await lensRun("code", "layout-save", {
      params: { projectId, orientation: "vertical", panes: [{ id: "p1", path: "a.js" }, { path: "b.js" }] },
    }, ctx);
    assert.equal(saved.result.layout.orientation, "vertical");
    assert.equal(saved.result.layout.panes.length, 2);
    assert.equal(saved.result.layout.panes[1].id, "pane-2");   // auto-id when omitted
    const got = await lensRun("code", "layout-get", { params: { projectId } }, ctx);
    assert.equal(got.result.layout.orientation, "vertical");
    assert.ok(got.result.layout.panes.some((p) => p.path === "a.js"));
  });

  it("layout-save with zero panes is rejected", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "layout-bad" } }, ctx);
    const projectId = proj.result.project.id;
    const bad = await lensRun("code", "layout-save", { params: { projectId, orientation: "grid", panes: [] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /at least one pane required/);
  });
});

describe("code — extensions/snippets/liveshare lifecycle (wave 7 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`code-life-${randomUUID()}`); });

  it("extensions-uninstall removes an installed extension; list no longer shows it", async () => {
    await lensRun("code", "extensions-install", { params: { extensionId: "todo-highlight" } }, ctx);
    const un = await lensRun("code", "extensions-uninstall", { params: { extensionId: "todo-highlight" } }, ctx);
    assert.equal(un.result.uninstalled, true);
    const list = await lensRun("code", "extensions-list", {}, ctx);
    assert.ok(!list.result.extensions.some((e) => e.id === "todo-highlight"));
    const again = await lensRun("code", "extensions-uninstall", { params: { extensionId: "todo-highlight" } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /not installed/);
  });

  it("snippets-save → snippets-delete removes it from the list", async () => {
    const saved = await lensRun("code", "snippets-save", { params: { title: `del-${randomUUID()}`, code: "x()", language: "javascript" } }, ctx);
    const id = saved.result.id;
    const del = await lensRun("code", "snippets-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("code", "snippets-list", { params: { language: "javascript" } }, ctx);
    assert.ok(!list.result.snippets.some((sn) => sn.id === id));
  });

  it("snippets-delete on an unknown id is rejected", async () => {
    const bad = await lensRun("code", "snippets-delete", { params: { id: "dtu_snip_does_not_exist" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /snippet not found/);
  });

  it("liveshare-end closes the session; a subsequent join is rejected as closed", async () => {
    const host = await depthCtx(`code-lsend-host-${randomUUID()}`);
    const proj = await lensRun("code", "projects-create", { params: { name: "lsend" } }, host);
    const session = await lensRun("code", "liveshare-start", { params: { projectId: proj.result.project.id, name: "pair" } }, host);
    const code = session.result.session.code;
    const ended = await lensRun("code", "liveshare-end", { params: { code } }, host);
    assert.equal(ended.result.session.status, "closed");
    const guest = await depthCtx(`code-lsend-guest-${randomUUID()}`);
    const bad = await lensRun("code", "liveshare-join", { params: { code } }, guest);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /session closed/);
  });

  it("liveshare-end by a non-host is rejected", async () => {
    const host = await depthCtx(`code-lsend2-host-${randomUUID()}`);
    const proj = await lensRun("code", "projects-create", { params: { name: "lsend2" } }, host);
    const session = await lensRun("code", "liveshare-start", { params: { projectId: proj.result.project.id } }, host);
    const code = session.result.session.code;
    const guest = await depthCtx(`code-lsend2-guest-${randomUUID()}`);
    await lensRun("code", "liveshare-join", { params: { code } }, guest);
    const bad = await lensRun("code", "liveshare-end", { params: { code } }, guest);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /only the host/);
  });

  it("multi-file-apply rewrites a snippet DTU's code in place and records a revision", async () => {
    const saved = await lensRun("code", "snippets-save", { params: { title: `mfa-${randomUUID()}`, code: "const v = 1;", language: "javascript" } }, ctx);
    const scriptId = saved.result.id;
    const r = await lensRun("code", "multi-file-apply", {
      params: { edits: [{ scriptId, filename: "v.js", after: "const v = 2;" }] },
    }, ctx);
    assert.equal(r.result.applied.length, 1);
    assert.equal(r.result.applied[0].bytes, "const v = 2;".length);
    assert.equal(r.result.applied[0].revision, 1);
  });

  it("multi-file-apply skips an edit whose scriptId is missing", async () => {
    const r = await lensRun("code", "multi-file-apply", {
      params: { edits: [{ scriptId: "dtu_missing_xyz", filename: "z.js", after: "x" }] },
    }, ctx);
    assert.equal(r.result.applied.length, 0);
    assert.ok(r.result.skipped.some((sk) => sk.reason === "scriptId not found"));
  });

  it("github-remote-status reports no remote for a fresh project", async () => {
    const proj = await lensRun("code", "projects-create", { params: { name: "remote" } }, ctx);
    const r = await lensRun("code", "github-remote-status", { params: { projectId: proj.result.project.id } }, ctx);
    assert.equal(r.result.hasRemote, false);
    assert.deepEqual(r.result.pushLog, []);
  });
});
