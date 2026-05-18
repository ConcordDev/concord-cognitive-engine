// server/tests/code-git.test.js
//
// Tier-2 contract tests for Code Sprint A #2 — real git wrappers.
// Uses an isolated tmpdir with `git init` so every test runs against
// a real git repo without touching the parent tree.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  gitEnabled, gitStatus, gitDiff, gitCommit, gitBranch,
  gitLog, gitPush, gitDiffBetween,
} from "../lib/code/git.js";

function _gitAvailable() {
  const r = spawnSync("git", ["--version"], { encoding: "utf-8" });
  return r.status === 0;
}

const GIT_OK = _gitAvailable();
const skipReason = GIT_OK ? null : "git binary not available";

describe("code-git: env gating", () => {
  it("gitEnabled() reads CONCORD_GIT_ENABLED", () => {
    const prev = process.env.CONCORD_GIT_ENABLED;
    process.env.CONCORD_GIT_ENABLED = "true";
    try { assert.equal(gitEnabled(), true); }
    finally {
      if (prev === undefined) delete process.env.CONCORD_GIT_ENABLED;
      else process.env.CONCORD_GIT_ENABLED = prev;
    }
  });

  it("gitStatus rejects when git disabled", () => {
    const prev = process.env.CONCORD_GIT_ENABLED;
    delete process.env.CONCORD_GIT_ENABLED;
    try {
      const r = gitStatus({ repoPath: "." });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "git_disabled");
    } finally {
      if (prev !== undefined) process.env.CONCORD_GIT_ENABLED = prev;
    }
  });
});

describe("code-git: arg validation rejects shell-y inputs", () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "cg-arg-"));
    spawnSync("git", ["init", dir], { encoding: "utf-8" });
    process.env.CONCORD_GIT_ENABLED = "true";
    process.env.CONCORD_CODE_WORKSPACE_ROOT = tmpdir();
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it("rejects commit message containing a file path that looks like a flag", () => {
    const r = gitCommit({ repoPath: dir, message: "x", files: ["--evil"] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_file");
  });

  it("rejects branch name with whitespace", () => {
    const r = gitBranch({ repoPath: dir, op: "create", name: "bad branch" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_branch_name");
  });

  it("rejects path traversal in commit files", () => {
    const r = gitCommit({ repoPath: dir, message: "x", files: ["../escape.txt"] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "path_traversal");
  });
});

describe("code-git: end-to-end real repo round-trip", () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "cg-rt-"));
    spawnSync("git", ["init", "-b", "main", dir], { encoding: "utf-8" });
    spawnSync("git", ["-C", dir, "config", "user.email", "test@concord.local"], { encoding: "utf-8" });
    spawnSync("git", ["-C", dir, "config", "user.name", "Concord Test"], { encoding: "utf-8" });
    // Isolated test repo only — never pushed. Disable signing in case
    // the host environment's global config enables it (signing infra
    // may not be available in CI / sandbox tmpdirs).
    spawnSync("git", ["-C", dir, "config", "commit.gpgsign", "false"], { encoding: "utf-8" });
    spawnSync("git", ["-C", dir, "config", "tag.gpgsign", "false"], { encoding: "utf-8" });
    process.env.CONCORD_GIT_ENABLED = "true";
    process.env.CONCORD_CODE_WORKSPACE_ROOT = tmpdir();
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it("gitStatus reports a clean repo", () => {
    const r = gitStatus({ repoPath: dir });
    assert.equal(r.ok, true);
    assert.equal(r.clean, true);
    assert.equal(r.files.length, 0);
  });

  it("gitStatus reports an untracked file after we write one", () => {
    writeFileSync(join(dir, "hello.txt"), "hi\n");
    const r = gitStatus({ repoPath: dir });
    assert.equal(r.ok, true);
    assert.equal(r.clean, false);
    assert.ok(r.files.find((f) => f.path === "hello.txt" && f.untracked));
  });

  it("gitCommit stages and commits the file, returns sha + dtu-ready shape", () => {
    const r = gitCommit({ repoPath: dir, message: "Add hello", files: ["hello.txt"] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.sha && r.sha.length === 40);
    assert.equal(r.message, "Add hello");
  });

  it("gitLog returns the commit we just made", () => {
    const r = gitLog({ repoPath: dir, limit: 5 });
    assert.equal(r.ok, true);
    assert.ok(r.commits.length >= 1);
    assert.equal(r.commits[0].subject, "Add hello");
  });

  it("gitDiff returns the staged change after a follow-up edit", () => {
    writeFileSync(join(dir, "hello.txt"), "hi changed\n");
    spawnSync("git", ["-C", dir, "add", "hello.txt"], { encoding: "utf-8" });
    const r = gitDiff({ repoPath: dir, cached: true });
    assert.equal(r.ok, true);
    assert.ok(r.diff.includes("hi changed"));
  });

  it("gitBranch create + checkout + current round-trip", () => {
    const c = gitBranch({ repoPath: dir, op: "create", name: "feat/work" });
    assert.equal(c.ok, true);
    const cur = gitBranch({ repoPath: dir, op: "current" });
    assert.equal(cur.ok, true);
    assert.equal(cur.branch, "feat/work");
  });

  it("gitPush blocked by default (CONCORD_GIT_PUSH_ENABLED off)", () => {
    const prev = process.env.CONCORD_GIT_PUSH_ENABLED;
    delete process.env.CONCORD_GIT_PUSH_ENABLED;
    try {
      const r = gitPush({ repoPath: dir });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "push_disabled");
    } finally {
      if (prev !== undefined) process.env.CONCORD_GIT_PUSH_ENABLED = prev;
    }
  });

  it("gitDiffBetween returns structured commits + file changes", () => {
    // Move back to main, make another commit on feat/work to diverge.
    spawnSync("git", ["-C", dir, "checkout", "main"], { encoding: "utf-8" });
    writeFileSync(join(dir, "second.txt"), "second\n");
    gitCommit({ repoPath: dir, message: "Second on main", files: ["second.txt"] });
    const r = gitDiffBetween({ repoPath: dir, base: "feat/work", head: "main" });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.commits));
    assert.ok(Array.isArray(r.fileChanges));
  });
});
