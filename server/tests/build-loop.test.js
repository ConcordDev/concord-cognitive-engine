/**
 * Phase 3 contract tests — the verifiable build loop.
 *
 * The load-bearing property is the HONESTY INVARIANT: the loop returns
 * status:"done" ONLY when the artifact ran + lint-clean + verify-passed. Unit
 * tests pin that with an injected generator + fake runMacro (deterministic, no
 * LLM); an integration test runs the loop against the REAL code macros
 * (files-write / exec / diagnostics) so the run + type-check gates are genuine.
 *
 * Run: node --test server/tests/build-loop.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { runBuildLoop } from "../lib/build-loop.js";

// ── Unit: deterministic fake runMacro driven by a per-test script ───────────
function fakeRunMacro(behavior) {
  // behavior(code) → { exec:{exitCode,stderr}, diagnostics:{problems}, verify:{verdict} }
  return async (domain, name, input) => {
    if (domain === "code" && name === "files-write") return { ok: true, result: { written: true } };
    const b = behavior(input.code ?? "");
    if (domain === "code" && name === "exec") {
      if (b.execDisabled) return { ok: false, error: "code_exec_disabled" };
      return { ok: true, result: b.exec };
    }
    if (domain === "code" && name === "diagnostics") return { ok: true, result: b.diagnostics };
    if (domain === "reason" && name === "verify") return { ok: true, verdict: b.verify?.verdict };
    return { ok: true };
  };
}

describe("build loop — honesty invariant (unit)", () => {
  it("returns done ONLY after ran + lint-clean (+ verify) all pass", async () => {
    const run = fakeRunMacro(() => ({ exec: { exitCode: 0, stderr: "" }, diagnostics: { problems: [] } }));
    const r = await runBuildLoop({ request: "x", generate: () => "console.log(1)", runMacro: run });
    assert.equal(r.ok, true);
    assert.equal(r.status, "done");
    assert.deepEqual({ ran: r.evidence.ran, lint: r.evidence.lintClean, verified: r.evidence.verified }, { ran: true, lint: true, verified: true });
  });

  it("repairs a runtime error then converges (feedback threads into generate)", async () => {
    let attempt = 0;
    const generate = (req, feedback) => {
      attempt++;
      // first attempt throws, second is clean — and the 2nd must SEE the feedback.
      if (attempt === 1) return "throw new Error('boom')";
      assert.match(String(feedback), /stderr/i, "repair generation got the run feedback");
      return "console.log('ok')";
    };
    const run = fakeRunMacro((code) =>
      code.includes("throw")
        ? { exec: { exitCode: 1, stderr: "Error: boom" }, diagnostics: { problems: [] } }
        : { exec: { exitCode: 0, stderr: "" }, diagnostics: { problems: [] } },
    );
    const r = await runBuildLoop({ request: "x", generate, runMacro: run, maxIterations: 3 });
    assert.equal(r.status, "done");
    assert.equal(r.iterations, 2);
  });

  it("NEVER reports done when code keeps throwing — returns unverified", async () => {
    const run = fakeRunMacro(() => ({ exec: { exitCode: 1, stderr: "Error: always" }, diagnostics: { problems: [] } }));
    const r = await runBuildLoop({ request: "x", generate: () => "throw 1", runMacro: run, maxIterations: 3 });
    assert.equal(r.ok, false);
    assert.equal(r.status, "unverified");
    assert.equal(r.evidence.ran, false);
  });

  it("gates on lint: runs but has an error-severity diagnostic → not done", async () => {
    const run = fakeRunMacro(() => ({ exec: { exitCode: 0, stderr: "" }, diagnostics: { problems: [{ severity: "error", line: 3, message: "Type 'string' is not assignable to type 'number'." }] } }));
    const r = await runBuildLoop({ request: "x", generate: () => "const n: number = 'x'", runMacro: run, maxIterations: 2 });
    assert.equal(r.status, "unverified");
    assert.equal(r.evidence.lintClean, false);
  });

  it("gates on verify when a claim is attached: ungrounded verdict → not done", async () => {
    const run = fakeRunMacro(() => ({ exec: { exitCode: 0, stderr: "" }, diagnostics: { problems: [] }, verify: { verdict: "unsupported" } }));
    const r = await runBuildLoop({ request: "x", generate: () => "console.log(1)", runMacro: run, claim: "the answer is 42", citations: ["dtu_1"], maxIterations: 2 });
    assert.equal(r.status, "unverified");
    assert.equal(r.evidence.verified, false);
  });

  it("honestly reports `unrun` when code execution is disabled (Phase-4 gate)", async () => {
    const run = fakeRunMacro(() => ({ execDisabled: true }));
    const r = await runBuildLoop({ request: "x", generate: () => "console.log(1)", runMacro: run });
    assert.equal(r.ok, false);
    assert.equal(r.status, "unrun");
    assert.equal(r.evidence.verified, false);
  });
});

// ── Integration: drive the loop against the REAL code macros ────────────────
describe("build loop — integration with real run + lint", () => {
  const ACTIONS = new Map();
  before(async () => {
    process.env.CONCORD_CODE_EXEC_ENABLED = "1"; // enable the node:vm run step in test
    globalThis._concordSTATE = globalThis._concordSTATE || {};
    delete globalThis._concordSTATE.codeWorkspace;
    const registerCodeActions = (await import("../domains/code.js")).default;
    registerCodeActions((domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn));
  });

  // runMacro shim: code.* → the real handlers; reason.verify → a stub.
  async function realRunMacro(domain, name, input, ctx) {
    if (domain === "reason" && name === "verify") return { ok: true, verdict: "grounded" };
    const fn = ACTIONS.get(`${domain}.${name}`);
    if (!fn) return { ok: false, error: "macro_not_found" };
    return fn(ctx, { id: null, data: {}, meta: {} }, input);
  }

  it("a bad-then-good JS generator converges to done with a genuine run + lint", async () => {
    let attempt = 0;
    const generate = (req, feedback) => {
      attempt++;
      if (attempt === 1) return "throw new Error('boom from generation 1')";
      return "const x = 2 + 2; console.log(x);";
    };
    const ctx = { userId: "u_build", actor: { userId: "u_build" } };
    const r = await runBuildLoop({ request: "add two numbers", generate, runMacro: realRunMacro, ctx, projectId: "p_build", path: "main.js", language: "javascript", maxIterations: 3 });
    assert.equal(r.status, "done", JSON.stringify(r.evidence));
    assert.equal(r.evidence.ran, true);
    assert.equal(r.evidence.lintClean, true);
    assert.ok(r.iterations >= 2, "took a repair iteration");
  });

  it("a TS type error is caught by the REAL tsc lint gate and never reported done", async () => {
    // Always emits code that runs (JS-wise) but has a TS type error → lint must fail.
    const generate = () => "const n: number = 'oops'; console.log(n);";
    const ctx = { userId: "u_build2", actor: { userId: "u_build2" } };
    const r = await runBuildLoop({ request: "typed", generate, runMacro: realRunMacro, ctx, projectId: "p_build2", path: "main.ts", language: "typescript", maxIterations: 2 });
    assert.equal(r.status, "unverified");
    assert.equal(r.evidence.lintClean, false);
  });
});
