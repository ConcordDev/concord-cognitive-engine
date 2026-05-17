/**
 * Tier-2 contract tests for Phase 13 Stage C — agent capability sandbox.
 *
 * Pins:
 *   - Declared (domain.macro) calls reach baseCtx.runMacro
 *   - Undeclared (domain.macro) calls throw capability_denied
 *   - capability_denied error has code + deniedMacro fields
 *   - Without _llm capability, ctx.llm is null
 *   - With _llm capability, ctx.llm is forwarded
 *   - Sandbox is frozen — agent code can't mutate to grant itself caps
 *   - Sandbox has no back-reference to baseCtx
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { makeSandboxedCtx, CAPABILITY_DENIED } from "../lib/agent-capability-sandbox.js";

function baseCtxStub() {
  const calls = [];
  return {
    calls,
    actor: { userId: "user:alice", secret: "shouldnt-leak" },
    db: { fake: true },
    state: { fake: true },
    llm: { chat: async () => "llm-response" },
    runMacro: async (domain, name, input) => {
      calls.push({ domain, name, input });
      return { ok: true, called: `${domain}.${name}` };
    },
    runArtifact: async (domain, action) => {
      calls.push({ artifactDomain: domain, artifactAction: action });
      return { ok: true };
    },
  };
}

function manifestWithCaps(caps) {
  return {
    id: "agent:test",
    name: "Test",
    version: "1.0.0",
    creator_id: "user:author",
    license: "MIT",
    capabilities: caps,
  };
}

describe("agent sandbox — capability gating", () => {
  it("declared (domain.macro) calls reach baseCtx.runMacro", async () => {
    const base = baseCtxStub();
    const sandbox = makeSandboxedCtx(base, manifestWithCaps([
      { domain: "translation", macros: ["translate"] },
    ]));
    const r = await sandbox.runMacro("translation", "translate", { text: "hi" });
    assert.equal(r.ok, true);
    assert.equal(r.called, "translation.translate");
    assert.equal(base.calls.length, 1);
  });

  it("undeclared macro throws capability_denied", async () => {
    const base = baseCtxStub();
    const sandbox = makeSandboxedCtx(base, manifestWithCaps([
      { domain: "translation", macros: ["translate"] },
    ]));
    await assert.rejects(
      () => sandbox.runMacro("finance", "transfer", { amount: 100 }),
      (err) => {
        assert.equal(err.code, CAPABILITY_DENIED);
        assert.equal(err.deniedMacro, "finance.transfer");
        assert.match(err.message, /finance\.transfer/);
        return true;
      },
    );
    assert.equal(base.calls.length, 0); // never reached baseCtx
  });

  it("declared domain but undeclared macro is still denied", async () => {
    const base = baseCtxStub();
    const sandbox = makeSandboxedCtx(base, manifestWithCaps([
      { domain: "translation", macros: ["translate"] },
    ]));
    await assert.rejects(
      () => sandbox.runMacro("translation", "delete_corpus", {}),
      (err) => err.code === CAPABILITY_DENIED,
    );
  });

  it("runArtifact is also gated", async () => {
    const base = baseCtxStub();
    const sandbox = makeSandboxedCtx(base, manifestWithCaps([
      { domain: "translation", macros: ["translate"] },
    ]));
    await assert.rejects(
      () => sandbox.runArtifact("finance", "transfer"),
      (err) => err.code === CAPABILITY_DENIED,
    );
  });
});

describe("agent sandbox — LLM access", () => {
  it("without _llm capability, ctx.llm is null", () => {
    const base = baseCtxStub();
    const sandbox = makeSandboxedCtx(base, manifestWithCaps([
      { domain: "translation", macros: ["translate"] },
    ]));
    assert.equal(sandbox.llm, null);
    assert.equal(sandbox.agent.hasLlmCapability, false);
  });

  it("with _llm capability, ctx.llm is forwarded", () => {
    const base = baseCtxStub();
    const sandbox = makeSandboxedCtx(base, manifestWithCaps([
      { domain: "_llm", macros: [] },
      { domain: "translation", macros: ["translate"] },
    ]));
    assert.equal(sandbox.llm, base.llm);
    assert.equal(sandbox.agent.hasLlmCapability, true);
  });
});

describe("agent sandbox — one-way ratchet", () => {
  it("sandbox is frozen", () => {
    const base = baseCtxStub();
    const sandbox = makeSandboxedCtx(base, manifestWithCaps([
      { domain: "x", macros: ["y"] },
    ]));
    assert.equal(Object.isFrozen(sandbox), true);
    // attempting to add a runMacro override throws in strict mode (which
    // ES modules run in by default)
    assert.throws(() => { sandbox.runMacro = async () => ({ pwned: true }); }, TypeError);
  });

  it("sandbox has no back-reference to baseCtx as a field", () => {
    const base = baseCtxStub();
    const sandbox = makeSandboxedCtx(base, manifestWithCaps([
      { domain: "x", macros: ["y"] },
    ]));
    // Should not expose baseCtx by reference under any obvious key.
    for (const k of Object.keys(sandbox)) {
      assert.notEqual(sandbox[k], base);
    }
  });

  it("actor field is reduced to userId only (no secret leakage)", () => {
    const base = baseCtxStub();
    const sandbox = makeSandboxedCtx(base, manifestWithCaps([
      { domain: "x", macros: ["y"] },
    ]));
    assert.equal(sandbox.actor.userId, "user:alice");
    assert.equal(sandbox.actor.secret, undefined);
  });
});

describe("agent sandbox — malformed manifest", () => {
  it("rejects setup with invalid manifest", () => {
    const base = baseCtxStub();
    assert.throws(
      () => makeSandboxedCtx(base, { id: "x" /* missing required fields */ }),
      /agent_manifest_invalid/,
    );
  });
});
