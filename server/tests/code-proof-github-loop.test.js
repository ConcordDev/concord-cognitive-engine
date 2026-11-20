// The whole Proof loop against a stand-in GitHub: import a repository from a
// connected account, change it, prove the change, propose the push, approve
// it, and watch the commits land on a NEW branch with GitHub's own content
// as the conflict base. GitHub itself is a recorded shim (no network); every
// code.* call is the real registered handler.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCodeActions from "../domains/code.js";
import { _resetPushProposals } from "../lib/code-push-governance.js";

const ACTIONS = new Map();
const register = (domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn);

const REMOTE = {
  "src/greet.ts": "export function greet(name: string): string {\n  return 'hi ' + name;\n}\n",
  "src/greet.test.ts": "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { greet } from './greet';\ntest('greets', () => { assert.strictEqual(greet('a'), 'hi a'); });\n",
  "README.md": "# greet\n",
  "logo.png": "binary",
};

function github(calls, { remote = REMOTE, treeOk = true } = {}) {
  return {
    "github.repo-tree": async (p) => treeOk
      ? { ok: true, result: { ref: "main", truncated: false, tree: Object.entries(remote).map(([path, c]) => ({ path, type: "blob", size: c.length })) } }
      : { ok: false, error: "not_connected" },
    "github.file-get": async (p) => {
      // Before the branch exists only base content is readable; on the new
      // branch, a file is whatever was last committed there (or the base).
      const branchFile = calls.committed?.[`${p.ref}:${p.path}`];
      if (branchFile != null) return { ok: true, result: { path: p.path, sha: `sha-${p.path}-2`, content: branchFile } };
      if (remote[p.path] != null) return { ok: true, result: { path: p.path, sha: `sha-${p.path}`, content: remote[p.path] } };
      return { ok: false, error: "provider_error", detail: { status: 404 } };
    },
    "github.branch-create": async (p) => ({ ok: true, result: { ref: `refs/heads/${p.branchName}` } }),
    "github.file-commit": async (p) => {
      calls.committed = calls.committed || {};
      calls.committed[`${p.branch}:${p.path}`] = p.content;
      calls.commits.push({ path: p.path, branch: p.branch, sha: p.sha ?? null });
      return { ok: true, result: { commitSha: `c-${p.path}` } };
    },
  };
}

function ctxFor(userId, mocks, calls) {
  const ctx = { actor: { userId }, userId };
  ctx.runMacro = async (domain, name, params, c) => {
    calls.log.push(`${domain}.${name}`);
    if (domain === "code") return ACTIONS.get(`code.${name}`)(c || ctx, { id: null, data: {}, meta: {} }, params);
    const fn = mocks[`${domain}.${name}`];
    if (!fn) throw new Error(`unexpected ${domain}.${name}`);
    return fn(params);
  };
  return ctx;
}
const call = (ctx, name, params = {}) => ACTIONS.get(`code.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);

before(() => registerCodeActions(register));
beforeEach(() => {
  _resetPushProposals();
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("code.github-import → proof → push → approve", () => {
  it("lands the proved change on a new branch, conflict-checked against GitHub's content", async () => {
    const calls = { log: [], commits: [] };
    const ctx = ctxFor("u_loop", github(calls), calls);

    const imp = await call(ctx, "github-import", { repo: "acme/greet" });
    assert.equal(imp.ok, true, JSON.stringify(imp));
    assert.equal(imp.result.imported, 3, "the binary logo.png is skipped as non-text");
    const projectId = imp.result.project.id;
    assert.equal(imp.result.project.name, "greet");

    let p = (await call(ctx, "proof-get", { projectId })).result.proof;
    assert.equal(p.base.kind, "remote");
    assert.equal(p.base.label, "acme/greet @ main");
    assert.equal(p.changes.length, 0);

    // Change the code and add a brand-new file.
    await call(ctx, "files-write", { projectId, path: "src/greet.ts", content: "export function greet(name: string): string {\n  return `hello ${name}`;\n}\n" });
    await call(ctx, "files-write", { projectId, path: "CHANGELOG.md", content: "- friendlier greeting\n" });
    p = (await call(ctx, "proof-get", { projectId })).result.proof;
    assert.deepEqual(p.changes.map((c) => [c.path, c.status]), [["CHANGELOG.md", "added"], ["src/greet.ts", "modified"]]);
    assert.equal(p.canPush, false);

    const fp = p.codeFingerprint;
    assert.equal((await call(ctx, "proof-attest", { projectId, check: "tests", fingerprint: fp, total: 1, passed: 1, failed: 0, files: ["src/greet.test.ts"] })).ok, true);
    assert.equal((await call(ctx, "proof-attest", { projectId, check: "run", fingerprint: fp, path: "src/greet.ts", exitCode: 0 })).ok, true);
    for (const c of p.changes) assert.equal((await call(ctx, "proof-review", { projectId, path: c.path, hash: c.hash })).ok, true);
    p = (await call(ctx, "proof-get", { projectId })).result.proof;
    assert.equal(p.green, true);
    assert.equal(p.canPush, true);

    const push = await call(ctx, "proof-push", { projectId, branchName: "proof/greeting", fingerprint: p.codeFingerprint, message: "Friendlier greeting" });
    assert.equal(push.ok, true, JSON.stringify(push));
    assert.equal(calls.log.includes("github.branch-create"), false, "proposing pushes nothing");

    const approved = await call(ctx, "push-proposal-approve", { id: push.result.proposal.id });
    assert.equal(approved.ok, true, JSON.stringify(approved));
    assert.equal(approved.result.proposal.status, "pushed");
    assert.deepEqual(calls.commits, [
      { path: "CHANGELOG.md", branch: "proof/greeting", sha: null },
      { path: "src/greet.ts", branch: "proof/greeting", sha: "sha-src/greet.ts" },
    ]);
  });

  it("a remote that changed under the proposal is a conflict, and nothing after it is pushed", async () => {
    const calls = { log: [], commits: [] };
    const remote = { ...REMOTE };
    const ctx = ctxFor("u_conflict", github(calls, { remote }), calls);
    const projectId = (await call(ctx, "github-import", { repo: "acme/greet" })).result.project.id;
    await call(ctx, "files-write", { projectId, path: "README.md", content: "# greet!\n" });
    let p = (await call(ctx, "proof-get", { projectId })).result.proof;
    await call(ctx, "proof-review", { projectId, path: "README.md", hash: p.changes[0].hash });
    p = (await call(ctx, "proof-get", { projectId })).result.proof;
    const push = await call(ctx, "proof-push", { projectId, branchName: "b1", fingerprint: p.codeFingerprint });
    remote["README.md"] = "# someone else\n";
    const r = await call(ctx, "push-proposal-approve", { id: push.result.proposal.id });
    assert.equal(r.ok, false);
    assert.equal(r.result.proposal.status, "conflict");
    assert.deepEqual(calls.commits, []);
  });

  it("refuses bad repo names, an unconnected account, and anonymous callers", async () => {
    const calls = { log: [], commits: [] };
    const ctx = ctxFor("u_bad", github(calls, { treeOk: false }), calls);
    assert.equal((await call(ctx, "github-import", { repo: "../../etc" })).error, "invalid_repo");
    assert.equal((await call(ctx, "github-import", { repo: "acme" })).error, "invalid_repo");
    const off = await call(ctx, "github-import", { repo: "acme/greet" });
    assert.equal(off.ok, false);
    assert.equal(off.error, "not_connected");
    assert.equal((await call(ctxFor("anon", github(calls), calls), "github-import", { repo: "acme/greet" })).error, "auth_required", "the domain anon-write guard refuses before the handler");
    assert.equal((await call(ctx, "projects-list")).result.projects.length, 0, "a failed import creates no project");
  });
});
