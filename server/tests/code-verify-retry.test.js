// server/tests/code-verify-retry.test.js
//
// Contract tests for GH-3b — server/domains/code.js's
// `code.propose-verified-patch`: a plan → apply → verify → retry loop that
// gives Concord's own local brains real failure feedback instead of a single
// unverified guess. Pure-Node Tier-2 contract tests; no server boot, no HTTP,
// no live LLM/Ollama — mirrors the existing `code-domain-parity.test.js` /
// `code-retrieval.test.js` harness (direct import of `registerCodeActions`,
// in-memory `_concordSTATE`, a local ACTIONS map + a `runMacro` shim that
// dispatches same-domain "code.*" calls to that same map for real end-to-end
// exercise of `multi-file-plan` + `multi-file-apply`).
//
// Covers: succeeds first try; fails once then succeeds on retry (with the
// concrete failure detail actually reaching the second LLM prompt); exhausts
// retries and returns the honest failure shape (never a fabricated success);
// the maxRetries cap (3) is enforced even when the caller asks for more; and
// the honest "no sandboxed execution" degrade path for a third-party GitHub
// repo (verification still runs — structural + syntax — but real test
// execution is never attempted, and nothing is ever pushed/written).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCodeActions from "../domains/code.js";

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
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

function ctxFor(userId) {
  return { actor: { userId }, userId };
}

/** A runMacro shim that dispatches "code.*" calls to the real registered
 * handlers (so multi-file-plan/multi-file-apply are genuinely exercised, not
 * mocked) and lets a test supply extra handlers for other domains (e.g.
 * "github.repo-tree" for the third-party-repo path). */
function makeRunMacro(extra = {}) {
  return async (domain, name, params, callCtx) => {
    if (domain === "code") {
      const fn = ACTIONS.get(`code.${name}`);
      if (!fn) return { ok: false, error: `not registered: code.${name}` };
      return await fn(callCtx, { id: null, data: {}, meta: {} }, params);
    }
    const key = `${domain}.${name}`;
    if (typeof extra[key] === "function") return await extra[key](params, callCtx);
    throw new Error(`unexpected runMacro(${domain}, ${name})`);
  };
}

const GREET_BEFORE = "function greet(name) {\n  return 'hi ' + name;\n}\n";
const GREET_AFTER_GOOD = "function greet(name) {\n  return 'Hello, ' + name + '!';\n}\n";
// Missing closing brace — a real, unambiguous JS/TS syntax error.
const GREET_AFTER_BROKEN = "function greet(name) {\n  return 'hi ' + name;\n";

describe("code.propose-verified-patch: first-try success", () => {
  it("returns ok:true with attemptsUsed:1 when the plan passes verification immediately", async () => {
    const ctx = ctxFor("u_success");
    const proj = call("projects-create", ctx, { name: "P1" }).result.project;
    call("files-write", ctx, { projectId: proj.id, path: "greet.js", content: GREET_BEFORE });

    let chatCalls = 0;
    const llm = {
      chat: async () => {
        chatCalls++;
        return {
          text: JSON.stringify({
            edits: [{ filename: "greet.js", before: GREET_BEFORE, after: GREET_AFTER_GOOD, reason: "friendlier greeting" }],
          }),
        };
      },
    };
    const ctxBrain = { ...ctx, llm, runMacro: makeRunMacro() };
    const r = await ACTIONS.get("code.propose-verified-patch")(ctxBrain, { id: null, data: {}, meta: {} }, {
      taskQuery: "make the greeting friendlier",
      projectId: proj.id,
    });

    assert.equal(r.ok, true);
    assert.equal(r.result.attemptsUsed, 1);
    assert.equal(chatCalls, 1);
    assert.equal(r.result.verification.ok, true);
    assert.equal(r.result.verification.files[0].structuralOk, true);
    assert.equal(r.result.verification.files[0].syntax.checked, true);
    assert.equal(r.result.verification.files[0].syntax.ok, true);
    // Local persistence via multi-file-apply was attempted (not a GitHub-repo
    // source) — honestly reports skipped, since retrieval-sourced edits carry
    // no real scriptId into the DTU store. Never fabricated as "applied".
    assert.equal(r.result.apply.attempted, true);
    assert.equal(r.result.apply.applied.length, 0);
    assert.equal(r.result.apply.skipped.length, 1);
    assert.match(r.result.apply.skipped[0].reason, /scriptId/);
  });
});

describe("code.propose-verified-patch: fails once, then succeeds on retry", () => {
  it("feeds the concrete verification failure back into the second LLM prompt, then succeeds", async () => {
    const ctx = ctxFor("u_retry");
    const proj = call("projects-create", ctx, { name: "P2" }).result.project;
    call("files-write", ctx, { projectId: proj.id, path: "greet.js", content: GREET_BEFORE });

    const seenUserMessages = [];
    let firstCall = true;
    const llm = {
      chat: async ({ messages }) => {
        seenUserMessages.push(messages.find((m) => m.role === "user")?.content || "");
        if (firstCall) {
          firstCall = false;
          return {
            text: JSON.stringify({
              edits: [{ filename: "greet.js", before: GREET_BEFORE, after: GREET_AFTER_BROKEN, reason: "broken attempt" }],
            }),
          };
        }
        return {
          text: JSON.stringify({
            edits: [{ filename: "greet.js", before: GREET_BEFORE, after: GREET_AFTER_GOOD, reason: "fixed" }],
          }),
        };
      },
    };
    const ctxBrain = { ...ctx, llm, runMacro: makeRunMacro() };
    const r = await ACTIONS.get("code.propose-verified-patch")(ctxBrain, { id: null, data: {}, meta: {} }, {
      taskQuery: "make the greeting friendlier",
      projectId: proj.id,
      maxRetries: 2,
    });

    assert.equal(r.ok, true);
    assert.equal(r.result.attemptsUsed, 2);
    assert.equal(seenUserMessages.length, 2);
    // The first attempt's failure was real: the syntax checker actually caught it.
    assert.equal(r.result.attempts[0].ok, false);
    assert.equal(r.result.attempts[0].verification.files[0].syntax.ok, false);
    assert.ok(r.result.attempts[0].verification.files[0].syntax.errors.length > 0);
    // The SECOND prompt sent to the LLM must contain concrete failure detail
    // from the FIRST attempt — not just a bare "try again".
    assert.match(seenUserMessages[1], /greet\.js/);
    assert.match(seenUserMessages[1], /expected|syntax|error/i);
    assert.notEqual(seenUserMessages[1], seenUserMessages[0]);
  });
});

describe("code.propose-verified-patch: exhausts retries honestly", () => {
  it("returns ok:false, reason:retries_exhausted — never a fabricated ok:true", async () => {
    const ctx = ctxFor("u_exhaust");
    const proj = call("projects-create", ctx, { name: "P3" }).result.project;
    call("files-write", ctx, { projectId: proj.id, path: "greet.js", content: GREET_BEFORE });

    let chatCalls = 0;
    const llm = {
      chat: async () => {
        chatCalls++;
        return {
          text: JSON.stringify({
            edits: [{ filename: "greet.js", before: GREET_BEFORE, after: GREET_AFTER_BROKEN, reason: "still broken" }],
          }),
        };
      },
    };
    const ctxBrain = { ...ctx, llm, runMacro: makeRunMacro() };
    const r = await ACTIONS.get("code.propose-verified-patch")(ctxBrain, { id: null, data: {}, meta: {} }, {
      taskQuery: "make the greeting friendlier",
      projectId: proj.id,
      maxRetries: 1,
    });

    assert.equal(r.ok, false);
    assert.equal(r.reason, "retries_exhausted");
    assert.equal(chatCalls, 2); // 1 initial attempt + 1 retry, never more than requested
    assert.equal(r.attempts.length, 2);
    assert.equal(r.attemptsUsed, 2);
    assert.ok(r.lastAttempt);
    assert.equal(r.lastAttempt.verification.ok, false);
    // No "result" success envelope, no "edits" masquerading as accepted output.
    assert.equal(r.result, undefined);
  });
});

describe("code.propose-verified-patch: maxRetries is hard-capped at 3", () => {
  it("never exceeds 4 total attempts (1 + 3) even when the caller asks for 100", async () => {
    const ctx = ctxFor("u_cap");
    const proj = call("projects-create", ctx, { name: "P4" }).result.project;
    call("files-write", ctx, { projectId: proj.id, path: "greet.js", content: GREET_BEFORE });

    let chatCalls = 0;
    const llm = {
      chat: async () => {
        chatCalls++;
        return {
          text: JSON.stringify({
            edits: [{ filename: "greet.js", before: GREET_BEFORE, after: GREET_AFTER_BROKEN, reason: "still broken" }],
          }),
        };
      },
    };
    const ctxBrain = { ...ctx, llm, runMacro: makeRunMacro() };
    const r = await ACTIONS.get("code.propose-verified-patch")(ctxBrain, { id: null, data: {}, meta: {} }, {
      taskQuery: "make the greeting friendlier",
      projectId: proj.id,
      maxRetries: 100,
    });

    assert.equal(r.ok, false);
    assert.equal(r.reason, "retries_exhausted");
    assert.equal(chatCalls, 4);
    assert.equal(r.attempts.length, 4);
    assert.equal(r.attemptsUsed, 4);
  });

  it("also caps a negative maxRetries down to at least 1 total attempt", async () => {
    const ctx = ctxFor("u_cap_negative");
    const proj = call("projects-create", ctx, { name: "P4b" }).result.project;
    call("files-write", ctx, { projectId: proj.id, path: "greet.js", content: GREET_BEFORE });

    let chatCalls = 0;
    const llm = {
      chat: async () => {
        chatCalls++;
        return {
          text: JSON.stringify({
            edits: [{ filename: "greet.js", before: GREET_BEFORE, after: GREET_AFTER_GOOD, reason: "ok" }],
          }),
        };
      },
    };
    const ctxBrain = { ...ctx, llm, runMacro: makeRunMacro() };
    const r = await ACTIONS.get("code.propose-verified-patch")(ctxBrain, { id: null, data: {}, meta: {} }, {
      taskQuery: "x",
      projectId: proj.id,
      maxRetries: -5,
    });
    assert.equal(r.ok, true);
    assert.equal(chatCalls, 1);
  });
});

describe("code.propose-verified-patch: honest degrade for a third-party GitHub repo", () => {
  it("runs real structural + syntax verification but never real test execution, and never persists or pushes anywhere", async () => {
    const ctx = ctxFor("u_github");
    const fileGetCalls = [];
    const runMacro = makeRunMacro({
      "github.repo-tree": async () => ({ ok: true, result: { tree: [{ path: "src/greet.js", type: "blob" }] } }),
      "github.file-get": async (params) => {
        fileGetCalls.push(params.path);
        return { ok: true, result: { content: GREET_BEFORE } };
      },
    });

    const llm = {
      chat: async () => ({
        text: JSON.stringify({
          edits: [{ filename: "src/greet.js", before: GREET_BEFORE, after: GREET_AFTER_GOOD, reason: "friendlier" }],
        }),
      }),
    };
    const ctxBrain = { ...ctx, llm, runMacro };
    const r = await ACTIONS.get("code.propose-verified-patch")(ctxBrain, { id: null, data: {}, meta: {} }, {
      taskQuery: "make it friendlier",
      repo: "acme/widgets",
      verifyCommand: "npm test", // advisory only — must never actually be executed
    });

    assert.equal(r.ok, true);
    assert.ok(fileGetCalls.includes("src/greet.js"), "the GitHub source must have been queried through GH-1's macros");
    // Real verification still ran (structural + syntax), it's just execution that's honestly skipped.
    assert.equal(r.result.verification.ok, true);
    assert.equal(r.result.verification.files[0].syntax.checked, true);
    assert.equal(r.result.verification.execution.ran, false);
    assert.equal(r.result.verification.execution.reason, "no_sandboxed_execution_available");
    assert.equal(r.result.verification.execution.requestedVerifyCommand, "npm test");
    // Never written locally, never pushed to the real repo.
    assert.equal(r.result.apply.attempted, false);
    assert.equal(r.result.apply.reason, "third_party_repo_never_written_locally_or_pushed");
  });

  it("still retries + eventually reports honest failure for a third-party repo that never produces a valid syntax", async () => {
    const runMacro = makeRunMacro({
      "github.repo-tree": async () => ({ ok: true, result: { tree: [{ path: "src/greet.js", type: "blob" }] } }),
      "github.file-get": async () => ({ ok: true, result: { content: GREET_BEFORE } }),
    });
    let chatCalls = 0;
    const llm = {
      chat: async () => {
        chatCalls++;
        return {
          text: JSON.stringify({
            edits: [{ filename: "src/greet.js", before: GREET_BEFORE, after: GREET_AFTER_BROKEN, reason: "broken" }],
          }),
        };
      },
    };
    const ctxBrain = { ...ctxFor("u_github_fail"), llm, runMacro };
    const r = await ACTIONS.get("code.propose-verified-patch")(ctxBrain, { id: null, data: {}, meta: {} }, {
      taskQuery: "x",
      repo: "acme/widgets",
      maxRetries: 0,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "retries_exhausted");
    assert.equal(chatCalls, 1);
    assert.equal(r.lastAttempt.apply.attempted, false);
  });
});

describe("code.propose-verified-patch: input validation", () => {
  it("rejects an empty taskQuery/prompt", async () => {
    const ctxBrain = { ...ctxFor("u_bad1"), llm: { chat: async () => ({ text: "{}" }) }, runMacro: makeRunMacro() };
    const r = await ACTIONS.get("code.propose-verified-patch")(ctxBrain, { id: null, data: {}, meta: {} }, { projectId: "p1" });
    assert.equal(r.ok, false);
    assert.match(r.error, /taskQuery/);
  });

  it("rejects missing projectId AND repo", async () => {
    const ctxBrain = { ...ctxFor("u_bad2"), llm: { chat: async () => ({ text: "{}" }) }, runMacro: makeRunMacro() };
    const r = await ACTIONS.get("code.propose-verified-patch")(ctxBrain, { id: null, data: {}, meta: {} }, { taskQuery: "do something" });
    assert.equal(r.ok, false);
    assert.match(r.error, /projectId|repo/);
  });
});
