// Contract tests for the code-lens parity macros in server/domains/code.js.
//
// Covers: snippets CRUD, snapshots (commit + list), project-wide search
// (plain / regex / wholeword / case / include-exclude globs), code.exec
// JS sandbox (success + error + timeout), multi-file-plan (LLM-mocked +
// JSON-strictness + fenced-block extraction), multi-file-apply (revision
// trail + ownership), tab-completion (fenced strip + utility timeout).
//
// These are pure-Node Tier-2 contract tests; no server boot, no HTTP.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCodeActions from "../domains/code.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`code.${name}`);
  assert.ok(fn, `code.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerCodeActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const userA = "user_a";
const userB = "user_b";
function ctxFor(userId) {
  return { actor: { userId }, userId };
}

describe("code.snippets-list / save / delete", () => {
  it("save creates a kind=code_snippet DTU with creator + tags", () => {
    const r = call("snippets-save", ctxFor(userA), {
      title: "binary search",
      code: "function bs(a, t){...}",
      language: "javascript",
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.id.startsWith("dtu_snip_"));
    assert.equal(r.result.snippet.title, "binary search");
    assert.equal(r.result.snippet.language, "javascript");

    const stored = globalThis._concordSTATE.dtus.get(r.result.id);
    assert.equal(stored.machine.kind, "code_snippet");
    assert.equal(stored.creator_id, userA);
    assert.ok(stored.tags.includes("snippet"));
    assert.ok(stored.tags.includes("javascript"));
  });

  it("save rejects empty title or code", () => {
    assert.equal(call("snippets-save", ctxFor(userA), { title: "", code: "x" }).ok, false);
    assert.equal(call("snippets-save", ctxFor(userA), { title: "x", code: "" }).ok, false);
  });

  it("list filters by owner + language + limit; sorted newest first", () => {
    call("snippets-save", ctxFor(userA), { title: "ts1", code: "1", language: "typescript" });
    // backdate the previous one so the sort order is deterministic
    for (const dtu of globalThis._concordSTATE.dtus.values()) dtu.createdAt = "2024-01-01T00:00:00.000Z";
    call("snippets-save", ctxFor(userA), { title: "py1", code: "1", language: "python" });
    call("snippets-save", ctxFor(userA), { title: "ts2", code: "2", language: "typescript" });
    call("snippets-save", ctxFor(userB), { title: "ts3-other", code: "3", language: "typescript" });

    const ts = call("snippets-list", ctxFor(userA), { language: "typescript", limit: 10 });
    assert.equal(ts.ok, true);
    assert.equal(ts.result.snippets.length, 2);
    assert.deepEqual(ts.result.snippets.map(s => s.title), ["ts2", "ts1"]);

    const all = call("snippets-list", ctxFor(userA), { limit: 10 });
    assert.equal(all.result.snippets.length, 3);

    const limited = call("snippets-list", ctxFor(userA), { limit: 1 });
    assert.equal(limited.result.snippets.length, 1);
  });

  it("delete rejects non-owner; succeeds for owner; refuses non-snippet", () => {
    const created = call("snippets-save", ctxFor(userA), { title: "x", code: "y", language: "js" });
    const otherUser = call("snippets-delete", ctxFor(userB), { id: created.result.id });
    assert.equal(otherUser.ok, false);
    assert.match(otherUser.error, /owner/);

    const ok = call("snippets-delete", ctxFor(userA), { id: created.result.id });
    assert.equal(ok.ok, true);
    assert.equal(globalThis._concordSTATE.dtus.has(created.result.id), false);

    // Non-snippet DTU should be refused
    globalThis._concordSTATE.dtus.set("dtu_other", { id: "dtu_other", machine: { kind: "other" } });
    const rejected = call("snippets-delete", ctxFor(userA), { id: "dtu_other" });
    assert.equal(rejected.ok, false);
  });
});

describe("code.commit-snapshot / snapshots-list", () => {
  it("commit creates a kind=code_snapshot_bundle DTU with file count + author", () => {
    const r = call("commit-snapshot", ctxFor(userA), {
      message: "first cut",
      files: [
        { name: "a.js", language: "javascript", content: "console.log(1)\n" },
        { name: "b.js", language: "javascript", content: "console.log(2)\n", scriptId: "dtu_sid_x" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.snapshot.fileCount, 2);
    assert.equal(r.result.snapshot.message, "first cut");

    const stored = globalThis._concordSTATE.dtus.get(r.result.id);
    assert.equal(stored.machine.kind, "code_snapshot_bundle");
    assert.equal(stored.machine.files[1].scriptId, "dtu_sid_x");
  });

  it("commit rejects empty message or empty files", () => {
    assert.equal(call("commit-snapshot", ctxFor(userA), { message: "", files: [{ name: "x", content: "x" }] }).ok, false);
    assert.equal(call("commit-snapshot", ctxFor(userA), { message: "msg", files: [] }).ok, false);
  });

  it("list returns only the caller's snapshots, newest first", () => {
    call("commit-snapshot", ctxFor(userA), { message: "old", files: [{ name: "x.js", content: "1" }] });
    for (const dtu of globalThis._concordSTATE.dtus.values()) dtu.createdAt = "2024-01-01T00:00:00.000Z";
    call("commit-snapshot", ctxFor(userA), { message: "new", files: [{ name: "x.js", content: "2" }] });
    call("commit-snapshot", ctxFor(userB), { message: "other-user", files: [{ name: "x.js", content: "3" }] });

    const r = call("snapshots-list", ctxFor(userA), { limit: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.snapshots.length, 2);
    assert.deepEqual(r.result.snapshots.map(s => s.message), ["new", "old"]);
  });
});

describe("code.search-project", () => {
  const FILES = [
    { name: "src/a.js", language: "javascript", scriptId: "id1", content: "const Hello = 1;\nconst hello = 2;\n// HELLO comment\n" },
    { name: "src/b.ts", language: "typescript", scriptId: "id2", content: "function add(a: number, b: number) { return a + b; }\n// add comment\n" },
    { name: "test/x.spec.js", language: "javascript", scriptId: "id3", content: "describe('hello world', () => {});\n" },
  ];

  it("plain query is case-insensitive by default", () => {
    const r = call("search-project", ctxFor(userA), { query: "hello", files: FILES });
    assert.equal(r.ok, true);
    // 2 in a.js + 1 in a.js comment + 1 in x.spec.js = 4
    assert.equal(r.result.hits.length, 4);
    assert.equal(r.result.totalFiles, 3);
  });

  it("caseSensitive=true narrows results", () => {
    const r = call("search-project", ctxFor(userA), { query: "hello", caseSensitive: true, files: FILES });
    // Only "const hello = 2;" + "describe('hello world'…)" match — 2 hits
    assert.equal(r.result.hits.length, 2);
  });

  it("regex toggle accepts complex patterns and errors gracefully on invalid", () => {
    const ok = call("search-project", ctxFor(userA), { query: "h(e|E)llo", regex: true, files: FILES });
    assert.equal(ok.ok, true);
    assert.ok(ok.result.hits.length > 0);

    const bad = call("search-project", ctxFor(userA), { query: "h(", regex: true, files: FILES });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /regex/);
  });

  it("wholeWord excludes substring matches", () => {
    const r = call("search-project", ctxFor(userA), { query: "add", wholeWord: true, files: FILES });
    // "add" appears in b.ts twice as a whole word
    assert.ok(r.result.hits.every(h => /\badd\b/i.test(h.preview)));
  });

  it("includeGlobs filters by filename pattern", () => {
    const r = call("search-project", ctxFor(userA), { query: "hello", includeGlobs: ["**/*.spec.js"], files: FILES });
    assert.equal(r.result.hits.length, 1);
    assert.equal(r.result.hits[0].file, "test/x.spec.js");
  });

  it("excludeGlobs removes matches", () => {
    const r = call("search-project", ctxFor(userA), { query: "hello", excludeGlobs: ["test/**"], files: FILES });
    assert.ok(r.result.hits.every(h => !h.file.startsWith("test/")));
  });
});

describe("code.exec (JS sandbox)", () => {
  it("runs JS and captures console.log", () => {
    const r = call("exec", ctxFor(userA), { code: "console.log('hi'); console.log(1 + 2)", language: "javascript" });
    assert.equal(r.ok, true);
    assert.equal(r.result.exitCode, 0);
    assert.equal(r.result.stdout, "hi\n3");
    assert.equal(r.result.supported, true);
  });

  it("captures thrown errors as stderr with exitCode=1", () => {
    const r = call("exec", ctxFor(userA), { code: "throw new Error('boom')", language: "javascript" });
    assert.equal(r.result.exitCode, 1);
    assert.match(r.result.stderr, /Error: boom/);
  });

  it("times out runaway loops", () => {
    const r = call("exec", ctxFor(userA), { code: "while(true){}", language: "javascript" });
    assert.equal(r.result.exitCode, 1);
    assert.match(r.result.stderr, /timed?\s*out|Script execution timed out/i);
  });

  it("returns the last expression value when no logs", () => {
    const r = call("exec", ctxFor(userA), { code: "1 + 2 + 3", language: "javascript" });
    assert.equal(r.result.exitCode, 0);
    assert.equal(r.result.stdout, "6");
  });

  it("strips simple TS annotations before running", () => {
    const r = call("exec", ctxFor(userA), { code: "function add(a: number, b: number) { return a + b; }\nconsole.log(add(2, 3))", language: "typescript" });
    assert.equal(r.result.exitCode, 0);
    assert.equal(r.result.stdout, "5");
  });

  it("returns supported:false for languages outside the sandbox", () => {
    const r = call("exec", ctxFor(userA), { code: "print('x')", language: "python" });
    assert.equal(r.result.supported, false);
    assert.equal(r.result.exitCode, -1);
  });

  it("does not expose process / require / Buffer / global", () => {
    const r = call("exec", ctxFor(userA), { code: "typeof process + ',' + typeof require + ',' + typeof Buffer + ',' + typeof global", language: "javascript" });
    assert.equal(r.result.exitCode, 0);
    // All four are undefined in the sandbox
    assert.equal(r.result.stdout, "undefined,undefined,undefined,undefined");
  });
});

describe("code.multi-file-plan", () => {
  it("rejects when no prompt or files", async () => {
    const r1 = await call("multi-file-plan", ctxFor(userA), { prompt: "", files: [{}] });
    assert.equal(r1.ok, false);
    const r2 = await call("multi-file-plan", ctxFor(userA), { prompt: "x", files: [] });
    assert.equal(r2.ok, false);
  });

  it("rejects when llm unavailable", async () => {
    const r = await call("multi-file-plan", ctxFor(userA), { prompt: "x", files: [{ name: "a", content: "1" }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /llm/);
  });

  it("parses fenced JSON, validates filenames, drops invented files", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({ text: '```json\n{"edits":[{"filename":"a.js","language":"javascript","before":"console.log(1)","after":"console.log(2)","reason":"bump"}, {"filename":"NOT_REAL.js","before":"x","after":"y"}]}\n```' }) },
    };
    const r = await call("multi-file-plan", ctx, {
      prompt: "bump the log",
      files: [{ name: "a.js", language: "javascript", content: "console.log(1)", id: "scr1" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.edits.length, 1, "invented filename should be dropped");
    assert.equal(r.result.edits[0].filename, "a.js");
    assert.equal(r.result.edits[0].before, "console.log(1)");
    assert.equal(r.result.edits[0].after, "console.log(2)");
    assert.equal(r.result.edits[0].scriptId, "scr1");
    assert.equal(r.result.planned, 2);
    assert.equal(r.result.accepted, 1);
  });

  it("drops edits where after === before", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({ text: '{"edits":[{"filename":"a.js","before":"x","after":"x"}]}' }) },
    };
    const r = await call("multi-file-plan", ctx, {
      prompt: "noop",
      files: [{ name: "a.js", language: "javascript", content: "x" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.edits.length, 0);
  });

  it("returns parse error when llm output is not JSON", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({ text: "Sorry, I cannot help with that." }) },
    };
    const r = await call("multi-file-plan", ctx, {
      prompt: "x",
      files: [{ name: "a.js", language: "javascript", content: "y" }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /parse/);
  });
});

describe("code.multi-file-apply", () => {
  it("rejects when no edits", () => {
    const r = call("multi-file-apply", ctxFor(userA), { edits: [] });
    assert.equal(r.ok, false);
  });

  it("updates the DTU code, pushes revision row, and is idempotent across calls", () => {
    const sid = "dtu_sid_target";
    globalThis._concordSTATE.dtus.set(sid, {
      id: sid,
      creator_id: userA,
      machine: { code: "old code", kind: "code_snippet" },
      data: { content: "old code" },
    });

    const r1 = call("multi-file-apply", ctxFor(userA), {
      edits: [{ scriptId: sid, filename: "a.js", after: "new code v1", reason: "refactor" }],
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.applied.length, 1);
    const dtu = globalThis._concordSTATE.dtus.get(sid);
    assert.equal(dtu.machine.code, "new code v1");
    assert.equal(dtu.machine.revisions.length, 1);
    assert.equal(dtu.machine.revisions[0].before, "old code");
    assert.equal(dtu.machine.revisions[0].reason, "refactor");

    const r2 = call("multi-file-apply", ctxFor(userA), {
      edits: [{ scriptId: sid, filename: "a.js", after: "new code v2" }],
    });
    assert.equal(r2.ok, true);
    assert.equal(dtu.machine.revisions.length, 2);
    assert.equal(dtu.machine.code, "new code v2");
  });

  it("skips edits owned by another user and reports them", () => {
    const sid = "dtu_sid_owned";
    globalThis._concordSTATE.dtus.set(sid, {
      id: sid,
      creator_id: userB,
      machine: { code: "x", kind: "code_snippet" },
    });
    const r = call("multi-file-apply", ctxFor(userA), {
      edits: [{ scriptId: sid, filename: "x", after: "y" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.applied.length, 0);
    assert.equal(r.result.skipped.length, 1);
    assert.match(r.result.skipped[0].reason, /owner/);
  });

  it("skips empty after content", () => {
    const sid = "dtu_sid_empty";
    globalThis._concordSTATE.dtus.set(sid, {
      id: sid, creator_id: userA, machine: { code: "x", kind: "code_snippet" },
    });
    const r = call("multi-file-apply", ctxFor(userA), {
      edits: [{ scriptId: sid, filename: "x", after: "   " }],
    });
    assert.equal(r.result.applied.length, 0);
    assert.match(r.result.skipped[0].reason, /empty/);
  });
});

describe("code.tab-completion", () => {
  it("returns empty completion when prefix is blank", async () => {
    const r = await call("tab-completion", ctxFor(userA), { prefix: "" });
    assert.equal(r.ok, true);
    assert.equal(r.result.completion, "");
  });

  it("returns empty completion when llm unavailable (graceful degradation)", async () => {
    const r = await call("tab-completion", ctxFor(userA), { prefix: "function foo()" });
    assert.equal(r.ok, true);
    assert.equal(r.result.completion, "");
  });

  it("strips ```lang fenced wrappers from utility output", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({ text: "```javascript\n  return 42;\n```" }) },
    };
    const r = await call("tab-completion", ctx, { prefix: "function foo() {", language: "javascript", maxTokens: 32 });
    assert.equal(r.ok, true);
    assert.equal(r.result.completion, "return 42;");
  });

  it("never throws — even on llm error returns ok:true with empty completion", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => { throw new Error("ollama down"); } },
    };
    const r = await call("tab-completion", ctx, { prefix: "foo", language: "javascript" });
    assert.equal(r.ok, true);
    assert.equal(r.result.completion, "");
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("complexityAnalysis returns analyzed modules for non-empty input", () => {
    const r = ACTIONS.get("code.complexityAnalysis")(ctxFor(userA), {
      data: { modules: [{ name: "m1", lines: 100, functions: 5, branches: 3, loops: 2, nestingDepth: 2 }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.modules.length, 1);
    assert.ok(r.result.modules[0].cyclomaticComplexity > 0);
  });

  it("dependencyAudit flags risky licenses + outdated versions", () => {
    const r = ACTIONS.get("code.dependencyAudit")(ctxFor(userA), {
      data: { dependencies: [
        { name: "a", version: "1.0.0", latest: "3.0.0", license: "MIT" },
        { name: "b", version: "1.0.0", license: "GPL-3.0" },
      ] },
    }, {});
    assert.equal(r.ok, true);
    const a = r.result.dependencies.find(d => d.name === "a");
    const b = r.result.dependencies.find(d => d.name === "b");
    assert.ok(a.issues.some(i => i.type === "major_version_behind"));
    assert.ok(b.issues.some(i => i.type === "copyleft_license"));
  });

  it("coverageAnalysis aggregates statement + branch coverage", () => {
    const r = ACTIONS.get("code.coverageAnalysis")(ctxFor(userA), {
      data: { coverage: [
        { file: "a.js", statements: 100, statementsHit: 90, branches: 20, branchesHit: 15, functions: 10, functionsHit: 9 },
      ] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.overall.statementCoverage, 90);
  });

  it("changeRiskAssessment emits a recommendation when coverage is missing", () => {
    const r = ACTIONS.get("code.changeRiskAssessment")(ctxFor(userA), {
      data: { changes: [{ file: "a.js", linesAdded: 600, linesRemoved: 0, hasCoverage: false }] },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.recommendations.some(rec => /tests/i.test(rec)));
    assert.equal(r.result.overallRisk, "critical");
  });
});

// ═════════════════════════════════════════════════════════════════
//  Cursor / VS Code 2026 parity — workspace, files, git, agent.
// ═════════════════════════════════════════════════════════════════

const ctxC = { actor: { userId: "code_user" }, userId: "code_user" };

describe("code — projects + virtual workspace", () => {
  it("creates a project and scaffolds initial files", () => {
    const r = call("projects-create", ctxC, { name: "MyApp", scaffold: "node-ts" });
    assert.equal(r.ok, true);
    const tree = call("files-tree", ctxC, { projectId: r.result.project.id });
    assert.ok(tree.result.tree.find(f => f.path === "src/index.ts"));
    assert.ok(tree.result.tree.find(f => f.path === "package.json"));
  });

  it("lists per-user (multi-tenant isolation)", () => {
    call("projects-create", ctxC, { name: "A" });
    assert.equal(call("projects-list", ctxC).result.projects.length, 1);
    const ctxOther = { actor: { userId: "other" }, userId: "other" };
    assert.equal(call("projects-list", ctxOther).result.projects.length, 0);
  });
});

describe("code — files CRUD", () => {
  it("writes, reads, renames, deletes a file", () => {
    const proj = call("projects-create", ctxC, { name: "X" }).result.project;
    const w = call("files-write", ctxC, { projectId: proj.id, path: "src/foo.ts", content: "export const x = 1;\n" });
    assert.equal(w.ok, true); assert.equal(w.result.created, true);
    const r = call("files-read", ctxC, { projectId: proj.id, path: "src/foo.ts" });
    assert.equal(r.result.content, "export const x = 1;\n");
    assert.equal(r.result.language, "typescript");
    const ren = call("files-rename", ctxC, { projectId: proj.id, from: "src/foo.ts", to: "src/bar.ts" });
    assert.equal(ren.ok, true);
    assert.equal(call("files-read", ctxC, { projectId: proj.id, path: "src/foo.ts" }).ok, false);
    assert.equal(call("files-read", ctxC, { projectId: proj.id, path: "src/bar.ts" }).ok, true);
    const del = call("files-delete", ctxC, { projectId: proj.id, path: "src/bar.ts" });
    assert.equal(del.ok, true);
  });

  it("rejects content > 1MB", () => {
    const proj = call("projects-create", ctxC, { name: "X" }).result.project;
    const big = "x".repeat(1_100_000);
    const w = call("files-write", ctxC, { projectId: proj.id, path: "big.txt", content: big });
    assert.equal(w.ok, false);
    assert.match(w.error, /too large/);
  });
});

describe("code — virtual git", () => {
  it("status / stage / commit workflow", () => {
    const proj = call("projects-create", ctxC, { name: "Git" }).result.project;
    call("files-write", ctxC, { projectId: proj.id, path: "a.txt", content: "hi" });
    const status1 = call("git-status", ctxC, { projectId: proj.id });
    assert.equal(status1.result.modified.length, 1);
    assert.equal(status1.result.clean, false);
    call("git-stage", ctxC, { projectId: proj.id });
    const status2 = call("git-status", ctxC, { projectId: proj.id });
    assert.equal(status2.result.staged.length, 1);
    const commit = call("git-commit", ctxC, { projectId: proj.id, message: "first commit" });
    assert.equal(commit.ok, true);
    assert.match(commit.result.commit.number, /^C-\d{5}$/);
    const status3 = call("git-status", ctxC, { projectId: proj.id });
    assert.equal(status3.result.staged.length, 0);
    assert.equal(status3.result.clean, true);
    const log = call("git-log", ctxC, { projectId: proj.id });
    assert.equal(log.result.log.length, 1);
  });

  it("rejects empty commit", () => {
    const proj = call("projects-create", ctxC, { name: "X" }).result.project;
    const r = call("git-commit", ctxC, { projectId: proj.id, message: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /nothing staged/);
  });

  it("creates and switches branches", () => {
    const proj = call("projects-create", ctxC, { name: "X" }).result.project;
    call("git-branch-create", ctxC, { projectId: proj.id, name: "feature", checkout: true });
    const s = call("git-status", ctxC, { projectId: proj.id });
    assert.equal(s.result.branch, "feature");
    assert.deepEqual(s.result.branches.sort(), ["feature", "main"]);
  });
});

describe("code — agent tasks (Composer parity)", () => {
  it("agent-task-start builds a deterministic plan without brain", async () => {
    const proj = call("projects-create", ctxC, { name: "X" }).result.project;
    const r = await call("agent-task-start", ctxC, { projectId: proj.id, prompt: "Refactor auth to JWT and add tests" });
    assert.equal(r.ok, true);
    assert.equal(r.result.task.status, "running");
    assert.equal(r.result.task.source, "deterministic");
    const actions = r.result.task.plan.map(p => p.action);
    assert.ok(actions.includes("refactor"));
    assert.ok(actions.includes("tests"));
  });

  it("agent-task-finish marks status + records files changed", async () => {
    const proj = call("projects-create", ctxC, { name: "X" }).result.project;
    const t = await call("agent-task-start", ctxC, { projectId: proj.id, prompt: "fix bug" });
    const fin = call("agent-task-finish", ctxC, { id: t.result.task.id, status: "completed", filesChanged: ["src/a.ts", "src/b.ts"] });
    assert.equal(fin.result.task.status, "completed");
    assert.equal(fin.result.task.filesChanged.length, 2);
  });
});

describe("code — inline-edit + explain + refactor + tests + format", () => {
  it("format-code normalizes tabs + trailing whitespace + final newline", () => {
    const code = "function x() {\n\treturn 1;   \n}";
    const r = call("format-code", ctxC, { code, language: "javascript" });
    assert.equal(r.ok, true);
    assert.ok(r.result.formatted.endsWith("\n"));
    assert.ok(!r.result.formatted.includes("\t"));
  });

  it("explain returns deterministic result when no brain", async () => {
    const r = await call("explain", ctxC, { code: "function add(a, b) { return a + b; }", path: "src/add.js" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "deterministic");
  });

  it("explain brain-backed when ctx.llm.chat present", async () => {
    const ctxBrain = { ...ctxC, llm: { chat: async () => ({ content: "Adds two numbers." }) } };
    const r = await call("explain", ctxBrain, { code: "f(a,b){return a+b}" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "brain");
    assert.equal(r.result.explanation, "Adds two numbers.");
  });

  it("inline-edit rejects without brain", async () => {
    const r = await call("inline-edit", ctxC, { code: "x", instruction: "make it Y" });
    assert.equal(r.ok, false);
  });

  it("inline-edit strips code fences from brain output", async () => {
    const ctxBrain = { ...ctxC, llm: { chat: async () => ({ content: "```ts\nconst y = 2;\n```" }) } };
    const r = await call("inline-edit", ctxBrain, { code: "const x = 1;", instruction: "rename x to y", language: "typescript" });
    assert.equal(r.ok, true);
    assert.equal(r.result.edited, "const y = 2;");
  });
});

describe("code — find-references", () => {
  it("finds symbol across files (word boundary aware)", () => {
    const proj = call("projects-create", ctxC, { name: "X" }).result.project;
    call("files-write", ctxC, { projectId: proj.id, path: "src/a.ts", content: "export function deeplyNamed() { return 1; }" });
    call("files-write", ctxC, { projectId: proj.id, path: "src/b.ts", content: "import { deeplyNamed } from './a';\ndeeplyNamed();" });
    call("files-write", ctxC, { projectId: proj.id, path: "src/c.ts", content: "// unrelated" });
    const r = call("find-references", ctxC, { projectId: proj.id, symbol: "deeplyNamed" });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 3); // a (decl) + b (import + call)
    assert.ok(r.result.references.every(ref => ref.path.startsWith("src/")));
  });
});

describe("code — workspace-summary", () => {
  it("aggregates projects, files, tasks", async () => {
    const p = call("projects-create", ctxC, { name: "X" }).result.project;
    call("files-write", ctxC, { projectId: p.id, path: "f.ts", content: "x" });
    await call("agent-task-start", ctxC, { projectId: p.id, prompt: "test" });
    const r = call("workspace-summary", ctxC);
    assert.equal(r.ok, true);
    assert.ok(r.result.projectCount >= 1);
    assert.ok(r.result.fileCount >= 1);
    assert.equal(r.result.runningTasks, 1);
  });
});

describe("code — symbols-outline", () => {
  it("extracts functions, classes and methods", () => {
    const p = call("projects-create", ctxC, { name: "S" }).result.project;
    const src = [
      "export class Widget {",
      "  render() { return 1; }",
      "}",
      "export function build() { return new Widget(); }",
      "const helper = (x) => x * 2;",
    ].join("\n");
    call("files-write", ctxC, { projectId: p.id, path: "src/w.ts", content: src });
    const r = call("symbols-outline", ctxC, { projectId: p.id, path: "src/w.ts" });
    assert.equal(r.ok, true);
    const names = r.result.symbols.map((x) => x.name);
    assert.ok(names.includes("Widget"));
    assert.ok(names.includes("build"));
    assert.ok(names.includes("helper"));
    assert.ok(names.includes("render"));
  });
});

describe("code — diagnostics", () => {
  it("flags debugger, console, var, loose equality and unbalanced brackets", () => {
    const p = call("projects-create", ctxC, { name: "D" }).result.project;
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "var x = 1;\nif (x == 1) { debugger; console.log(x); }\n" });
    call("files-write", ctxC, { projectId: p.id, path: "b.js", content: "function broken() { return 1;\n" });
    const r = call("diagnostics", ctxC, { projectId: p.id });
    assert.equal(r.ok, true);
    const rules = r.result.problems.map((x) => x.rule);
    assert.ok(rules.includes("no-debugger"));
    assert.ok(rules.includes("no-var"));
    assert.ok(rules.includes("eqeqeq"));
    assert.ok(rules.includes("bracket-balance"));
    assert.ok(r.result.bySeverity.error >= 1);
  });

  it("scans a single file when path given", () => {
    const p = call("projects-create", ctxC, { name: "D" }).result.project;
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "debugger;\n" });
    call("files-write", ctxC, { projectId: p.id, path: "b.js", content: "const ok = 1;\n" });
    const r = call("diagnostics", ctxC, { projectId: p.id, path: "b.js" });
    assert.equal(r.result.filesScanned, 1);
    assert.equal(r.result.total, 0);
  });
});

describe("code — todo-scan", () => {
  it("collects TODO / FIXME tagged comments", () => {
    const p = call("projects-create", ctxC, { name: "T" }).result.project;
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "// TODO: wire this up\nconst x = 1; // FIXME later\n" });
    const r = call("todo-scan", ctxC, { projectId: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.equal(r.result.byTag.TODO, 1);
    assert.equal(r.result.byTag.FIXME, 1);
  });
});

describe("code — replace-project + rename-symbol", () => {
  it("replaces across the project with a dry-run mode", () => {
    const p = call("projects-create", ctxC, { name: "R" }).result.project;
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "color color color" });
    const dry = call("replace-project", ctxC, { projectId: p.id, query: "color", replacement: "colour", dryRun: true });
    assert.equal(dry.result.totalReplacements, 3);
    assert.equal(call("files-read", ctxC, { projectId: p.id, path: "a.js" }).result.content, "color color color");
    call("replace-project", ctxC, { projectId: p.id, query: "color", replacement: "colour" });
    assert.equal(call("files-read", ctxC, { projectId: p.id, path: "a.js" }).result.content, "colour colour colour");
  });

  it("renames a symbol project-wide, word-boundary aware", () => {
    const p = call("projects-create", ctxC, { name: "R" }).result.project;
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "const total = 1; const subtotal = total;" });
    const r = call("rename-symbol", ctxC, { projectId: p.id, from: "total", to: "sum" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalOccurrences, 2); // not "subtotal"
    assert.equal(call("files-read", ctxC, { projectId: p.id, path: "a.js" }).result.content, "const sum = 1; const subtotal = sum;");
  });

  it("rejects an invalid rename target", () => {
    const p = call("projects-create", ctxC, { name: "R" }).result.project;
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "x" });
    assert.equal(call("rename-symbol", ctxC, { projectId: p.id, from: "x", to: "2bad" }).ok, false);
  });
});

describe("code — git diff / blame / discard", () => {
  function committedProject() {
    const p = call("projects-create", ctxC, { name: "G" }).result.project;
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "line1\nline2\nline3\n" });
    call("git-stage", ctxC, { projectId: p.id });
    call("git-commit", ctxC, { projectId: p.id, message: "init" });
    return p;
  }

  it("diffs a working file against HEAD", () => {
    const p = committedProject();
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "line1\nCHANGED\nline3\n" });
    const r = call("git-diff", ctxC, { projectId: p.id, path: "a.js" });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "modified");
    assert.equal(r.result.linesAdded, 1);
    assert.equal(r.result.linesRemoved, 1);
  });

  it("blames lines to the commit that introduced them", () => {
    const p = committedProject();
    const r = call("git-blame", ctxC, { projectId: p.id, path: "a.js" });
    assert.equal(r.ok, true);
    assert.ok(r.result.blame[0].commitId);
    assert.equal(r.result.blame[0].message, "init");
  });

  it("discards working changes back to HEAD", () => {
    const p = committedProject();
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "trashed" });
    call("git-discard", ctxC, { projectId: p.id, path: "a.js" });
    assert.equal(call("files-read", ctxC, { projectId: p.id, path: "a.js" }).result.content, "line1\nline2\nline3\n");
  });
});

describe("code — git stash", () => {
  it("stashes working changes, reverts files, then pops them back", () => {
    const p = call("projects-create", ctxC, { name: "St" }).result.project;
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "v1" });
    call("git-stage", ctxC, { projectId: p.id });
    call("git-commit", ctxC, { projectId: p.id, message: "init" });
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "v2-wip" });
    const stash = call("git-stash", ctxC, { projectId: p.id, message: "wip" });
    assert.equal(stash.ok, true);
    assert.equal(call("files-read", ctxC, { projectId: p.id, path: "a.js" }).result.content, "v1");
    assert.equal(call("git-stash-list", ctxC, { projectId: p.id }).result.stashes.length, 1);
    call("git-stash-pop", ctxC, { projectId: p.id });
    assert.equal(call("files-read", ctxC, { projectId: p.id, path: "a.js" }).result.content, "v2-wip");
    assert.equal(call("git-stash-list", ctxC, { projectId: p.id }).result.stashes.length, 0);
  });
});

describe("code — git branch isolation + merge", () => {
  it("isolates file content per branch and merges cleanly", () => {
    const p = call("projects-create", ctxC, { name: "Br" }).result.project;
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "base" });
    call("git-stage", ctxC, { projectId: p.id });
    call("git-commit", ctxC, { projectId: p.id, message: "base" });
    // branch + diverge
    call("git-branch-create", ctxC, { projectId: p.id, name: "feature", checkout: true });
    call("files-write", ctxC, { projectId: p.id, path: "b.js", content: "feature work" });
    call("git-stage", ctxC, { projectId: p.id });
    call("git-commit", ctxC, { projectId: p.id, message: "feature" });
    // main does not have b.js
    call("git-checkout", ctxC, { projectId: p.id, branch: "main" });
    assert.equal(call("files-read", ctxC, { projectId: p.id, path: "b.js" }).ok, false);
    // merge feature into main
    const m = call("git-merge", ctxC, { projectId: p.id, from: "feature" });
    assert.equal(m.ok, true);
    assert.equal(call("files-read", ctxC, { projectId: p.id, path: "b.js" }).result.content, "feature work");
  });

  it("detects a merge conflict when both branches change the same file", () => {
    const p = call("projects-create", ctxC, { name: "Cf" }).result.project;
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "base" });
    call("git-stage", ctxC, { projectId: p.id });
    call("git-commit", ctxC, { projectId: p.id, message: "base" });
    call("git-branch-create", ctxC, { projectId: p.id, name: "feature" });
    // main changes a.js
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "main change" });
    call("git-stage", ctxC, { projectId: p.id });
    call("git-commit", ctxC, { projectId: p.id, message: "main edit" });
    // feature changes a.js differently
    call("git-checkout", ctxC, { projectId: p.id, branch: "feature" });
    call("files-write", ctxC, { projectId: p.id, path: "a.js", content: "feature change" });
    call("git-stage", ctxC, { projectId: p.id });
    call("git-commit", ctxC, { projectId: p.id, message: "feature edit" });
    call("git-checkout", ctxC, { projectId: p.id, branch: "main" });
    const m = call("git-merge", ctxC, { projectId: p.id, from: "feature" });
    assert.equal(m.ok, false);
    assert.ok(m.conflicts.includes("a.js"));
  });
});

describe("code — run configs + bookmarks", () => {
  it("saves, lists and deletes run configurations", () => {
    const p = call("projects-create", ctxC, { name: "Rc" }).result.project;
    const c = call("run-config-save", ctxC, { projectId: p.id, name: "Test", command: "npm test" }).result.config;
    assert.equal(call("run-config-list", ctxC, { projectId: p.id }).result.configs.length, 1);
    call("run-config-save", ctxC, { projectId: p.id, id: c.id, name: "Test", command: "npm run test:ci" });
    assert.equal(call("run-config-list", ctxC, { projectId: p.id }).result.configs[0].command, "npm run test:ci");
    call("run-config-delete", ctxC, { projectId: p.id, id: c.id });
    assert.equal(call("run-config-list", ctxC, { projectId: p.id }).result.configs.length, 0);
  });

  it("adds, dedupes, lists and deletes bookmarks", () => {
    const p = call("projects-create", ctxC, { name: "Bm" }).result.project;
    const b = call("bookmark-add", ctxC, { projectId: p.id, path: "a.js", line: 10, label: "entry" }).result.bookmark;
    const dup = call("bookmark-add", ctxC, { projectId: p.id, path: "a.js", line: 10 });
    assert.equal(dup.result.existed, true);
    assert.equal(call("bookmark-list", ctxC, { projectId: p.id }).result.bookmarks.length, 1);
    call("bookmark-delete", ctxC, { projectId: p.id, id: b.id });
    assert.equal(call("bookmark-list", ctxC, { projectId: p.id }).result.bookmarks.length, 0);
  });
});
