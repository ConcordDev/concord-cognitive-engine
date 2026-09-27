// server/tests/workspace-sensor-git-cache.test.js — the git probe behind every
// executive mission step is correct, cached and shared (it once ran three git
// processes per step, ~300% CPU on a small box).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { _gitStateForTest as gitState, _resetGitStateCache } from "../lib/runtime/workspace-sensor.js";

const root = path.resolve(import.meta.dirname, "..", "..");

test("reports the real branch and commit", async () => {
  _resetGitStateCache();
  const g = await gitState(root);
  assert.equal(g.commitHash, execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
  assert.equal(g.branch, execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
  assert.match(g.commitHash, /^[0-9a-f]{40}$/);
});

test("concurrent and repeated calls share one probe within the TTL", async () => {
  _resetGitStateCache();
  const [a, b, c] = await Promise.all([gitState(root), gitState(root), gitState(root)]);
  assert.equal(a, b); assert.equal(b, c);        // same object → one probe
  assert.equal(await gitState(root), a);         // cached
  assert.notEqual(await gitState(root, Date.now() + 60_000), undefined); // past TTL → re-probes, still valid
});

test("a non-repo degrades honestly", async () => {
  _resetGitStateCache();
  const g = await gitState("/");
  assert.equal(g.commitHash, null);
});
