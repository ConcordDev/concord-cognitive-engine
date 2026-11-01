// Repos ahead-counts — the divergence numbers at their source.
//
// Review 2's scoped re-verification found NO ahead/behind counts
// displayed at any of the three canonical locations, although the
// ancestry machinery existed: branch-list's `commits` field was
// silently the ahead-vs-default number for non-default branches.
// branch-list now returns explicit ahead/behind per branch (vs the
// default branch) and pull-detail returns ahead/behind for its
// head vs base. These tests pin the numbers against staged history.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};

const { default: registerReposActions } = await import("../domains/repos.js");
const handlers = new Map();
registerReposActions((domain, name, fn) => handlers.set(`${domain}:${name}`, fn));

const U1 = { actor: { userId: "user-ahead" } };
const run = (name, params = {}) => handlers.get(`repos:${name}`)(U1, {}, params);
const save = (repoId, branch, path, content) =>
  run("file-save", { repoId, path, branch, content, message: `commit ${path} on ${branch}` });

describe("ahead/behind — branch-list and pull-detail carry the real divergence", () => {
  it("counts move with history on both sides of the fork", async () => {
    const created = await run("repo-create", { name: `ahead-${Math.random().toString(36).slice(2, 8)}` });
    assert.equal(created.ok, true, JSON.stringify(created));
    const repoId = created.result.repo.id;
    await run("branch-create", { repoId, name: "feat" });

    // One commit on feat: ahead 1, behind 0.
    const s1 = await save(repoId, "feat", "src/a.ts", "export const a = 1;\n");
    assert.equal(s1.ok, true, JSON.stringify(s1));
    let list = await run("branch-list", { repoId });
    let feat = list.result.branches.find((b) => b.name === "feat");
    let main = list.result.branches.find((b) => b.name === "main");
    assert.equal(feat.ahead, 1);
    assert.equal(feat.behind, 0);
    assert.equal(feat.commits, 1, "commits keeps meaning the branch's own (ahead) count");
    assert.equal(main.ahead, 0);
    assert.equal(main.behind, 0);

    // A commit lands on main after the fork: feat falls behind 1.
    const s2 = await save(repoId, "main", "src/b.ts", "export const b = 2;\n");
    assert.equal(s2.ok, true, JSON.stringify(s2));
    list = await run("branch-list", { repoId });
    feat = list.result.branches.find((b) => b.name === "feat");
    assert.equal(feat.ahead, 1);
    assert.equal(feat.behind, 1);

    // The PR page numbers: same divergence, head vs base.
    const pr = await run("pull-create", { repoId, title: "ahead fixture", head: "feat" });
    assert.equal(pr.ok, true, JSON.stringify(pr));
    const detail = await run("pull-detail", { repoId, number: pr.result.pull.number });
    assert.equal(detail.result.ahead, 1);
    assert.equal(detail.result.behind, 1);
  });

  it("a fresh branch with no commits of its own reads 0 ahead — never its parent's history", async () => {
    const created = await run("repo-create", { name: `ahead2-${Math.random().toString(36).slice(2, 8)}` });
    const repoId = created.result.repo.id;
    await run("branch-create", { repoId, name: "fresh" });
    const list = await run("branch-list", { repoId });
    const fresh = list.result.branches.find((b) => b.name === "fresh");
    assert.equal(fresh.ahead, 0);
    assert.equal(fresh.behind, 0);
  });
});
