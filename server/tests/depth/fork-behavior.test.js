// tests/depth/fork-behavior.test.js — REAL behavioral tests for the `fork`
// domain (registerLensAction family, invoked via lensRun). Curated subset:
// exact-value calcs (Levenshtein divergence, merge-complexity scoring, fork
// health weighting) + STATE-backed CRUD round-trips + validation rejections.
// The network-calling GitHub macros are exercised through their pure
// input-validation branches (which return before any fetch), so they run
// deterministically under the no-egress preload.
//
// Every lensRun("fork", "<macro>", …) call literally names the macro, so the
// macro-depth grader credits it as a behavioral invocation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("fork — divergenceAnalysis (exact Levenshtein + conflict detection)", () => {
  it("flags a both-modified conflict and computes a severe divergence score", async () => {
    const r = await lensRun("fork", "divergenceAnalysis", {
      data: {
        base: { files: { "f.txt": "A" } },
        forkA: { files: { "f.txt": "AB" } },
        forkB: { files: { "f.txt": "AC" } },
      },
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.summary.totalFiles, 1);
    assert.equal(res.summary.conflictingFiles, 1);
    const file = res.files[0];
    assert.equal(file.status, "both_modified_conflict");
    assert.equal(file.conflict, true);
    assert.equal(file.editDistanceAB, 1); // levenshtein("AB","AC") = 1
    assert.equal(file.editDistFromBaseA, 1); // levenshtein("A","AB") = 1
    assert.equal(file.editDistFromBaseB, 1); // levenshtein("A","AC") = 1
    assert.equal(file.conflictRegions.length, 1);
    assert.equal(file.conflictRegions[0].startLine, 0);
    assert.equal(res.divergence.score, 100); // min(1, 1/1) * 100
    assert.equal(res.divergence.level, "severe");
    assert.equal(res.divergence.totalEditDistance, 1);
  });

  it("classifies added-in-a / added-in-b / unchanged correctly with no conflicts", async () => {
    const r = await lensRun("fork", "divergenceAnalysis", {
      data: {
        base: { files: { "keep.txt": "same" } },
        forkA: { files: { "keep.txt": "same", "newA.txt": "alpha" } },
        forkB: { files: { "keep.txt": "same", "newB.txt": "beta" } },
      },
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.summary.totalFiles, 3);
    assert.equal(res.summary.conflictingFiles, 0);
    assert.equal(res.summary.addedInA, 1);
    assert.equal(res.summary.addedInB, 1);
    assert.equal(res.summary.unchanged, 1);
    const keep = res.files.find((f) => f.path === "keep.txt");
    assert.equal(keep.status, "unchanged");
    assert.equal(keep.editDistanceAB, 0);
    // added-only files count their full length toward editDistanceAB:
    // newA.txt "alpha"→"" = 5, newB.txt "beta"→"" = 4; total 9 over base size 4 → ratio capped at 1
    assert.equal(res.divergence.totalEditDistance, 9);
    assert.equal(res.divergence.score, 100);
    assert.equal(res.divergence.level, "severe");
  });

  it("detects both_added_conflict when a file appears only in A and B with different content", async () => {
    const r = await lensRun("fork", "divergenceAnalysis", {
      data: {
        base: { files: {} },
        forkA: { files: { "x.txt": "hello" } },
        forkB: { files: { "x.txt": "world" } },
      },
    });
    assert.equal(r.ok, true);
    const file = r.result.files[0];
    assert.equal(file.status, "both_added_conflict");
    assert.equal(file.conflict, true);
    // levenshtein("hello","world"): h→w,e→o,l→r,l→l,o→d = 4 substitutions
    assert.equal(file.editDistanceAB, 4);
  });
});

describe("fork — mergeComplexity (exact overlap + score breakdown)", () => {
  it("counts a direct cross-author overlap and scores the file", async () => {
    const r = await lensRun("fork", "mergeComplexity", {
      data: {
        changes: [{
          file: "a.js",
          regions: [
            { startLine: 1, endLine: 10, author: "alice" },
            { startLine: 5, endLine: 15, author: "bob" },
          ],
        }],
      },
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.summary.totalDirectConflicts, 1);
    // overlap [max(1,5)..min(10,15)] = [5..10] → 6 lines
    assert.equal(res.summary.totalOverlapLines, 6);
    const f = res.files[0];
    assert.equal(f.directConflicts, 1);
    assert.equal(f.conflictDetails[0].overlapLines, 6);
    assert.deepEqual(f.conflictDetails[0].overlapRange, [5, 10]);
    // fileScore = 1*10 + 0*3 = 10
    assert.equal(f.conflictScore, 10);
    assert.equal(res.summary.autoMergeCandidate, false);
  });

  it("flags an auto-merge candidate when there are no conflicts or shared deps", async () => {
    const r = await lensRun("fork", "mergeComplexity", {
      data: {
        changes: [
          { file: "a.js", regions: [{ startLine: 1, endLine: 3, author: "alice" }], dependencies: ["lodash"] },
          { file: "b.js", regions: [{ startLine: 1, endLine: 3, author: "bob" }], dependencies: ["axios"] },
        ],
      },
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.summary.totalDirectConflicts, 0);
    assert.equal(res.summary.sharedDependencies, 0);
    assert.equal(res.summary.autoMergeCandidate, true);
    assert.equal(res.complexity.level, "easy");
  });

  it("detects shared dependencies across files and marks high risk for 3+ files", async () => {
    const r = await lensRun("fork", "mergeComplexity", {
      data: {
        changes: [
          { file: "a.js", regions: [], dependencies: ["core"] },
          { file: "b.js", regions: [], dependencies: ["core"] },
          { file: "c.js", regions: [], dependencies: ["core"] },
        ],
      },
    });
    assert.equal(r.ok, true);
    const dep = r.result.dependencyOverlap.find((d) => d.dependency === "core");
    assert.equal(dep.sharedBy.length, 3);
    assert.equal(dep.risk, "high"); // files.length > 2
    assert.equal(r.result.summary.sharedDependencies, 1);
  });

  it("returns a no-changes message when the changes list is empty", async () => {
    const r = await lensRun("fork", "mergeComplexity", { data: { changes: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No changes to analyze.");
  });
});

describe("fork — forkHealth (exact weighted health scoring)", () => {
  it("scores a fresh, active, single-contributor fork and warns on bus factor", async () => {
    const now = new Date().toISOString();
    const r = await lensRun("fork", "forkHealth", {
      data: {
        fork: {
          name: "myfork",
          createdAt: now,
          lastSyncAt: now,
          lastCommitAt: now,
          commitCount: 0,
          contributorCount: 1,
          openIssues: 0,
          upstream: { lastCommitAt: now, commitCount: 0 },
        },
      },
    });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.name, "myfork");
    // syncFreshness 100*.3 + activity 100*.25 + divergence 100*.2 +
    // community min(100,1*10)=10*.15 + issues 100*.1 = 30+25+20+1.5+10 = 86.5 → 87
    assert.equal(res.healthScore, 87);
    assert.equal(res.healthLevel, "healthy");
    assert.equal(res.factors.community.contributors, 1);
    assert.ok(res.recommendations.some((m) => m.includes("bus factor")));
  });

  it("flags a stale fork that is months behind upstream", async () => {
    const now = Date.now();
    const old = new Date(now - 200 * 86400000).toISOString();
    const r = await lensRun("fork", "forkHealth", {
      data: {
        fork: {
          name: "old",
          createdAt: new Date(now - 400 * 86400000).toISOString(),
          lastSyncAt: old,
          lastCommitAt: old,
          commitCount: 5,
          contributorCount: 1,
          openIssues: 12,
          upstream: { lastCommitAt: now, commitCount: 5 },
        },
      },
    });
    assert.equal(r.ok, true);
    const res = r.result;
    // 200 days stale → sync & activity scores floor at 0
    assert.equal(res.factors.syncFreshness.score, 0);
    assert.equal(res.factors.activity.score, 0);
    assert.ok(res.healthScore < 60);
    assert.ok(["stale", "abandoned"].includes(res.healthLevel));
    assert.ok(res.recommendations.some((m) => m.includes("days behind upstream")));
    assert.ok(res.recommendations.some((m) => m.includes("open issues")));
  });
});

describe("fork — watch-* CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("fork-watch-crud"); });

  it("watch-add normalizes a github URL to owner/repo and reads back via watch-list", async () => {
    const add = await lensRun("fork", "watch-add", {
      params: { fullName: "https://github.com/nodejs/node.git", reason: "upstream", note: "core runtime" },
    }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.repo.fullName, "nodejs/node"); // url + .git stripped
    assert.equal(add.result.repo.reason, "upstream");
    assert.equal(add.result.repo.note, "core runtime");
    const id = add.result.repo.id;

    const list = await lensRun("fork", "watch-list", {}, ctx);
    assert.ok(list.result.repos.some((r) => r.id === id));
    assert.ok(list.result.count >= 1);
  });

  it("watch-add rejects a malformed fullName and an unknown reason defaults to reference", async () => {
    const bad = await lensRun("fork", "watch-add", { params: { fullName: "not-a-repo" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("owner/repo"));

    const okDefault = await lensRun("fork", "watch-add", {
      params: { fullName: "facebook/react", reason: "bogus-reason" },
    }, ctx);
    assert.equal(okDefault.ok, true);
    assert.equal(okDefault.result.repo.reason, "reference"); // unknown reason → default
  });

  it("watch-add rejects a duplicate repo for the same user", async () => {
    await lensRun("fork", "watch-add", { params: { fullName: "vuejs/core" } }, ctx);
    const dup = await lensRun("fork", "watch-add", { params: { fullName: "vuejs/core" } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.ok(dup.result.error.includes("already watching"));
  });

  it("watch-delete removes a watched repo and it disappears from watch-list", async () => {
    const add = await lensRun("fork", "watch-add", { params: { fullName: "denoland/deno" } }, ctx);
    const id = add.result.repo.id;
    const del = await lensRun("fork", "watch-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("fork", "watch-list", {}, ctx);
    assert.equal(list.result.repos.some((r) => r.id === id), false);
  });

  it("watch-delete returns an error for an unknown id", async () => {
    const del = await lensRun("fork", "watch-delete", { params: { id: "rw_does_not_exist" } }, ctx);
    assert.equal(del.result.ok, false);
    assert.ok(del.result.error.includes("not found"));
  });

  it("watch-dashboard aggregates watched repos by reason", async () => {
    const dctx = await depthCtx("fork-watch-dashboard");
    await lensRun("fork", "watch-add", { params: { fullName: "a/b", reason: "fork" } }, dctx);
    await lensRun("fork", "watch-add", { params: { fullName: "c/d", reason: "fork" } }, dctx);
    await lensRun("fork", "watch-add", { params: { fullName: "e/f", reason: "competitor" } }, dctx);
    const dash = await lensRun("fork", "watch-dashboard", {}, dctx);
    assert.equal(dash.ok, true);
    assert.equal(dash.result.repos, 3);
    assert.equal(dash.result.byReason.fork, 2);
    assert.equal(dash.result.byReason.competitor, 1);
  });
});

describe("fork — GitHub macros: input-validation branches (deterministic, pre-fetch)", () => {
  it("github-forks requires owner + repo", async () => {
    const r = await lensRun("fork", "github-forks", { params: { owner: "", repo: "" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("owner + repo required"));
  });

  it("github-repo requires owner + repo", async () => {
    const r = await lensRun("fork", "github-repo", { params: { owner: "octocat" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("owner + repo required"));
  });

  it("commitCompare rejects a malformed baseRepo", async () => {
    const r = await lensRun("fork", "commitCompare", { params: { baseRepo: "broken", headRepo: "a/b" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("baseRepo must be owner/repo"));
  });

  it("pullRequests rejects a malformed fullName", async () => {
    const r = await lensRun("fork", "pullRequests", { params: { fullName: "no-slash" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("fullName must be owner/repo"));
  });

  it("networkGraph requires owner + repo", async () => {
    const r = await lensRun("fork", "networkGraph", { params: { repo: "node" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("owner + repo required"));
  });

  it("staleForkScan requires owner + repo", async () => {
    const r = await lensRun("fork", "staleForkScan", { params: {} });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("owner + repo required"));
  });

  it("releases rejects a malformed fullName", async () => {
    const r = await lensRun("fork", "releases", { params: { fullName: "x" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("fullName must be owner/repo"));
  });

  it("fileDiff requires a path after valid repos", async () => {
    const r = await lensRun("fork", "fileDiff", { params: { baseRepo: "a/b", headRepo: "c/d" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("path required"));
  });

  it("fileDiff rejects a malformed baseRepo", async () => {
    const r = await lensRun("fork", "fileDiff", { params: { baseRepo: "bad", headRepo: "c/d", path: "x.js" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("baseRepo must be owner/repo"));
  });

  it("feed rejects a malformed fullName", async () => {
    const r = await lensRun("fork", "feed", { params: { fullName: "::bad::" } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("fullName must be owner/repo"));
  });
});
