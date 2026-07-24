// server/tests/code-push-governance.test.js
//
// Contract tests for GH-3c — server/lib/code-push-governance.js and its
// thin macro wrappers in server/domains/code.js:
//   code.push-proposal-create / -list / -approve / -reject
//
// Pure-Node Tier-2 contract tests; no server boot, no HTTP, no live
// network. Mirrors the established harness in code-verify-retry.test.js /
// github-code-lens-macros.test.js: direct import of `registerCodeActions`,
// a local ACTIONS map, and a `runMacro` shim the test supplies per-case so
// the `github.*` calls this module makes are genuinely exercised against
// controlled responses (never real egress).
//
// Covers: create -> list -> approve happy path (all files pushed to the new
// branch, never the base ref); reject discards without any GitHub call;
// approve with a genuine sha/content conflict reports it honestly and never
// commits that file; per-user isolation (user A can never see, approve, or
// reject user B's proposal); and the never-push-to-base-branch invariant
// (branch-create is always called with the proposal's own branchName, never
// the base ref, and every file-commit targets that same new branch).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCodeActions from "../domains/code.js";
import { _resetPushProposals } from "../lib/code-push-governance.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`code.${name}`);
  assert.ok(fn, `code.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerCodeActions(register);
});

beforeEach(() => {
  _resetPushProposals();
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

function ctxFor(userId) {
  return { actor: { userId }, userId };
}

/** A runMacro shim: dispatches "code.*" to the real registered handlers
 * (so push-proposal-create's re-derive path genuinely exercises
 * propose-verified-patch when a test wants that), and "github.*" to a
 * test-supplied mock map recording every call it received. */
function makeRunMacro(githubMocks = {}, calls = []) {
  return async (domain, name, params, callCtx) => {
    calls.push({ domain, name, params });
    if (domain === "code") {
      const fn = ACTIONS.get(`code.${name}`);
      if (!fn) return { ok: false, error: `not registered: code.${name}` };
      return await fn(callCtx, { id: null, data: {}, meta: {} }, params);
    }
    const key = `${domain}.${name}`;
    if (typeof githubMocks[key] === "function") return await githubMocks[key](params, callCtx);
    throw new Error(`unexpected runMacro(${domain}, ${name})`);
  };
}

const BEFORE_A = "console.log('a');\n";
const AFTER_A = "console.log('A!');\n";
const BEFORE_B = "console.log('b');\n";
const AFTER_B = "console.log('B!');\n";

/** A verified propose-verified-patch-shaped result, matching what GH-3b
 * actually returns on success, for tests that supply `patch` directly
 * rather than exercising the re-derive path. */
function verifiedPatch(edits) {
  return {
    ok: true,
    result: {
      edits,
      verification: { ok: true, files: edits.map((e) => ({ filename: e.filename, ok: true })) },
      attemptsUsed: 1,
    },
  };
}

function twoFileGithubMocks({ branchOk = true, freshContentA = BEFORE_A, freshContentB = BEFORE_B, commitOk = true } = {}) {
  return {
    "github.branch-create": async (params) => {
      if (!branchOk) return { ok: false, error: "branch_exists" };
      return { ok: true, result: { ref: `refs/heads/${params.branchName}`, sha: "branch-sha-1" } };
    },
    "github.file-get": async (params) => {
      const content = params.path === "a.js" ? freshContentA : freshContentB;
      return { ok: true, result: { path: params.path, sha: `sha-${params.path}`, content } };
    },
    "github.file-commit": async (params) => {
      if (!commitOk) return { ok: false, error: "commit_failed" };
      return { ok: true, result: { commitSha: `commit-${params.path}`, fileSha: `newsha-${params.path}`, path: params.path, htmlUrl: `https://github.com/x/y/blob/${params.branch}/${params.path}` } };
    },
  };
}

describe("code.push-proposal-create -> list -> approve: happy path", () => {
  it("pushes every file to the NEW branch, never the base ref", async () => {
    const ctx = ctxFor("u_happy");
    const patch = verifiedPatch([
      { filename: "a.js", before: BEFORE_A, after: AFTER_A, reason: "shout a" },
      { filename: "b.js", before: BEFORE_B, after: AFTER_B, reason: "shout b" },
    ]);

    const created = await call("push-proposal-create", ctx, {
      repo: "acme/widgets", ref: "main", branchName: "concord/patch-1", patch,
    });
    assert.equal(created.ok, true);
    assert.equal(created.result.proposal.status, "pending");
    assert.equal(created.result.proposal.fileCount, 2);
    assert.equal(created.result.proposal.branchName, "concord/patch-1");
    const id = created.result.proposal.id;

    const listed = call("push-proposal-list", ctx, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.proposals.length, 1);
    assert.equal(listed.result.proposals[0].id, id);

    const calls = [];
    const runMacro = makeRunMacro(twoFileGithubMocks(), calls);
    const ctxBrain = { ...ctx, runMacro };
    const approved = await ACTIONS.get("code.push-proposal-approve")(ctxBrain, { id: null, data: {}, meta: {} }, { id });

    assert.equal(approved.ok, true);
    assert.equal(approved.result.proposal.status, "pushed");
    assert.equal(approved.pushResult.ok, true);
    assert.equal(approved.pushResult.committed.length, 2);
    assert.equal(approved.pushResult.conflicts.length, 0);
    assert.equal(approved.pushResult.failed.length, 0);

    // Never pushed to the base ref: branch-create always targets the
    // proposal's own branchName, and every commit's `branch` param matches
    // it too — the base ref "main" never appears as a commit/branch target.
    const branchCreateCalls = calls.filter((c) => c.domain === "github" && c.name === "branch-create");
    assert.equal(branchCreateCalls.length, 1);
    assert.equal(branchCreateCalls[0].params.branchName, "concord/patch-1");
    assert.equal(branchCreateCalls[0].params.fromRef, "main");
    assert.notEqual(branchCreateCalls[0].params.branchName, "main");

    const commitCalls = calls.filter((c) => c.domain === "github" && c.name === "file-commit");
    assert.equal(commitCalls.length, 2);
    for (const c of commitCalls) {
      assert.equal(c.params.branch, "concord/patch-1");
      assert.notEqual(c.params.branch, "main");
    }

    // Approving again must not double-push.
    const secondApprove = await ACTIONS.get("code.push-proposal-approve")(ctxBrain, { id: null, data: {}, meta: {} }, { id });
    assert.equal(secondApprove.ok, false);
    assert.equal(secondApprove.error, "wrong_state");
    assert.equal(commitCalls.length, 2, "no additional commits happened on the re-approve attempt");
  });
});

describe("code.push-proposal-reject", () => {
  it("discards a pending proposal and makes NO GitHub calls at all", async () => {
    const ctx = ctxFor("u_reject");
    const patch = verifiedPatch([{ filename: "a.js", before: BEFORE_A, after: AFTER_A, reason: "x" }]);
    const created = await call("push-proposal-create", ctx, { repo: "acme/widgets", ref: "main", branchName: "concord/patch-r", patch });
    const id = created.result.proposal.id;

    const r = call("push-proposal-reject", ctx, { id, reason: "not needed" });
    assert.equal(r.ok, true);
    assert.equal(r.result.proposal.status, "rejected");
    assert.equal(r.result.proposal.rejectReason, "not needed");

    const listed = call("push-proposal-list", ctx, {});
    assert.equal(listed.result.proposals[0].status, "rejected");

    // Approve after reject must fail cleanly — the proposal is terminal.
    const calls = [];
    const runMacro = makeRunMacro(twoFileGithubMocks(), calls);
    const approveAfterReject = await ACTIONS.get("code.push-proposal-approve")({ ...ctx, runMacro }, { id: null, data: {}, meta: {} }, { id });
    assert.equal(approveAfterReject.ok, false);
    assert.equal(approveAfterReject.error, "wrong_state");
    assert.equal(calls.length, 0, "reject + a failed approve attempt made zero GitHub calls");
  });
});

describe("code.push-proposal-approve: genuine sha/content conflict", () => {
  it("reports the conflict honestly and never commits the conflicting file", async () => {
    const ctx = ctxFor("u_conflict");
    const patch = verifiedPatch([{ filename: "a.js", before: BEFORE_A, after: AFTER_A, reason: "shout a" }]);
    const created = await call("push-proposal-create", ctx, { repo: "acme/widgets", ref: "main", branchName: "concord/patch-c", patch });
    const id = created.result.proposal.id;

    const calls = [];
    // Someone else changed a.js on GitHub since the proposal was created —
    // the fresh file-get returns content that does NOT match edit.before.
    const runMacro = makeRunMacro(twoFileGithubMocks({ freshContentA: "console.log('someone else changed this');\n" }), calls);
    const r = await ACTIONS.get("code.push-proposal-approve")({ ...ctx, runMacro }, { id: null, data: {}, meta: {} }, { id });

    assert.equal(r.ok, false);
    assert.equal(r.result.proposal.status, "conflict");
    assert.equal(r.pushResult.ok, false);
    assert.equal(r.pushResult.conflicts.length, 1);
    assert.equal(r.pushResult.conflicts[0].filename, "a.js");
    assert.equal(r.pushResult.committed.length, 0);

    const commitCalls = calls.filter((c) => c.domain === "github" && c.name === "file-commit");
    assert.equal(commitCalls.length, 0, "a conflicting file must never be committed");
    // branch-create and the fresh file-get for the conflicting file DID run.
    const branchCreateCalls = calls.filter((c) => c.domain === "github" && c.name === "branch-create");
    assert.equal(branchCreateCalls.length, 1);
  });

  it("stops at the first conflict in a multi-file proposal and reports commit/conflict/skip honestly", async () => {
    const ctx = ctxFor("u_conflict_multi");
    // a.js conflicts; b.js would have been fine but is never attempted.
    const patch = verifiedPatch([
      { filename: "a.js", before: BEFORE_A, after: AFTER_A, reason: "x" },
      { filename: "b.js", before: BEFORE_B, after: AFTER_B, reason: "y" },
    ]);
    const created = await call("push-proposal-create", ctx, { repo: "acme/widgets", ref: "main", branchName: "concord/patch-cm", patch });
    const id = created.result.proposal.id;

    const runMacro = makeRunMacro(twoFileGithubMocks({ freshContentA: "changed remotely\n" }));
    const r = await ACTIONS.get("code.push-proposal-approve")({ ...ctx, runMacro }, { id: null, data: {}, meta: {} }, { id });

    assert.equal(r.ok, false);
    assert.equal(r.pushResult.conflicts.length, 1);
    assert.equal(r.pushResult.conflicts[0].filename, "a.js");
    assert.equal(r.pushResult.committed.length, 0);
    assert.deepEqual(r.pushResult.skipped, ["b.js"]);
  });
});

describe("code.push-proposal: per-user isolation", () => {
  it("user B can never see, approve, or reject user A's proposal", async () => {
    const ctxA = ctxFor("u_A");
    const ctxB = ctxFor("u_B");
    const patch = verifiedPatch([{ filename: "a.js", before: BEFORE_A, after: AFTER_A, reason: "x" }]);
    const created = await call("push-proposal-create", ctxA, { repo: "acme/widgets", ref: "main", branchName: "concord/patch-iso", patch });
    const id = created.result.proposal.id;

    // B's list never contains A's proposal.
    const listedByB = call("push-proposal-list", ctxB, {});
    assert.equal(listedByB.ok, true);
    assert.equal(listedByB.result.proposals.length, 0);

    // A's own list DOES contain it.
    const listedByA = call("push-proposal-list", ctxA, {});
    assert.equal(listedByA.result.proposals.length, 1);

    // B cannot reject A's proposal.
    const rejectByB = call("push-proposal-reject", ctxB, { id });
    assert.equal(rejectByB.ok, false);
    assert.equal(rejectByB.error, "not_found");

    // B cannot approve A's proposal — and critically, no GitHub call is
    // ever attempted on this path (the security-relevant assertion: a
    // cross-user approve attempt must not even reach GitHub).
    const calls = [];
    const runMacro = makeRunMacro(twoFileGithubMocks(), calls);
    const approveByB = await ACTIONS.get("code.push-proposal-approve")({ ...ctxB, runMacro }, { id: null, data: {}, meta: {} }, { id });
    assert.equal(approveByB.ok, false);
    assert.equal(approveByB.error, "not_found");
    assert.equal(calls.length, 0);

    // A's own approve on the SAME id still works normally afterward.
    const approveByA = await ACTIONS.get("code.push-proposal-approve")({ ...ctxA, runMacro }, { id: null, data: {}, meta: {} }, { id });
    assert.equal(approveByA.ok, true);
    assert.equal(approveByA.result.proposal.status, "pushed");
  });
});

describe("code.push-proposal-create: input validation and honesty gates", () => {
  it("rejects branchName === ref outright", async () => {
    const ctx = ctxFor("u_bad1");
    const patch = verifiedPatch([{ filename: "a.js", before: BEFORE_A, after: AFTER_A, reason: "x" }]);
    const r = await call("push-proposal-create", ctx, { repo: "acme/widgets", ref: "main", branchName: "main", patch });
    assert.equal(r.ok, false);
    assert.match(r.error, /base branch|base ref/);
  });

  it("rejects a patch that never actually succeeded (ok:false propose-verified-patch result)", async () => {
    const ctx = ctxFor("u_bad2");
    const failedPatch = { ok: false, reason: "retries_exhausted", attempts: [] };
    const r = await call("push-proposal-create", ctx, { repo: "acme/widgets", ref: "main", branchName: "concord/x", patch: failedPatch });
    assert.equal(r.ok, false);
    assert.match(r.error, /verified patch/);
  });

  it("rejects a patch whose own verification.ok is false", async () => {
    const ctx = ctxFor("u_bad3");
    const patch = {
      ok: true,
      result: { edits: [{ filename: "a.js", before: BEFORE_A, after: AFTER_A }], verification: { ok: false } },
    };
    const r = await call("push-proposal-create", ctx, { repo: "acme/widgets", ref: "main", branchName: "concord/x", patch });
    assert.equal(r.ok, false);
    assert.match(r.error, /verification/);
  });

  it("rejects missing repo/ref/branchName", async () => {
    const ctx = ctxFor("u_bad4");
    const patch = verifiedPatch([{ filename: "a.js", before: BEFORE_A, after: AFTER_A }]);
    assert.equal((await call("push-proposal-create", ctx, { ref: "main", branchName: "x", patch })).ok, false);
    assert.equal((await call("push-proposal-create", ctx, { repo: "acme/widgets", branchName: "x", patch })).ok, false);
    assert.equal((await call("push-proposal-create", ctx, { repo: "acme/widgets", ref: "main", patch })).ok, false);
  });
});

describe("code.push-proposal-create: re-derives a patch via propose-verified-patch when none is supplied", () => {
  it("calls code.propose-verified-patch itself and only proceeds on a real success", async () => {
    const ctx = ctxFor("u_derive");
    const proj = call("projects-create", ctx, { name: "PushDerive" }).result.project;
    call("files-write", ctx, { projectId: proj.id, path: "a.js", content: BEFORE_A });

    const llm = {
      chat: async () => ({
        text: JSON.stringify({ edits: [{ filename: "a.js", before: BEFORE_A, after: AFTER_A, reason: "shout it" }] }),
      }),
    };
    const calls = [];
    const runMacro = makeRunMacro({}, calls);
    const ctxBrain = { ...ctx, llm, runMacro };

    const r = await ACTIONS.get("code.push-proposal-create")(ctxBrain, { id: null, data: {}, meta: {} }, {
      repo: "acme/widgets", ref: "main", branchName: "concord/derived", projectId: proj.id, taskQuery: "shout it",
    });

    assert.equal(r.ok, true);
    assert.equal(r.result.proposal.fileCount, 1);
    const deriveCalls = calls.filter((c) => c.domain === "code" && c.name === "propose-verified-patch");
    assert.equal(deriveCalls.length, 1);
  });
});
