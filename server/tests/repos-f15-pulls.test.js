// Repos F15 — the pull-request close path (server half).
//
// Before this build a PR could only leave OPEN by merging: no macro
// wrote the "closed" state the FE already rendered a pill for, so a
// stale pull — and any branch under it, whose delete guard reads
// "merge or close it first" — was stuck forever. pull-set-state
// mirrors issue-set-state's shape, with the guard issues don't need:
// merged is terminal history and refuses both directions.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};

const { default: registerReposActions } = await import("../domains/repos.js");
const handlers = new Map();
registerReposActions((domain, name, fn) => handlers.set(`${domain}:${name}`, fn));

const U1 = { actor: { userId: "user-f15" } };
const ANON = {};
const run = (name, ctx, params = {}) => handlers.get(`repos:${name}`)(ctx, {}, params);

async function repoWithPr() {
  const created = await run("repo-create", U1, { name: `f15-${Math.random().toString(36).slice(2, 8)}` });
  assert.equal(created.ok, true, JSON.stringify(created));
  const repoId = created.result.repo.id;
  const br = await run("branch-create", U1, { repoId, name: "feat" });
  assert.equal(br.ok, true, JSON.stringify(br));
  const save = await run("file-save", U1, {
    repoId, path: "src/index.ts", branch: "feat",
    content: "export function main(): void {\n  console.log('f15');\n}\n",
    message: "f15 fixture change",
  });
  assert.equal(save.ok, true, JSON.stringify(save));
  const pr = await run("pull-create", U1, { repoId, title: "F15 fixture PR", head: "feat" });
  assert.equal(pr.ok, true, JSON.stringify(pr));
  return { repoId, number: pr.result.pull.number };
}

describe("F15: pull-set-state — the close path", () => {
  it("closes an open PR and the state reads back closed", async () => {
    const { repoId, number } = await repoWithPr();
    const r = await run("pull-set-state", U1, { repoId, number, state: "closed" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.state, "closed");
    const detail = await run("pull-detail", U1, { repoId, number });
    assert.equal(detail.result.pull.state, "closed");
  });

  it("reopens a closed PR", async () => {
    const { repoId, number } = await repoWithPr();
    await run("pull-set-state", U1, { repoId, number, state: "closed" });
    const r = await run("pull-set-state", U1, { repoId, number, state: "open" });
    assert.equal(r.ok, true, JSON.stringify(r));
    const detail = await run("pull-detail", U1, { repoId, number });
    assert.equal(detail.result.pull.state, "open");
  });

  it("closing a PR unblocks its branch's deletion (the guard's own sentence)", async () => {
    const { repoId, number } = await repoWithPr();
    const blocked = await run("branch-delete", U1, { repoId, name: "feat" });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "branch_in_open_pr");
    await run("pull-set-state", U1, { repoId, number, state: "closed" });
    const freed = await run("branch-delete", U1, { repoId, name: "feat" });
    assert.equal(freed.ok, true, JSON.stringify(freed));
  });

  it("a merged pull refuses both directions — merged is terminal", async () => {
    const { repoId, number } = await repoWithPr();
    const merged = await run("pull-merge", U1, { repoId, number });
    assert.equal(merged.ok, true, JSON.stringify(merged));
    const close = await run("pull-set-state", U1, { repoId, number, state: "closed" });
    assert.equal(close.ok, false);
    assert.equal(close.error, "pull_merged");
    assert.match(close.message, /merged/);
    const reopen = await run("pull-set-state", U1, { repoId, number, state: "open" });
    assert.equal(reopen.ok, false);
    assert.equal(reopen.error, "pull_merged");
    const detail = await run("pull-detail", U1, { repoId, number });
    assert.equal(detail.result.pull.state, "merged");
  });

  it("refuses an invalid state and an unknown pull, truthfully", async () => {
    const { repoId, number } = await repoWithPr();
    const bad = await run("pull-set-state", U1, { repoId, number, state: "merged" });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_state");
    const ghost = await run("pull-set-state", U1, { repoId, number: 9999, state: "closed" });
    assert.equal(ghost.ok, false);
  });

  it("anonymous callers cannot move a pull's state (write guard)", async () => {
    const { repoId, number } = await repoWithPr();
    const r = await run("pull-set-state", ANON, { repoId, number, state: "closed" });
    assert.equal(r.ok, false, JSON.stringify(r));
    const detail = await run("pull-detail", U1, { repoId, number });
    assert.equal(detail.result.pull.state, "open");
  });
});
