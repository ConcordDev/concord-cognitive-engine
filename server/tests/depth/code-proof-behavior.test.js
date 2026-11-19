// tests/depth/code-proof-behavior.test.js — the Proof ledger behind the Code
// lens (server/domains/code-proof.js). Behavioural: real projects, real
// files, the real TypeScript service and lint rules, real fingerprints.
// Adversarial: stale and forged reports, another member's project, review
// after an edit, and every way past the push gate.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lensRun, depthCtx, load } from "./_harness.js";
import { __setPublicFetchTestTransport } from "../../lib/public-fetch.js";
import { clearExternalFetchCache } from "../../lib/external-fetch.js";
import { approveProposal, createProposal, _resetPushProposals } from "../../lib/code-push-governance.js";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

async function newProject(ctx, name = "proof") {
  const r = await lensRun("code", "projects-create", { params: { name } }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.project.id;
}
const write = (ctx, projectId, path, content) => lensRun("code", "files-write", { params: { projectId, path, content } }, ctx);
async function proof(ctx, projectId) {
  const r = await lensRun("code", "proof-get", { params: { projectId } }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.proof;
}
const attest = (ctx, params) => lensRun("code", "proof-attest", { params }, ctx);
const review = (ctx, params) => lensRun("code", "proof-review", { params }, ctx);

const SUM_OK = "export function sum(a: number, b: number): number {\n  return a + b;\n}\n";
const SUM_BAD = "export function sum(a: number, b: number): number {\n  return 'nope';\n}\n";
const SUM_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { sum } from './sum';\ntest('adds', () => { assert.strictEqual(sum(2, 3), 5); });\n";

/** Run every check to green on a project whose only change is src/sum.ts + its test. */
async function proveAll(ctx, projectId) {
  let p = await proof(ctx, projectId);
  const t = await attest(ctx, { projectId, check: "tests", fingerprint: p.codeFingerprint, total: 1, passed: 1, failed: 0, failures: [], files: ["src/sum.test.ts"] });
  assert.equal(t.ok, true, JSON.stringify(t));
  const r = await attest(ctx, { projectId, check: "run", fingerprint: p.codeFingerprint, path: "src/sum.ts", exitCode: 0, timedOut: false, durationMs: 12, stdout: "", stderr: "" });
  assert.equal(r.ok, true, JSON.stringify(r));
  p = await proof(ctx, projectId);
  for (const c of p.changes) {
    const rv = await review(ctx, { projectId, path: c.path, hash: c.hash });
    assert.equal(rv.ok, true, JSON.stringify(rv));
  }
  return proof(ctx, projectId);
}

describe("code.proof-get — the ledger reflects what is really in the project", () => {
  it("a project with nothing changed proves nothing and cannot push", async () => {
    const ctx = await depthCtx("proof-empty");
    const id = await newProject(ctx);
    const p = await proof(ctx, id);
    assert.equal(p.changes.length, 0);
    assert.equal(p.green, false);
    assert.equal(p.canPush, false);
    assert.ok(p.pushBlockers.includes("no_changes"));
    for (const k of p.order) assert.equal(p.checks[k].status, "not_applicable");
  });

  it("a real type error fails types with the TypeScript message; no tests is an open check, not a pass", async () => {
    const ctx = await depthCtx("proof-types");
    const id = await newProject(ctx);
    await write(ctx, id, "src/sum.ts", SUM_BAD);
    const p = await proof(ctx, id);
    assert.equal(p.base.kind, "empty");
    assert.deepEqual(p.changes.map((c) => [c.path, c.status, c.additions, c.deletions]), [["src/sum.ts", "added", 3, 0]]);
    assert.equal(p.checks.types.status, "failed");
    assert.equal(p.checks.types.engine, "typescript");
    assert.equal(p.checks.types.errors, 1);
    assert.match(p.checks.types.problems[0].message, /not assignable to type 'number'/);
    assert.equal(p.checks.types.problems[0].line, 2);
    assert.equal(p.checks.tests.status, "not_run");
    assert.match(p.checks.tests.reason, /no test files/);
    assert.equal(p.checks.run.status, "not_run");
    assert.deepEqual(p.checks.run.candidates, ["src/sum.ts"]);
    assert.equal(p.checks.review.status, "not_run");
    assert.equal(p.green, false);
    assert.deepEqual(p.open, ["types", "tests", "run", "review"]);
  });

  it("types follow imports between project files; a missing relative import is a real error", async () => {
    const ctx = await depthCtx("proof-imports");
    const id = await newProject(ctx);
    await write(ctx, id, "src/sum.ts", SUM_OK);
    await write(ctx, id, "src/use.ts", "import { sum } from './sum';\nexport const s: string = sum(1, 2);\n");
    let p = await proof(ctx, id);
    assert.equal(p.checks.types.status, "failed");
    assert.deepEqual(p.checks.types.problems.map((q) => [q.path, q.line]), [["src/use.ts", 2]]);
    assert.match(p.checks.types.problems[0].message, /'number' is not assignable to type 'string'/);
    await write(ctx, id, "src/use.ts", "import { sum } from './gone';\nexport const s = sum(1, 2);\n");
    p = await proof(ctx, id);
    assert.equal(p.checks.types.status, "failed");
    assert.match(p.checks.types.problems[0].message, /Cannot find module '.\/gone'/);
    assert.deepEqual(p.checks.types.uncheckedPackages, []);
  });

  it("lint: a loose == is a warning and fails; console.log is only a note and never blocks", async () => {
    const ctx = await depthCtx("proof-lint");
    const id = await newProject(ctx);
    await write(ctx, id, "a.js", "const x = 1;\nconsole.log(x);\n");
    let p = await proof(ctx, id);
    assert.equal(p.checks.lint.status, "proved");
    assert.equal(p.checks.lint.info, 1);
    await write(ctx, id, "a.js", "const x = 1;\nif (x == 2) console.log(x);\n");
    p = await proof(ctx, id);
    assert.equal(p.checks.lint.status, "failed");
    assert.equal(p.checks.lint.warnings, 1);
    assert.equal(p.checks.lint.problems.find((q) => q.severity === "warning").rule, "eqeqeq");
  });

  it("a broken JSON file fails types; a README-only change needs no tests or run", async () => {
    const ctx = await depthCtx("proof-json");
    const id = await newProject(ctx);
    await write(ctx, id, "config.json", "{ \"a\": 1, }");
    let p = await proof(ctx, id);
    assert.equal(p.checks.types.status, "failed");
    assert.match(p.checks.types.problems[0].message, /JSON does not parse/);
    assert.equal(p.checks.tests.status, "not_applicable");
    assert.equal(p.checks.run.status, "not_applicable");
    await lensRun("code", "files-delete", { params: { projectId: id, path: "config.json" } }, ctx);
    await write(ctx, id, "README.md", "# Hello\n");
    p = await proof(ctx, id);
    assert.equal(p.checks.types.status, "not_applicable");
    assert.equal(p.checks.tests.status, "not_applicable");
    const rv = await review(ctx, { projectId: id, path: "README.md", hash: p.changes[0].hash });
    assert.equal(rv.ok, true);
    assert.equal(rv.result.proof.green, true);
    // Green, but no GitHub remote: push stays off, with the reason.
    assert.equal(rv.result.proof.canPush, false);
    assert.deepEqual(rv.result.proof.pushBlockers, ["no_remote"]);
  });

  it("a commit moves the base: committed work is no longer the change being proved", async () => {
    const ctx = await depthCtx("proof-commit");
    const id = await newProject(ctx);
    await write(ctx, id, "a.md", "one\n");
    await lensRun("code", "git-stage", { params: { projectId: id } }, ctx);
    const c = await lensRun("code", "git-commit", { params: { projectId: id, message: "first" } }, ctx);
    assert.equal(c.ok, true);
    let p = await proof(ctx, id);
    assert.equal(p.base.kind, "head");
    assert.equal(p.changes.length, 0);
    await write(ctx, id, "a.md", "one\ntwo\n");
    p = await proof(ctx, id);
    assert.deepEqual(p.changes.map((x) => [x.path, x.status, x.additions, x.deletions]), [["a.md", "modified", 1, 0]]);
  });
});

describe("code.proof-attest — browser reports are bound to the code they ran on", () => {
  it("tests and a run go green only for the current code; any code edit makes them stale", async () => {
    const ctx = await depthCtx("proof-attest");
    const id = await newProject(ctx);
    await write(ctx, id, "src/sum.ts", SUM_OK);
    await write(ctx, id, "src/sum.test.ts", SUM_TEST);
    let p = await proveAll(ctx, id);
    assert.equal(p.checks.types.status, "proved");
    // The test imports node:test and node:assert, which have no types in a
    // project with no packages installed: named, not counted as a pass or a fail.
    assert.deepEqual(p.checks.types.uncheckedPackages, ["node:assert", "node:test"]);
    assert.equal(p.checks.tests.status, "proved");
    assert.equal(p.checks.tests.source, "browser");
    assert.deepEqual(p.checks.tests.files, ["src/sum.test.ts"]);
    assert.equal(p.checks.run.status, "proved");
    assert.equal(p.checks.run.path, "src/sum.ts");
    assert.equal(p.checks.review.status, "proved");
    assert.equal(p.green, true);

    // A non-code edit leaves tests and run standing (they depend on code only)…
    await write(ctx, id, "NOTES.md", "why\n");
    p = await proof(ctx, id);
    assert.equal(p.checks.tests.status, "proved");
    assert.equal(p.checks.review.status, "not_run"); // …but the new file still needs reading.

    // …a code edit makes both stale, and re-opens that file's review.
    await write(ctx, id, "src/sum.ts", SUM_OK + "export const zero = 0;\n");
    p = await proof(ctx, id);
    assert.equal(p.checks.tests.status, "stale");
    assert.equal(p.checks.run.status, "stale");
    assert.equal(p.changes.find((c) => c.path === "src/sum.ts").reviewed, false);
    assert.equal(p.changes.find((c) => c.path === "src/sum.test.ts").reviewed, true);
    assert.equal(p.green, false);
  });

  it("refuses a report for code that has since changed", async () => {
    const ctx = await depthCtx("proof-stale");
    const id = await newProject(ctx);
    await write(ctx, id, "src/sum.ts", SUM_OK);
    await write(ctx, id, "src/sum.test.ts", SUM_TEST);
    const before = (await proof(ctx, id)).codeFingerprint;
    await write(ctx, id, "src/sum.ts", SUM_BAD);
    const r = await attest(ctx, { projectId: id, check: "tests", fingerprint: before, total: 1, passed: 1, failed: 0, files: ["src/sum.test.ts"] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "stale_fingerprint");
    const forged = await attest(ctx, { projectId: id, check: "run", fingerprint: "0".repeat(64), path: "src/sum.ts", exitCode: 0 });
    assert.equal(forged.error, "stale_fingerprint");
    assert.equal((await proof(ctx, id)).checks.tests.status, "not_run");
  });

  it("refuses counts that do not add up, failures without detail, and unknown test files", async () => {
    const ctx = await depthCtx("proof-counts");
    const id = await newProject(ctx);
    await write(ctx, id, "src/sum.ts", SUM_OK);
    await write(ctx, id, "src/sum.test.ts", SUM_TEST);
    const fingerprint = (await proof(ctx, id)).codeFingerprint;
    const base = { projectId: id, check: "tests", fingerprint, files: ["src/sum.test.ts"] };
    assert.equal((await attest(ctx, { ...base, total: 3, passed: 3, failed: 1 })).error, "invalid_counts");
    assert.equal((await attest(ctx, { ...base, total: -1, passed: 0, failed: -1 })).error, "invalid_counts");
    assert.equal((await attest(ctx, { ...base, total: 1.5, passed: 1.5, failed: 0 })).error, "invalid_counts");
    assert.equal((await attest(ctx, { ...base, total: 2, passed: 1, failed: 1, failures: [] })).error, "invalid_counts");
    assert.equal((await attest(ctx, { ...base, total: 1, passed: 1, failed: 0, files: ["src/sum.ts", "nope.test.ts"] })).error, "no_test_files");
    assert.equal((await attest(ctx, { ...base, check: "lint", total: 1, passed: 1, failed: 0 })).error, "unknown_check");
    // Zero tests executed is a failure, not a pass.
    const zero = await attest(ctx, { ...base, total: 0, passed: 0, failed: 0 });
    assert.equal(zero.ok, true);
    assert.equal(zero.result.proof.checks.tests.status, "failed");
    assert.match(zero.result.proof.checks.tests.reason, /no tests/);
    // A real failure is recorded with its message.
    const fail = await attest(ctx, { ...base, total: 2, passed: 1, failed: 1, failures: [{ name: "adds", error: "Expected 5, got 6" }] });
    assert.equal(fail.result.proof.checks.tests.status, "failed");
    assert.deepEqual(fail.result.proof.checks.tests.failures, [{ name: "adds", error: "Expected 5, got 6" }]);
  });

  it("a run must be a real runnable file in the change, exit 0, and finish in time", async () => {
    const ctx = await depthCtx("proof-run");
    const id = await newProject(ctx);
    await write(ctx, id, "src/sum.ts", SUM_OK);
    await write(ctx, id, "src/sum.test.ts", SUM_TEST);
    await write(ctx, id, "README.md", "# r\n");
    const fingerprint = (await proof(ctx, id)).codeFingerprint;
    const run = (extra) => attest(ctx, { projectId: id, check: "run", fingerprint, ...extra });
    assert.equal((await run({ path: "README.md", exitCode: 0 })).error, "not_runnable");
    assert.equal((await run({ path: "../etc/passwd", exitCode: 0 })).error, "not_runnable");
    assert.equal((await run({ path: "src/sum.ts", exitCode: "zero" })).error, "invalid_exit_code");
    assert.equal((await run({ path: "src/sum.ts", exitCode: 1, stderr: "boom" })).result.proof.checks.run.status, "failed");
    assert.equal((await run({ path: "src/sum.ts", exitCode: 0, timedOut: true })).result.proof.checks.run.status, "failed");
    const testOnly = await run({ path: "src/sum.test.ts", exitCode: 0 });
    assert.equal(testOnly.result.proof.checks.run.status, "not_run");
    const good = await run({ path: "src/sum.ts", exitCode: 0, stdout: "x".repeat(10_000) });
    assert.equal(good.result.proof.checks.run.status, "proved");
    assert.equal(good.result.proof.checks.run.stdoutTail.length, 4000);
  });
});

describe("code.proof-review — reading the diff is part of the proof", () => {
  it("binds to the file's content: a wrong hash is refused, an edit re-opens it, and it can be un-marked", async () => {
    const ctx = await depthCtx("proof-review");
    const id = await newProject(ctx);
    await write(ctx, id, "a.md", "one\n");
    let p = await proof(ctx, id);
    assert.equal(p.changes[0].hash, sha("one\n"));
    assert.equal((await review(ctx, { projectId: id, path: "a.md", hash: sha("other") })).error, "stale_review");
    assert.equal((await review(ctx, { projectId: id, path: "nope.md", hash: "x" })).error, "not_changed");
    assert.equal((await review(ctx, { projectId: id, path: "a.md", hash: p.changes[0].hash })).result.proof.checks.review.status, "proved");
    const off = await review(ctx, { projectId: id, path: "a.md", reviewed: false });
    assert.equal(off.result.proof.checks.review.status, "not_run");
    await review(ctx, { projectId: id, path: "a.md", hash: p.changes[0].hash });
    await write(ctx, id, "a.md", "one!\n");
    p = await proof(ctx, id);
    assert.equal(p.checks.review.status, "not_run");
    assert.equal(p.checks.review.reviewed, 0);
  });

  it("an added file is all additions: an empty base is zero lines, not one blank line that was removed", async () => {
    const ctx = await depthCtx("proof-diff-empty-base");
    const id = await newProject(ctx);
    await write(ctx, id, "src/k.ts", "export const k = 1;\n  \nexport const j = 2;");
    const p = await proof(ctx, id);
    assert.deepEqual(p.changes.map((c) => [c.path, c.additions, c.deletions]), [["src/k.ts", 3, 0]]);
    const d = await lensRun("code", "proof-diff", { params: { projectId: id, path: "src/k.ts" } }, ctx);
    assert.deepEqual(d.result.hunks.map((x) => [x.type, x.newLine]), [["add", 1], ["add", 2], ["add", 3]]);
  });

  it("proof-diff returns the exact before/after the review reads, against the proof's base", async () => {
    const ctx = await depthCtx("proof-diff");
    const id = await newProject(ctx);
    await write(ctx, id, "a.md", "one\n");
    await lensRun("code", "git-stage", { params: { projectId: id } }, ctx);
    await lensRun("code", "git-commit", { params: { projectId: id, message: "c1" } }, ctx);
    await write(ctx, id, "a.md", "one\ntwo\n");
    const d = await lensRun("code", "proof-diff", { params: { projectId: id, path: "a.md" } }, ctx);
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(d.result.before, "one\n");
    assert.equal(d.result.after, "one\ntwo\n");
    assert.equal(d.result.status, "modified");
    assert.equal(d.result.hash, sha("one\ntwo\n"));
    assert.deepEqual(d.result.hunks.filter((h) => h.type === "add").map((h) => h.text), ["two"]);
    assert.equal((await lensRun("code", "proof-diff", { params: { projectId: id, path: "nope.md" } }, ctx)).error, "not_changed");
    const other = await depthCtx("proof-diff-intruder");
    assert.equal((await lensRun("code", "proof-diff", { params: { projectId: id, path: "a.md" } }, other)).error, "project not found");
  });

  it("another member cannot read or write a project's proof", async () => {
    const owner = await depthCtx("proof-owner");
    const other = await depthCtx("proof-intruder");
    const id = await newProject(owner);
    await write(owner, id, "a.md", "mine\n");
    const p = await proof(owner, id);
    assert.equal((await lensRun("code", "proof-get", { params: { projectId: id } }, other)).error, "project not found");
    assert.equal((await review(other, { projectId: id, path: "a.md", hash: p.changes[0].hash })).error, "project not found");
    assert.equal((await attest(other, { projectId: id, check: "run", fingerprint: p.codeFingerprint, path: "a.md", exitCode: 0 })).error, "project not found");
    assert.equal((await proof(owner, id)).checks.review.status, "not_run");
  });
});

describe("code.proof-push — GitHub only on a green proof, only to a new branch", () => {
  let realFetch;
  const REMOTE = { "src/sum.ts": SUM_OK.replace("a + b", "b + a"), "src/sum.test.ts": SUM_TEST, "README.md": "# demo\n" };
  before(() => {
    realFetch = globalThis.fetch;
    const fake = async (url) => {
      const u = String(url);
      const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
      if (u === "https://api.github.com/repos/acme/demo") return json({ html_url: "https://github.com/acme/demo", default_branch: "main", stargazers_count: 3 });
      if (u.startsWith("https://api.github.com/repos/acme/demo/git/trees/main")) {
        return json({ tree: Object.entries(REMOTE).map(([path, c]) => ({ path, type: "blob", size: c.length })) });
      }
      const raw = u.match(/^https:\/\/raw\.githubusercontent\.com\/acme\/demo\/main\/(.+)$/);
      if (raw && REMOTE[raw[1]] != null) return new Response(REMOTE[raw[1]], { status: 200 });
      return new Response("not found", { status: 404 });
    };
    globalThis.fetch = fake;
    __setPublicFetchTestTransport(fake);
    clearExternalFetchCache();
  });
  after(() => { globalThis.fetch = realFetch; __setPublicFetchTestTransport(null); clearExternalFetchCache(); });

  async function pulledProject(label) {
    const ctx = await depthCtx(label);
    const id = await newProject(ctx, "demo");
    const pull = await lensRun("code", "github-pull", { params: { projectId: id, owner: "acme", repo: "demo" } }, ctx);
    assert.equal(pull.ok, true, JSON.stringify(pull));
    assert.equal(pull.result.pulledFiles, 3);
    return { ctx, id };
  }

  it("measures against what GitHub had, gates on the proof, and creates a proposal with the real before/after", async () => {
    const { ctx, id } = await pulledProject("proof-push");
    let p = await proof(ctx, id);
    assert.equal(p.base.kind, "remote");
    assert.equal(p.base.label, "acme/demo @ main");
    assert.equal(p.changes.length, 0, "a fresh pull is not a change");

    await write(ctx, id, "src/sum.ts", SUM_OK);
    const push = (extra) => lensRun("code", "proof-push", { params: { projectId: id, branchName: "proof/sum", ...extra } }, ctx);

    // Not green yet: refused with the open checks named.
    p = await proof(ctx, id);
    const early = await push({ fingerprint: p.codeFingerprint });
    assert.equal(early.error, "proof_not_green");
    assert.ok(early.open.includes("tests"));

    p = await proveAll(ctx, id);
    assert.equal(p.green, true);
    assert.equal(p.canPush, true);
    assert.deepEqual(p.changes.map((c) => [c.path, c.status, c.additions, c.deletions]), [["src/sum.ts", "modified", 1, 1]]);

    assert.equal((await push({ fingerprint: "f".repeat(64) })).error, "stale_fingerprint");
    assert.equal((await push({ fingerprint: p.codeFingerprint, branchName: "main" })).error, "branch_is_base");
    assert.equal((await push({ fingerprint: p.codeFingerprint, branchName: "../../main" })).error, "invalid_branch_name");
    assert.equal((await push({ fingerprint: p.codeFingerprint, branchName: "a b" })).error, "invalid_branch_name");

    const ok = await push({ fingerprint: p.codeFingerprint, message: "Order the sum" });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.result.proposal.repo, "acme/demo");
    assert.equal(ok.result.proposal.baseRef, "main");
    assert.equal(ok.result.proposal.branchName, "proof/sum");
    assert.equal(ok.result.proposal.status, "pending");
    assert.deepEqual(ok.result.proof.checks, { types: "proved", lint: "proved", tests: "proved", run: "proved", review: "proved" });

    const list = await lensRun("code", "push-proposal-list", { params: {} }, ctx);
    assert.ok(list.result.proposals.some((x) => x.id === ok.result.proposal.id));
    assert.equal((await proof(ctx, id)).pushes[0].proposalId, ok.result.proposal.id);

    // The edit carries GitHub's own content as `before`, so approval conflict-checks it.
    const { STATE } = await load();
    const git = STATE.codeLens.gitState.get(ctx.actor.userId).get(id);
    assert.equal(git.remoteBase["src/sum.ts"], REMOTE["src/sum.ts"]);

    // Approval without a connected GitHub account fails honestly at branch-create.
    const approve = await lensRun("code", "push-proposal-approve", { params: { id: ok.result.proposal.id } }, ctx);
    assert.equal(approve.ok, false);
    assert.equal(approve.error, "branch_create_failed");
  });

  it("refuses to push a change that deletes files (the push path cannot delete yet)", async () => {
    const { ctx, id } = await pulledProject("proof-push-del");
    await lensRun("code", "files-delete", { params: { projectId: id, path: "README.md" } }, ctx);
    let p = await proof(ctx, id);
    assert.deepEqual(p.changes.map((c) => [c.path, c.status]), [["README.md", "deleted"]]);
    const rv = await review(ctx, { projectId: id, path: "README.md", hash: "deleted" });
    p = rv.result.proof;
    assert.equal(p.green, true);
    assert.equal(p.canPush, false);
    assert.deepEqual(p.pushBlockers, ["deletions_not_pushable"]);
    const r = await lensRun("code", "proof-push", { params: { projectId: id, branchName: "x", fingerprint: p.codeFingerprint } }, ctx);
    assert.equal(r.error, "proof_not_green");
  });
});

describe("code-push-governance — a new file is created, a missing existing file is a failure", () => {
  it("commits a brand-new file without a sha when GitHub says 404; refuses a 404 for a file expected to exist", async () => {
    _resetPushProposals();
    const calls = [];
    const runMacro = async (domain, name, params) => {
      calls.push([name, params.path, params.sha]);
      if (name === "branch-create") return { ok: true, result: {} };
      if (name === "file-get") return { ok: false, error: "provider_error", detail: { ok: false, reason: "provider_error", status: 404 } };
      if (name === "file-commit") return { ok: true, result: { commitSha: `c-${params.path}` } };
      throw new Error(name);
    };
    const fresh = createProposal({ userId: "u1", repo: "a/b", baseRef: "main", branchName: "n", edits: [{ filename: "new.ts", before: "", after: "x\n" }] });
    const r1 = await approveProposal(fresh.id, "u1", runMacro, {});
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.deepEqual(calls.find((c) => c[0] === "file-commit"), ["file-commit", "new.ts", undefined]);

    const gone = createProposal({ userId: "u1", repo: "a/b", baseRef: "main", branchName: "m", edits: [{ filename: "old.ts", before: "was here\n", after: "y\n" }] });
    const r2 = await approveProposal(gone.id, "u1", runMacro, {});
    assert.equal(r2.ok, false);
    assert.equal(r2.pushResult.failed[0].stage, "file-get");
  });
});
