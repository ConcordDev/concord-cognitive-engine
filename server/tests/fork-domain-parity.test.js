// Contract tests for the fork-domain feature-parity backlog macros:
// commitCompare, pullRequests, networkGraph, staleForkScan, releases,
// fileDiff — all GitHub-public-API backed. fetch is mocked per test.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerForkActions from "../domains/fork.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerForkActions(register);
});

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.GITHUB_TOKEN;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("fork.commitCompare (ahead/behind)", () => {
  it("rejects malformed repo names", async () => {
    assert.equal((await call("fork.commitCompare", ctxA, { baseRepo: "bad", headRepo: "x/y" })).ok, false);
    assert.equal((await call("fork.commitCompare", ctxA, { baseRepo: "x/y", headRepo: "" })).ok, false);
  });

  it("resolves default branches + parses compare payload", async () => {
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(url);
      if (url.endsWith("/repos/octocat/base")) return jsonRes({ default_branch: "main" });
      if (url.endsWith("/repos/octocat/head")) return jsonRes({ default_branch: "dev" });
      if (url.includes("/compare/")) {
        return jsonRes({
          status: "ahead",
          ahead_by: 3,
          behind_by: 1,
          total_commits: 3,
          files: [
            { filename: "a.js", status: "modified", additions: 10, deletions: 2, changes: 12 },
            { filename: "b.js", status: "added", additions: 5, deletions: 0, changes: 5 },
          ],
          commits: [
            { sha: "abc1234567def", commit: { message: "fix bug\n\nbody", author: { name: "Jo", date: "2026-01-01" } } },
          ],
        });
      }
      throw new Error(`unexpected url ${url}`);
    };
    const r = await call("fork.commitCompare", ctxA, { baseRepo: "octocat/base", headRepo: "octocat/head" });
    assert.equal(r.ok, true);
    assert.equal(r.result.aheadBy, 3);
    assert.equal(r.result.behindBy, 1);
    assert.equal(r.result.filesChanged, 2);
    assert.equal(r.result.additions, 15);
    assert.equal(r.result.deletions, 2);
    assert.equal(r.result.netLines, 13);
    assert.equal(r.result.commits[0].sha, "abc1234567");
    assert.equal(r.result.commits[0].message, "fix bug");
    assert.equal(r.result.source, "github-api");
    assert.ok(urls.some((u) => u.includes("/compare/octocat:main...octocat:dev")));
  });

  it("surfaces 403 rate-limit", async () => {
    globalThis.fetch = async () => jsonRes({}, 403);
    const r = await call("fork.commitCompare", ctxA, { baseRepo: "a/b", headRepo: "c/d", baseRef: "main", headRef: "main" });
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limit/);
  });
});

describe("fork.pullRequests (PR status overlay)", () => {
  it("rejects malformed fullName", async () => {
    assert.equal((await call("fork.pullRequests", ctxA, { fullName: "nope" })).ok, false);
  });

  it("classifies merged/open + builds fork contribution index", async () => {
    globalThis.fetch = async () => jsonRes([
      { number: 1, title: "Feature", user: { login: "alice" }, state: "open", draft: false,
        head: { repo: { full_name: "alice/proj" }, ref: "feat" }, base: { ref: "main" },
        html_url: "u1", created_at: "2026-01-01", updated_at: "2026-01-02", comments: 3 },
      { number: 2, title: "Merged one", user: { login: "bob" }, state: "closed", merged_at: "2026-01-05",
        head: { repo: { full_name: "bob/proj" }, ref: "fix" }, base: { ref: "main" },
        html_url: "u2", created_at: "2026-01-03", updated_at: "2026-01-05" },
    ]);
    const r = await call("fork.pullRequests", ctxA, { fullName: "octocat/proj" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.counts.open, 1);
    assert.equal(r.result.counts.merged, 1);
    assert.equal(r.result.pullRequests[1].state, "merged");
    assert.equal(r.result.forkContributions.length, 2);
    assert.ok(r.result.forkContributions.some((f) => f.repo === "alice/proj" && f.open === 1));
  });

  it("surfaces 404", async () => {
    globalThis.fetch = async () => jsonRes({}, 404);
    const r = await call("fork.pullRequests", ctxA, { fullName: "x/missing" });
    assert.equal(r.ok, false);
  });
});

describe("fork.networkGraph (commits-over-time)", () => {
  it("rejects missing owner/repo", async () => {
    assert.equal((await call("fork.networkGraph", ctxA, { owner: "x" })).ok, false);
  });

  it("aggregates weekly commit activity across parent + forks", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("/forks?")) return jsonRes([{ full_name: "alice/proj" }]);
      if (url.includes("/stats/commit_activity")) {
        return jsonRes([
          { week: 1000, total: 4 },
          { week: 2000, total: 6 },
        ]);
      }
      throw new Error(`unexpected ${url}`);
    };
    const r = await call("fork.networkGraph", ctxA, { owner: "octocat", repo: "proj" });
    assert.equal(r.ok, true);
    assert.equal(r.result.forkCount, 1);
    assert.equal(r.result.repos.length, 2);
    assert.equal(r.result.grandTotalCommits, 20); // (4+6) parent + (4+6) fork
    assert.equal(r.result.combined.length, 2);
    assert.equal(r.result.combined[0].total, 8); // week 1000 across 2 repos
  });

  it("marks repos with unavailable stats", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("/forks?")) return jsonRes([]);
      if (url.includes("/stats/commit_activity")) return jsonRes({}, 202);
      throw new Error(`unexpected ${url}`);
    };
    const r = await call("fork.networkGraph", ctxA, { owner: "octocat", repo: "proj" });
    assert.equal(r.ok, true);
    assert.equal(r.result.repos[0].available, false);
  });
});

describe("fork.staleForkScan (stale-fork detection)", () => {
  it("rejects missing owner/repo", async () => {
    assert.equal((await call("fork.staleForkScan", ctxA, {})).ok, false);
  });

  it("bands forks by push freshness + raises alerts", async () => {
    const now = Date.now();
    const recent = new Date(now - 5 * 86400000).toISOString();
    const old = new Date(now - 400 * 86400000).toISOString();
    globalThis.fetch = async () => jsonRes([
      { full_name: "a/fresh", owner: { login: "a" }, pushed_at: recent, stargazers_count: 2, open_issues_count: 0 },
      { full_name: "b/stale", owner: { login: "b" }, pushed_at: old, stargazers_count: 0, open_issues_count: 1 },
      { full_name: "c/arch", owner: { login: "c" }, pushed_at: old, archived: true },
    ]);
    const r = await call("fork.staleForkScan", ctxA, { owner: "octocat", repo: "proj", staleDays: 180 });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalForks, 3);
    assert.equal(r.result.counts.active, 1);
    assert.equal(r.result.counts.stale, 1);
    assert.equal(r.result.counts.archived, 1);
    assert.equal(r.result.networkHealthPct, 33);
    assert.ok(r.result.alerts.some((a) => a.fullName === "b/stale"));
    assert.ok(r.result.alerts.some((a) => a.fullName === "c/arch" && a.severity === "info"));
  });
});

describe("fork.releases (release/tag tracking)", () => {
  it("rejects malformed fullName", async () => {
    assert.equal((await call("fork.releases", ctxA, { fullName: "x" })).ok, false);
  });

  it("parses releases + tags + picks latest stable", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("/releases")) {
        return jsonRes([
          { name: "v2.0-rc", tag_name: "v2.0-rc", prerelease: true, published_at: "2026-02-01",
            author: { login: "rel" }, html_url: "r1", body: "rc notes",
            assets: [{ name: "bin.zip", download_count: 50, size: 1024 }] },
          { name: "v1.0", tag_name: "v1.0", prerelease: false, draft: false, published_at: "2026-01-01",
            author: { login: "rel" }, html_url: "r2", body: "stable", assets: [] },
        ]);
      }
      if (url.includes("/tags")) {
        return jsonRes([{ name: "v1.0", commit: { sha: "deadbeef1234" } }]);
      }
      throw new Error(`unexpected ${url}`);
    };
    const r = await call("fork.releases", ctxA, { fullName: "octocat/proj" });
    assert.equal(r.ok, true);
    assert.equal(r.result.releaseCount, 2);
    assert.equal(r.result.tagCount, 1);
    assert.equal(r.result.latest.tagName, "v1.0"); // skips the prerelease
    assert.equal(r.result.totalAssetDownloads, 50);
    assert.equal(r.result.tags[0].sha, "deadbeef12");
  });
});

describe("fork.fileDiff (cross-fork file diff)", () => {
  it("rejects missing path/repo", async () => {
    assert.equal((await call("fork.fileDiff", ctxA, { baseRepo: "a/b", headRepo: "c/d" })).ok, false);
    assert.equal((await call("fork.fileDiff", ctxA, { baseRepo: "bad", headRepo: "c/d", path: "x" })).ok, false);
  });

  it("produces a line-level diff between two repo versions", async () => {
    const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
    globalThis.fetch = async (url) => {
      if (url.includes("/repos/a/base/contents/")) {
        return jsonRes({ encoding: "base64", content: b64("line1\nline2\nline3"), size: 17 });
      }
      if (url.includes("/repos/c/head/contents/")) {
        return jsonRes({ encoding: "base64", content: b64("line1\nline2-changed\nline3\nline4"), size: 30 });
      }
      throw new Error(`unexpected ${url}`);
    };
    const r = await call("fork.fileDiff", ctxA, { baseRepo: "a/base", headRepo: "c/head", path: "src/x.js" });
    assert.equal(r.ok, true);
    assert.equal(r.result.baseExists, true);
    assert.equal(r.result.headExists, true);
    assert.equal(r.result.identical, false);
    assert.equal(r.result.additions, 2); // line2-changed + line4
    assert.equal(r.result.deletions, 1); // line2
    assert.ok(r.result.rows.some((row) => row.type === "add" && row.text === "line4"));
    assert.ok(r.result.rows.some((row) => row.type === "context" && row.text === "line1"));
  });

  it("reports identical files", async () => {
    const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
    globalThis.fetch = async () => jsonRes({ encoding: "base64", content: b64("same\ntext"), size: 9 });
    const r = await call("fork.fileDiff", ctxA, { baseRepo: "a/b", headRepo: "c/d", path: "x.txt" });
    assert.equal(r.ok, true);
    assert.equal(r.result.identical, true);
    assert.equal(r.result.additions, 0);
    assert.equal(r.result.deletions, 0);
  });
});
