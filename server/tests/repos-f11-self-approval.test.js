// Repos F11 — review independence: forbid self-approval, always.
//
// Founder ruling (2026-10-29, option (c), the strictest): the PR author
// can never approve their own pull request, in any repo — server-side
// refusal at the approve action. Before this build the author approved
// their own PR and it counted (Review 2's C22: "you · approve", the
// PR's 1 approval), so approval was meaningless as a check.
//
// The repos store is a per-user silo (rpFindRepo reads only the
// caller's bucket), so today every reachable approve IS the author's;
// the refusal is therefore total until a sharing model lets a second
// account reach a pull — at which point the stored authorId /
// reviewerId comparison is the exact test. Legacy pulls carry no
// authorId: reachability proves authorship, and the same refusal (and
// the pull-detail count exclusion) applies.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

globalThis._concordSTATE = {};

const { default: registerReposActions } = await import("../domains/repos.js");
const handlers = new Map();
registerReposActions((domain, name, fn) => handlers.set(`${domain}:${name}`, fn));

const U1 = { actor: { userId: "user-f11" } };
const U2 = { actor: { userId: "user-other" } };
const ANON = {};
const run = (name, ctx, params = {}) => handlers.get(`repos:${name}`)(ctx, {}, params);

async function repoWithPr(ctx = U1) {
  const created = await run("repo-create", ctx, { name: `f11-${Math.random().toString(36).slice(2, 8)}` });
  assert.equal(created.ok, true, JSON.stringify(created));
  const repoId = created.result.repo.id;
  const br = await run("branch-create", ctx, { repoId, name: "feat" });
  assert.equal(br.ok, true, JSON.stringify(br));
  const save = await run("file-save", ctx, {
    repoId, path: "src/index.ts", branch: "feat",
    content: "export function main(): void {\n  console.log('f11');\n}\n",
    message: "f11 fixture change",
  });
  assert.equal(save.ok, true, JSON.stringify(save));
  const pr = await run("pull-create", ctx, { repoId, title: "F11 fixture PR", head: "feat" });
  assert.equal(pr.ok, true, JSON.stringify(pr));
  return { repoId, number: pr.result.pull.number };
}

function storedPull(uid, repoId, number) {
  const repos = globalThis._concordSTATE.reposLens.repos.get(uid) || [];
  const repo = repos.find((r) => r.id === repoId);
  return repo.pulls.find((p) => p.number === number);
}

describe("F11: forbid self-approval always", () => {
  it("stamps the author's real id at creation (provenance for the comparison)", async () => {
    const { repoId, number } = await repoWithPr();
    assert.equal(storedPull("user-f11", repoId, number).authorId, "user-f11");
  });

  it("refuses the author's approve and records nothing", async () => {
    const { repoId, number } = await repoWithPr();
    const r = await run("pull-review", U1, { repoId, number, verdict: "approve", body: "LGTM" });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.error, "self_approval_forbidden");
    assert.match(r.message, /can't approve your own pull request/i);
    assert.equal(storedPull("user-f11", repoId, number).reviews.length, 0);
    const detail = await run("pull-detail", U1, { repoId, number });
    assert.equal(detail.result.approvals, 0);
  });

  it("refuses approve on a legacy pull (no authorId) — reachability proves authorship", async () => {
    const { repoId, number } = await repoWithPr();
    delete storedPull("user-f11", repoId, number).authorId;
    const r = await run("pull-review", U1, { repoId, number, verdict: "approve" });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.error, "self_approval_forbidden");
    assert.equal(storedPull("user-f11", repoId, number).reviews.length, 0);
  });

  it("the author can still comment and request changes on their own PR", async () => {
    const { repoId, number } = await repoWithPr();
    const c = await run("pull-review", U1, { repoId, number, verdict: "comment", body: "notes to self" });
    assert.equal(c.ok, true, JSON.stringify(c));
    const rc = await run("pull-review", U1, { repoId, number, verdict: "request-changes", body: "needs work" });
    assert.equal(rc.ok, true, JSON.stringify(rc));
    const detail = await run("pull-detail", U1, { repoId, number });
    assert.equal(detail.result.approvals, 0);
    assert.equal(detail.result.changesRequested, 1);
    // Recorded reviews carry the reviewer's real id for future comparisons.
    assert.equal(detail.result.reviews[0].reviewerId, "user-f11");
  });

  it("a recorded legacy self-approval is history, not a count", async () => {
    const { repoId, number } = await repoWithPr();
    const pull = storedPull("user-f11", repoId, number);
    delete pull.authorId; // legacy pull…
    pull.reviews.push({ id: "rev_legacy", reviewer: "you", verdict: "approve", body: "", createdAt: new Date().toISOString() }); // …with a pre-ruling self-approval
    const detail = await run("pull-detail", U1, { repoId, number });
    assert.equal(detail.result.approvals, 0);
    assert.equal(detail.result.reviews.length, 1); // history preserved in the list
  });

  it("a second account cannot even reach the pull (the silo the design rests on)", async () => {
    const { repoId, number } = await repoWithPr();
    const r = await run("pull-review", U2, { repoId, number, verdict: "approve" });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.error, /repo not found/);
  });

  it("anonymous callers cannot review at all (write guard intact)", async () => {
    const { repoId, number } = await repoWithPr();
    const r = await run("pull-review", ANON, { repoId, number, verdict: "approve" });
    assert.equal(r.ok, false, JSON.stringify(r));
  });

  it("an unknown verdict still degrades to a comment, not an approval", async () => {
    const { repoId, number } = await repoWithPr();
    const r = await run("pull-review", U1, { repoId, number, verdict: "lgtm", body: "ship it" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.review.verdict, "comment");
    const detail = await run("pull-detail", U1, { repoId, number });
    assert.equal(detail.result.approvals, 0);
  });
});
