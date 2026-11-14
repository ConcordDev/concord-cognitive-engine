/**
 * HV-01 pin — scripts/harvest/residual.mjs on a 3-commit fixture repo.
 *
 * Fixture: commit A is the shared base (file.txt v1). The PR branch
 * adds commit B (file.txt v2 + a new added.txt). The census head is
 * commit C, which carries the same file.txt change (the hunk landed)
 * but never received added.txt.
 *
 * Pins: the landed hunk reports APPLIED and the never-landed added
 * file reports MISSING, so the residual is exactly [added.txt].
 * Fails pristine (no script to import), passes with the tool.
 *
 * Run: node --test scripts/harvest/__tests__/residual.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyPr } from "../residual.mjs";

function git(repo, args, opts = {}) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", ...opts });
}

describe("HV-01 residual census — 3-commit fixture", () => {
  let repo, scratch;
  before(() => {
    scratch = mkdtempSync(join(tmpdir(), "hv01-fixture-"));
    repo = join(scratch, "repo");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    git(repo, ["config", "user.name", "fixture"]);
    git(repo, ["config", "user.email", "fixture@example.invalid"]);
    // Commit A — the shared base.
    writeFileSync(join(repo, "file.txt"), "line1\nline2\nline3\n");
    writeFileSync(join(repo, "keep.txt"), "keep\n");
    git(repo, ["add", "file.txt", "keep.txt"]);
    git(repo, ["commit", "-q", "-m", "A: base"]);
    git(repo, ["branch", "census-main"]); // frozen at A: the PR's base ref
    // PR branch — commit B: modify file.txt, add added.txt.
    git(repo, ["checkout", "-q", "-b", "pr"]);
    writeFileSync(join(repo, "file.txt"), "line1\nline2 CHANGED\nline3\nline4\n");
    writeFileSync(join(repo, "added.txt"), "brand new\n");
    git(repo, ["add", "file.txt", "added.txt"]);
    git(repo, ["commit", "-q", "-m", "B: the PR"]);
    git(repo, ["update-ref", "refs/pr/999", "HEAD"]);
    // Census head — commit C on top of A: the same file.txt change, no added.txt.
    git(repo, ["checkout", "-q", "-b", "head", "census-main"]);
    writeFileSync(join(repo, "file.txt"), "line1\nline2 CHANGED\nline3\nline4\n");
    git(repo, ["add", "file.txt"]);
    git(repo, ["commit", "-q", "-m", "C: the hunk landed on head"]);
  });
  after(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it("an applied hunk reports APPLIED; a missing added file reports MISSING", () => {
    const indexFile = join(scratch, "index");
    const indexEnv = { GIT_INDEX_FILE: indexFile };
    git(repo, ["read-tree", "head"], { env: { ...process.env, ...indexEnv } });
    const { files, residual } = classifyPr(
      repo,
      { pr: "refs/pr/999", main: "census-main", head: "head" },
      indexEnv,
    );
    const byPath = new Map(files.map((f) => [f.path, f.class]));
    assert.equal(byPath.get("file.txt"), "APPLIED", "the landed hunk must report APPLIED");
    assert.equal(byPath.get("added.txt"), "MISSING", "the never-landed added file must report MISSING");
    assert.deepEqual(residual, ["added.txt"]);
  });
});
