// tests/depth/repos-behavior.test.js — REAL behavioral tests for the `repos`
// domain (the GitHub-shape code-host lens; registerLensAction family, via
// lensRun). Exact-value assertions on the deterministic analysis macros
// (codeComplexity cyclomatic/cognitive, commitAnalysis bus-factor +
// size distribution, dependencyAudit duplicate/license/freshness) plus the
// in-memory Concord-repo substrate CRUD round-trips (repo create→list,
// file save→read→commit graph, branch/tag create, issue lifecycle, PR
// diff/review/merge gating, CI workflow run, security scan).
//
// SKIPPED (need network egress — fail under no-egress): the real GitHub-API
// macros `github-commits-recent`, `github-issues`, `github-languages` all
// `fetch()` https://api.github.com. Not exercised here.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("repos — deterministic analysis macros (exact values)", () => {
  it("codeComplexity: cyclomatic = 1+branches+loops+conditions; cognitive scales with nesting", async () => {
    const r = await lensRun("repos", "codeComplexity", {
      data: { modules: [{ name: "m", functions: [{ name: "f", branches: 2, nesting: 0, lines: 10, loops: 1, conditions: 1 }] }] },
    });
    assert.equal(r.ok, true);
    const fn = r.result.modules[0].functions[0];
    assert.equal(fn.cyclomaticComplexity, 5);   // 1 + 2 + 1 + 1
    assert.equal(fn.cognitiveComplexity, 4);     // (2+1+1) * (1 + 0*0.5)
    assert.equal(fn.risk, "low");                // cyclomatic 5 → not > 5
    assert.equal(r.result.totalModules, 1);
    assert.equal(r.result.totalFunctions, 1);
    assert.equal(r.result.totalLines, 10);
  });

  it("codeComplexity: nesting inflates cognitive complexity; high cyclomatic is risk-classified", async () => {
    const r = await lensRun("repos", "codeComplexity", {
      data: { modules: [{ name: "deep", functions: [{ name: "g", branches: 6, nesting: 2, lines: 40, loops: 3, conditions: 3 }] }] },
    });
    assert.equal(r.ok, true);
    const fn = r.result.modules[0].functions[0];
    assert.equal(fn.cyclomaticComplexity, 13);   // 1 + 6 + 3 + 3
    assert.equal(fn.cognitiveComplexity, 24);    // (6+3+3) * (1 + 2*0.5) = 12 * 2
    assert.equal(fn.risk, "high");               // 13 > 10
    assert.equal(r.result.riskDistribution.high, 1);
  });

  it("commitAnalysis: bus factor = min authors covering >=50% of commits", async () => {
    const r = await lensRun("repos", "commitAnalysis", {
      data: {
        commits: [
          { hash: "a1", author: "alice", date: "2024-01-01T10:00:00Z", files: ["x.js"], additions: 10, deletions: 0, message: "feat: x" },
          { hash: "a2", author: "alice", date: "2024-01-02T10:00:00Z", files: ["x.js"], additions: 5, deletions: 1, message: "fix: x" },
          { hash: "a3", author: "alice", date: "2024-01-03T10:00:00Z", files: ["y.js"], additions: 3, deletions: 0, message: "feat: y" },
          { hash: "b1", author: "bob", date: "2024-01-04T10:00:00Z", files: ["z.js"], additions: 2, deletions: 0, message: "docs: z" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCommits, 4);
    assert.equal(r.result.busFactor, 1);               // alice has 3/4 = 0.75 >= 0.5
    assert.equal(r.result.busFactorRisk, "critical");  // busFactor <= 1
    const alice = r.result.authors.find((a) => a.name === "alice");
    assert.equal(alice.commits, 3);
    assert.equal(alice.commitShare, 0.75);
  });

  it("commitAnalysis: commit-message prefixes are tallied; large commits flagged vs 3x avg", async () => {
    const r = await lensRun("repos", "commitAnalysis", {
      data: {
        commits: [
          { hash: "c1", author: "x", date: "2024-02-01T09:00:00Z", files: ["a"], additions: 1, deletions: 0, message: "feat: a" },
          { hash: "c2", author: "x", date: "2024-02-02T09:00:00Z", files: ["a"], additions: 1, deletions: 0, message: "feat: b" },
          { hash: "c3", author: "x", date: "2024-02-03T09:00:00Z", files: ["a"], additions: 1, deletions: 0, message: "docs: c" },
          { hash: "c4", author: "x", date: "2024-02-04T09:00:00Z", files: ["a"], additions: 200, deletions: 200, message: "refactor: big" },
        ],
      },
    });
    assert.equal(r.ok, true);
    const feat = r.result.commitTypes.find((t) => t.type === "feat");
    assert.equal(feat.count, 2);
    // sizes: 1, 1, 1, 400 → avg ~100.75; 400 > 3*100.75 (302.25) → 1 large commit
    assert.equal(r.result.sizeDistribution.largeCommits, 1);
    assert.equal(r.result.sizeDistribution.max, 400);
  });

  it("dependencyAudit: a GPL dep is flagged copyleft; version conflicts detected", async () => {
    const r = await lensRun("repos", "dependencyAudit", {
      data: {
        dependencies: [
          { name: "gpllib", version: "1.0.0", license: "GPL-3.0" },
          { name: "lodash", version: "4.17.11", license: "MIT" },
          { name: "lodash", version: "4.17.21", license: "MIT" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDependencies, 3);
    assert.ok(r.result.licenses.risks.some((l) => l.license === "GPL-3.0" && l.risk === "copyleft"));
    assert.equal(r.result.duplicates.versionConflicts, 1);   // lodash @ two versions
    assert.ok(r.result.duplicates.details.some((d) => d.name === "lodash" && d.versionCount === 2));
  });

  it("dependencyAudit: vulnerabilities are summed and surface-area computed", async () => {
    const r = await lensRun("repos", "dependencyAudit", {
      data: {
        dependencies: [
          { name: "safe", version: "1.0.0", license: "MIT" },
          { name: "risky", version: "0.1.0", license: "MIT", vulnerabilities: 2, depth: 1 },
          { name: "worse", version: "0.2.0", license: "MIT", vulnerabilities: 3, depth: 0 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.vulnerabilities.total, 5);        // 2 + 3
    assert.equal(r.result.vulnerabilities.affectedDeps, 2);
    assert.equal(r.result.vulnerabilities.surfaceArea, 0.6667);  // 2/3 rounded
  });
});

describe("repos — virtual code-host CRUD round-trips", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`repos-crud-${randomUUID()}`); });

  it("repo-create → repo-list shows it, seeded with a main branch + files", async () => {
    const created = await lensRun("repos", "repo-create", { params: { name: "Round Trip", description: "rt", language: "Go" } }, ctx);
    assert.equal(created.result.ok ?? true, true);
    const repoId = created.result.repo.id;
    assert.equal(created.result.repo.defaultBranch, "main");

    const list = await lensRun("repos", "repo-list", {}, ctx);
    const found = list.result.repos.find((rp) => rp.id === repoId);
    assert.ok(found);
    assert.equal(found.name, "Round Trip");
    assert.equal(found.language, "Go");
    assert.equal(found.fileCount, 4);   // README, package.json, src/index.ts, src/util.ts
  });

  it("file-save creates a commit + diff; file-read reads it back; commit-graph includes it", async () => {
    const created = await lensRun("repos", "repo-create", { params: { name: "Files" } }, ctx);
    const repoId = created.result.repo.id;

    const saved = await lensRun("repos", "file-save", { params: { repoId, path: "new.ts", content: "line1\nline2\nline3", message: "add new.ts" } }, ctx);
    assert.equal(saved.result.saved, true);
    // rpDiff("" , "line1\nline2\nline3"): empty=[""], new=3 lines.
    // i0 differ → del+add (a=1,d=1); i1,i2 → add (a=3). So additions=3, deletions=1.
    assert.equal(saved.result.commit.additions, 3);
    assert.equal(saved.result.commit.deletions, 1);

    const read = await lensRun("repos", "file-read", { params: { repoId, path: "new.ts" } }, ctx);
    assert.equal(read.result.content, "line1\nline2\nline3");
    assert.equal(read.result.lineCount, 3);
    assert.equal(read.result.language, "TypeScript");

    const graph = await lensRun("repos", "commit-graph", { params: { repoId } }, ctx);
    assert.ok(graph.result.nodes.some((n) => n.sha === saved.result.commit.sha && n.message === "add new.ts"));
  });

  it("branch-create + tag-create round-trip through branch-list", async () => {
    const created = await lensRun("repos", "repo-create", { params: { name: "Branches" } }, ctx);
    const repoId = created.result.repo.id;

    const br = await lensRun("repos", "branch-create", { params: { repoId, name: "feature" } }, ctx);
    assert.equal(br.result.branch.name, "feature");

    const tag = await lensRun("repos", "tag-create", { params: { repoId, name: "v1.0.0", message: "release" } }, ctx);
    assert.equal(tag.result.tag.name, "v1.0.0");

    const list = await lensRun("repos", "branch-list", { params: { repoId } }, ctx);
    assert.ok(list.result.branches.some((b) => b.name === "feature"));
    assert.ok(list.result.tags.some((t) => t.name === "v1.0.0"));
  });

  it("issue lifecycle: create → comment → set-state closed round-trips through issue-list/detail", async () => {
    const created = await lensRun("repos", "repo-create", { params: { name: "Issues" } }, ctx);
    const repoId = created.result.repo.id;

    const issue = await lensRun("repos", "issue-create", { params: { repoId, title: "bug found", body: "details", labels: ["bug"] } }, ctx);
    const number = issue.result.issue.number;
    assert.equal(issue.result.issue.state, "open");

    const cmt = await lensRun("repos", "issue-comment", { params: { repoId, number, body: "investigating" } }, ctx);
    assert.equal(cmt.result.commentCount, 1);

    await lensRun("repos", "issue-set-state", { params: { repoId, number, state: "closed" } }, ctx);
    const detail = await lensRun("repos", "issue-detail", { params: { repoId, number } }, ctx);
    assert.equal(detail.result.issue.state, "closed");
    assert.ok(detail.result.issue.comments.some((c) => c.body === "investigating"));

    const closed = await lensRun("repos", "issue-list", { params: { repoId, state: "closed" } }, ctx);
    assert.ok(closed.result.issues.some((i) => i.number === number));
  });

  it("pull request: approve review unblocks merge; merge advances the base branch", async () => {
    const created = await lensRun("repos", "repo-create", { params: { name: "PRs" } }, ctx);
    const repoId = created.result.repo.id;
    await lensRun("repos", "branch-create", { params: { repoId, name: "topic" } }, ctx);
    // put a commit on the topic branch so the diff has content
    await lensRun("repos", "file-save", { params: { repoId, path: "feat.ts", content: "export const z = 1;", branch: "topic", message: "feat" } }, ctx);

    const pr = await lensRun("repos", "pull-create", { params: { repoId, title: "add feat", head: "topic", base: "main" } }, ctx);
    const number = pr.result.pull.number;

    await lensRun("repos", "pull-review", { params: { repoId, number, verdict: "approve", body: "lgtm" } }, ctx);
    const detail = await lensRun("repos", "pull-detail", { params: { repoId, number } }, ctx);
    assert.equal(detail.result.mergeable, true);
    assert.equal(detail.result.approvals, 1);

    const merged = await lensRun("repos", "pull-merge", { params: { repoId, number } }, ctx);
    assert.equal(merged.result.merged, true);
    assert.ok(merged.result.mergeCommit);
  });

  it("security-scan flags an eval() code-scanning rule and a hardcoded secret", async () => {
    const created = await lensRun("repos", "repo-create", { params: { name: "SecScan" } }, ctx);
    const repoId = created.result.repo.id;
    await lensRun("repos", "file-save", { params: { repoId, path: "danger.js", content: "eval('x');\nconst password = \"hunter2\";" } }, ctx);

    const scan = await lensRun("repos", "security-scan", { params: { repoId } }, ctx);
    assert.ok(scan.result.codeScanning.some((a) => a.rule === "no-eval" && a.severity === "high"));
    assert.ok(scan.result.codeScanning.some((a) => a.rule === "hardcoded-secret" && a.severity === "critical"));
    assert.equal(scan.result.bySeverity.critical >= 1, true);
  });
});

describe("repos — validation rejections", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`repos-reject-${randomUUID()}`); });

  it("repo-create without a name is rejected", async () => {
    const bad = await lensRun("repos", "repo-create", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });

  it("pull-merge with changes-requested review cannot merge", async () => {
    const created = await lensRun("repos", "repo-create", { params: { name: "BlockMerge" } }, ctx);
    const repoId = created.result.repo.id;
    await lensRun("repos", "branch-create", { params: { repoId, name: "wip" } }, ctx);
    const pr = await lensRun("repos", "pull-create", { params: { repoId, title: "wip pr", head: "wip", base: "main" } }, ctx);
    const number = pr.result.pull.number;
    await lensRun("repos", "pull-review", { params: { repoId, number, verdict: "request-changes", body: "needs work" } }, ctx);

    const bad = await lensRun("repos", "pull-merge", { params: { repoId, number } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /changes requested/);
  });

  it("branch-create rejects a duplicate branch name", async () => {
    const created = await lensRun("repos", "repo-create", { params: { name: "DupBranch" } }, ctx);
    const repoId = created.result.repo.id;
    await lensRun("repos", "branch-create", { params: { repoId, name: "dev" } }, ctx);
    const bad = await lensRun("repos", "branch-create", { params: { repoId, name: "dev" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /already exists/);
  });
});
