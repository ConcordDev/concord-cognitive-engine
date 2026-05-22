// Contract tests for server/domains/repos.js — the Concord repo substrate
// (GitHub-shape experience over DTUs): repo lifecycle, file tree + viewer,
// branch/tag mgmt, commit graph, issue lifecycle, PR diff/review/merge,
// CI workflow runs + logs, security scan, repo insights. Plus the
// pure-compute analysis macros and real GitHub API integrations.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerReposActions from "../domains/repos.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`repos.${name}`);
  if (!fn) throw new Error(`repos.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerReposActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

// Helper: spin up a repo and return its id.
function freshRepo(name = "demo") {
  const r = call("repo-create", ctxA, { name });
  assert.equal(r.ok, true);
  return r.result.repo.id;
}

describe("repos — repo lifecycle", () => {
  it("creates a repo seeded with a real file tree + main branch", () => {
    const r = call("repo-create", ctxA, { name: "alpha", description: "hello" });
    assert.equal(r.ok, true);
    assert.ok(r.result.repo.id);
    assert.equal(r.result.repo.defaultBranch, "main");
  });

  it("rejects repo-create without a name", () => {
    assert.equal(call("repo-create", ctxA, {}).ok, false);
  });

  it("lists repos for the user", () => {
    freshRepo("one");
    freshRepo("two");
    const r = call("repo-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
  });
});

describe("repos — file tree + code viewer", () => {
  it("file-tree returns a nested tree", () => {
    const id = freshRepo();
    const r = call("file-tree", ctxA, { repoId: id });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.tree));
    assert.ok(r.result.fileCount > 0);
  });

  it("file-read returns content + language + line count", () => {
    const id = freshRepo();
    const r = call("file-read", ctxA, { repoId: id, path: "README.md" });
    assert.equal(r.ok, true);
    assert.equal(r.result.language, "Markdown");
    assert.ok(r.result.lineCount >= 1);
  });

  it("file-save commits a change and creates a new commit", () => {
    const id = freshRepo();
    const r = call("file-save", ctxA, { repoId: id, path: "src/index.ts", content: "export const x = 1;\n", message: "tweak" });
    assert.equal(r.ok, true);
    assert.equal(r.result.saved, true);
    assert.ok(r.result.commit.sha);
  });

  it("file-save can create a brand-new file", () => {
    const id = freshRepo();
    const r = call("file-save", ctxA, { repoId: id, path: "docs/new.md", content: "# new\n" });
    assert.equal(r.ok, true);
    const read = call("file-read", ctxA, { repoId: id, path: "docs/new.md" });
    assert.equal(read.ok, true);
  });

  it("file-read on a missing path fails cleanly", () => {
    const id = freshRepo();
    assert.equal(call("file-read", ctxA, { repoId: id, path: "nope.txt" }).ok, false);
  });
});

describe("repos — branch + tag + commit graph", () => {
  it("branch-list returns main as default", () => {
    const id = freshRepo();
    const r = call("branch-list", ctxA, { repoId: id });
    assert.equal(r.ok, true);
    assert.ok(r.result.branches.some((b) => b.isDefault && b.name === "main"));
  });

  it("branch-create adds a branch", () => {
    const id = freshRepo();
    const r = call("branch-create", ctxA, { repoId: id, name: "feature" });
    assert.equal(r.ok, true);
    assert.equal(r.result.branch.name, "feature");
  });

  it("branch-create rejects duplicate names", () => {
    const id = freshRepo();
    call("branch-create", ctxA, { repoId: id, name: "dup" });
    assert.equal(call("branch-create", ctxA, { repoId: id, name: "dup" }).ok, false);
  });

  it("tag-create adds a tag", () => {
    const id = freshRepo();
    const r = call("tag-create", ctxA, { repoId: id, name: "v1.0.0" });
    assert.equal(r.ok, true);
    assert.equal(r.result.tag.name, "v1.0.0");
  });

  it("commit-graph returns nodes with lanes", () => {
    const id = freshRepo();
    const r = call("commit-graph", ctxA, { repoId: id });
    assert.equal(r.ok, true);
    assert.ok(r.result.totalCommits >= 1);
    assert.ok(typeof r.result.branchLanes === "object");
  });
});

describe("repos — issue lifecycle", () => {
  it("issue-create + issue-list + issue-detail round-trip", () => {
    const id = freshRepo();
    const created = call("issue-create", ctxA, { repoId: id, title: "Bug here", body: "broken" });
    assert.equal(created.ok, true);
    const num = created.result.issue.number;
    const list = call("issue-list", ctxA, { repoId: id, state: "open" });
    assert.equal(list.ok, true);
    assert.equal(list.result.open, 1);
    const detail = call("issue-detail", ctxA, { repoId: id, number: num });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.issue.title, "Bug here");
  });

  it("issue-comment appends a comment", () => {
    const id = freshRepo();
    const num = call("issue-create", ctxA, { repoId: id, title: "X" }).result.issue.number;
    const r = call("issue-comment", ctxA, { repoId: id, number: num, body: "me too" });
    assert.equal(r.ok, true);
    assert.equal(r.result.commentCount, 1);
  });

  it("issue-set-state closes an issue", () => {
    const id = freshRepo();
    const num = call("issue-create", ctxA, { repoId: id, title: "X" }).result.issue.number;
    const r = call("issue-set-state", ctxA, { repoId: id, number: num, state: "closed" });
    assert.equal(r.ok, true);
    assert.equal(r.result.state, "closed");
  });

  it("issue-create rejects empty title", () => {
    const id = freshRepo();
    assert.equal(call("issue-create", ctxA, { repoId: id, title: "" }).ok, false);
  });
});

describe("repos — pull request diff / review / merge", () => {
  it("pull-create + pull-detail expose a diff", () => {
    const id = freshRepo();
    call("branch-create", ctxA, { repoId: id, name: "feat" });
    call("file-save", ctxA, { repoId: id, path: "src/feat.ts", content: "export const f = 1;\n", branch: "feat" });
    const created = call("pull-create", ctxA, { repoId: id, title: "Add feat", head: "feat" });
    assert.equal(created.ok, true);
    const detail = call("pull-detail", ctxA, { repoId: id, number: created.result.pull.number });
    assert.equal(detail.ok, true);
    assert.ok(detail.result.diff.fileCount >= 0);
  });

  it("pull-review records an approval and pull-merge merges", () => {
    const id = freshRepo();
    call("branch-create", ctxA, { repoId: id, name: "feat" });
    call("file-save", ctxA, { repoId: id, path: "src/feat.ts", content: "x\n", branch: "feat" });
    const num = call("pull-create", ctxA, { repoId: id, title: "Add feat", head: "feat" }).result.pull.number;
    const review = call("pull-review", ctxA, { repoId: id, number: num, verdict: "approve" });
    assert.equal(review.ok, true);
    const merged = call("pull-merge", ctxA, { repoId: id, number: num });
    assert.equal(merged.ok, true);
    assert.equal(merged.result.merged, true);
  });

  it("pull-merge is blocked when changes are requested", () => {
    const id = freshRepo();
    call("branch-create", ctxA, { repoId: id, name: "feat" });
    call("file-save", ctxA, { repoId: id, path: "src/feat.ts", content: "x\n", branch: "feat" });
    const num = call("pull-create", ctxA, { repoId: id, title: "Add feat", head: "feat" }).result.pull.number;
    call("pull-review", ctxA, { repoId: id, number: num, verdict: "request-changes" });
    assert.equal(call("pull-merge", ctxA, { repoId: id, number: num }).ok, false);
  });

  it("pull-create rejects head === base", () => {
    const id = freshRepo();
    assert.equal(call("pull-create", ctxA, { repoId: id, title: "X", head: "main", base: "main" }).ok, false);
  });

  it("pull-list reports counts", () => {
    const id = freshRepo();
    const r = call("pull-list", ctxA, { repoId: id, state: "all" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });
});

describe("repos — CI workflow runs + logs", () => {
  it("workflow-run executes and workflow-runs lists it", () => {
    const id = freshRepo();
    const run = call("workflow-run", ctxA, { repoId: id, workflow: "CI" });
    assert.equal(run.ok, true);
    const runs = call("workflow-runs", ctxA, { repoId: id });
    assert.equal(runs.ok, true);
    assert.equal(runs.result.count, 1);
  });

  it("workflow-logs returns steps with logs", () => {
    const id = freshRepo();
    const runId = call("workflow-run", ctxA, { repoId: id }).result.run.id;
    const logs = call("workflow-logs", ctxA, { repoId: id, runId });
    assert.equal(logs.ok, true);
    assert.ok(Array.isArray(logs.result.steps));
    assert.ok(logs.result.steps.length > 0);
  });

  it("workflow-logs fails on unknown run", () => {
    const id = freshRepo();
    assert.equal(call("workflow-logs", ctxA, { repoId: id, runId: "nope" }).ok, false);
  });
});

describe("repos — security scan", () => {
  it("security-scan flags hardcoded secrets via code scanning", () => {
    const id = freshRepo();
    call("file-save", ctxA, { repoId: id, path: "src/leak.ts", content: 'const password = "hunter2";\n' });
    const r = call("security-scan", ctxA, { repoId: id });
    assert.equal(r.ok, true);
    assert.ok(r.result.codeScanning.some((a) => a.rule === "hardcoded-secret"));
  });

  it("security-scan flags vulnerable dependencies via Dependabot DB", () => {
    const id = freshRepo();
    call("file-save", ctxA, { repoId: id, path: "package.json", content: JSON.stringify({ dependencies: { lodash: "4.17.11" } }) });
    const r = call("security-scan", ctxA, { repoId: id });
    assert.equal(r.ok, true);
    assert.ok(r.result.dependabot.some((a) => a.package === "lodash"));
  });
});

describe("repos — insights", () => {
  it("repo-insights returns contributors, activity, and language breakdown", () => {
    const id = freshRepo();
    const r = call("repo-insights", ctxA, { repoId: id });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.contributors));
    assert.equal(r.result.commitActivity.length, 12);
    assert.ok(Array.isArray(r.result.languages));
  });
});

describe("repos — substrate macros are user-scoped", () => {
  it("a different user cannot see another user's repos", () => {
    freshRepo("private-thing");
    const other = { actor: { userId: "user_b" }, userId: "user_b" };
    const r = call("repo-list", other, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });

  it("missing repoId surfaces a clean error, never throws", () => {
    assert.equal(call("file-tree", ctxA, { repoId: "ghost" }).ok, false);
    assert.equal(call("issue-list", ctxA, { repoId: "ghost" }).ok, false);
    assert.equal(call("repo-insights", ctxA, { repoId: "ghost" }).ok, false);
  });
});

describe("repos — pure-compute analysis macros", () => {
  it("codeComplexity computes risk distribution", () => {
    const r = call("codeComplexity", ctxA, {
      data: { modules: [{ name: "m", functions: [{ name: "f", branches: 25, nesting: 3, lines: 200 }] }] },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.riskDistribution.critical >= 1);
  });

  it("commitAnalysis computes bus factor", () => {
    const r = call("commitAnalysis", ctxA, {
      data: { commits: [{ hash: "a", author: "x", date: "2026-01-01", files: ["f"] }] },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.busFactor >= 1);
  });

  it("dependencyAudit grades health", () => {
    const r = call("dependencyAudit", ctxA, {
      data: { dependencies: [{ name: "a", version: "1.0.0", depth: 0 }] },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(["A", "B", "C", "D", "F"].includes(r.result.healthGrade));
  });
});

describe("repos — GitHub API macros (network shaped)", () => {
  it("github-commits-recent requires owner + repo", async () => {
    assert.equal((await call("github-commits-recent", ctxA, {})).ok, false);
  });

  it("github-commits-recent shapes a real response", async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ([{ sha: "abc123", commit: { message: "init", author: { name: "dev", date: "2026-01-01" } }, html_url: "u" }]),
    });
    const r = await call("github-commits-recent", ctxA, { owner: "o", repo: "r" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.source, "github-api");
  });

  it("github-issues surfaces rate-limit errors", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const r = await call("github-issues", ctxA, { owner: "o", repo: "r" });
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limit/);
  });

  it("github-languages shapes a real response", async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ TypeScript: 8000, CSS: 2000 }),
    });
    const r = await call("github-languages", ctxA, { owner: "o", repo: "r" });
    assert.equal(r.ok, true);
    assert.equal(r.result.primaryLanguage, "TypeScript");
  });
});
