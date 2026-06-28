// Behavioral macro tests for server/domains/tools.js — the multi-utility Tools
// lens (web research history, compile/transpile, multi-party e-signature).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against the REAL in-memory globalThis._concordSTATE.toolsLens store the
// domain uses for persistence. These are NOT shape-only assertions: every test
// asserts ACTUAL computed values + multi-step round-trips (create envelope →
// sign each party → completes → verify → tamper-detect → void; compile →
// history; research-history record/clear), per-user isolation, the
// tamper-evident HMAC verification, and the fail-CLOSED numeric guard the
// macro-assassin's V2 vector probes.
//
// Hermetic: NO server boot, NO network, NO LLM, NO DB. The `compile` macro is
// exercised on its deterministic strip-types fallback path (esbuild is not a
// server/ dependency), so the test does not depend on esbuild being present.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerToolsMacros from "../domains/tools.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "tools", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
async function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`tools.${name} not registered`);
  return await fn(ctx, input);
}

before(() => { registerToolsMacros(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("tools — registration", () => {
  it("registers every macro the lens calls", () => {
    for (const m of [
      "research", "research-history", "research-clear",
      "compile", "compile-history",
      "esign-create", "esign-sign", "esign-verify", "esign-verify-token",
      "esign-list", "esign-detail", "esign-void",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing tools.${m}`);
    }
  });
});

describe("tools — e-signature full workflow (create → sign → complete → verify)", () => {
  it("creates an envelope, signs every party, completes, and verifies", async () => {
    const created = await call("esign-create", ctxA, {
      title: "Mutual NDA",
      document: "This agreement binds Alice and Bob.",
      parties: [{ name: "Alice", role: "signer" }, { name: "Bob", role: "signer" }],
    });
    assert.equal(created.ok, true);
    const env = created.result.envelope;
    assert.equal(env.title, "Mutual NDA");
    assert.equal(env.number, "ENV-00001");
    assert.equal(env.status, "out_for_signature");
    assert.equal(env.parties.length, 2);
    assert.equal(env.parties[0].status, "pending");
    // documentHash is a real SHA-256 of the document text.
    assert.match(env.documentHash, /^[0-9a-f]{64}$/);

    // list shows it, 0/2 signed
    let listed = await call("esign-list", ctxA, {});
    assert.equal(listed.result.total, 1);
    assert.equal(listed.result.envelopes[0].signedCount, 0);
    assert.equal(listed.result.envelopes[0].partyCount, 2);

    // sign party 1 — not yet completed
    const p1 = env.parties[0].id;
    const p2 = env.parties[1].id;
    const sign1 = await call("esign-sign", ctxA, { envelopeId: env.id, partyId: p1 });
    assert.equal(sign1.ok, true);
    assert.equal(sign1.result.completed, false);
    assert.equal(sign1.result.envelope.parties[0].status, "signed");
    // the signature is a real HMAC token over the signed payload
    assert.equal(sign1.result.envelope.parties[0].signature.alg, "HS256");
    assert.match(sign1.result.envelope.parties[0].signature.token, /.+/);

    // double-sign the same party is rejected
    const dbl = await call("esign-sign", ctxA, { envelopeId: env.id, partyId: p1 });
    assert.equal(dbl.ok, false);
    assert.equal(dbl.error, "party already signed");

    // sign party 2 — now completed
    const sign2 = await call("esign-sign", ctxA, { envelopeId: env.id, partyId: p2 });
    assert.equal(sign2.result.completed, true);
    assert.equal(sign2.result.envelope.status, "completed");
    assert.ok(sign2.result.envelope.completedAt);
    // audit trail recorded created + 2 signed + completed = 4 events
    assert.equal(sign2.result.envelope.audit.length, 4);

    // verify — all signatures valid, document intact
    const verified = await call("esign-verify", ctxA, { envelopeId: env.id });
    assert.equal(verified.ok, true);
    assert.equal(verified.result.documentIntact, true);
    assert.equal(verified.result.allValid, true);
    assert.equal(verified.result.checks.every((c) => c.verified), true);
  });

  it("detects post-signing document tampering", async () => {
    const created = await call("esign-create", ctxA, {
      title: "Contract", document: "original text", parties: [{ name: "Alice" }],
    });
    const env = created.result.envelope;
    await call("esign-sign", ctxA, { envelopeId: env.id, partyId: env.parties[0].id });

    // mutate the stored document text directly to simulate tampering
    const store = globalThis._concordSTATE.toolsLens.envelopes.get("user_a");
    store[0].document = "ALTERED TEXT";

    const verified = await call("esign-verify", ctxA, { envelopeId: env.id });
    assert.equal(verified.result.documentIntact, false);
    assert.equal(verified.result.allValid, false);
    assert.notEqual(verified.result.currentHash, verified.result.expectedHash);
  });

  it("verifies a standalone token and rejects an altered one", async () => {
    const created = await call("esign-create", ctxA, {
      title: "Doc", document: "text", parties: [{ name: "Alice" }],
    });
    const env = created.result.envelope;
    const signed = await call("esign-sign", ctxA, { envelopeId: env.id, partyId: env.parties[0].id });
    const sig = signed.result.envelope.parties[0].signature;

    const good = await call("esign-verify-token", ctxA, { token: sig.token, payload: sig.payload });
    assert.equal(good.result.valid, true);

    const bad = await call("esign-verify-token", ctxA, {
      token: sig.token, payload: { ...sig.payload, partyName: "Mallory" },
    });
    assert.equal(bad.result.valid, false);
  });

  it("voids an out-for-signature envelope but not a completed one", async () => {
    const created = await call("esign-create", ctxA, {
      title: "Voidable", document: "text", parties: [{ name: "Alice" }],
    });
    const env = created.result.envelope;
    const voided = await call("esign-void", ctxA, { envelopeId: env.id, reason: "duplicate" });
    assert.equal(voided.ok, true);
    assert.equal(voided.result.envelope.status, "voided");
    // signing a voided envelope is rejected
    const sign = await call("esign-sign", ctxA, { envelopeId: env.id, partyId: env.parties[0].id });
    assert.equal(sign.ok, false);
    assert.equal(sign.error, "envelope was voided");
  });

  it("rejects malformed create input", async () => {
    assert.equal((await call("esign-create", ctxA, {})).error, "title required");
    assert.equal((await call("esign-create", ctxA, { title: "X" })).error, "document text required");
    assert.equal(
      (await call("esign-create", ctxA, { title: "X", document: "y" })).error,
      "at least one party required",
    );
  });

  it("filters the list by status", async () => {
    await call("esign-create", ctxA, { title: "A", document: "t", parties: [{ name: "P" }] });
    const b = await call("esign-create", ctxA, { title: "B", document: "t", parties: [{ name: "P" }] });
    await call("esign-void", ctxA, { envelopeId: b.result.envelope.id });

    const out = await call("esign-list", ctxA, { status: "out_for_signature" });
    assert.equal(out.result.total, 1);
    assert.equal(out.result.envelopes[0].title, "A");
    const voided = await call("esign-list", ctxA, { status: "voided" });
    assert.equal(voided.result.total, 1);
    assert.equal(voided.result.envelopes[0].title, "B");
  });
});

describe("tools — compile (deterministic strip-types fallback)", () => {
  it("transpiles TS and records compile history", async () => {
    const r = await call("compile", ctxA, {
      source: "interface G { name: string }\nconst greet = (g: G): string => g.name;",
      loader: "ts", target: "es2022",
    });
    assert.equal(r.ok, true);
    // esbuild is not a server/ dep, so the deterministic fallback runs
    assert.equal(r.result.engine, "strip-types-fallback");
    assert.equal(r.result.target, "es2022");
    assert.ok(r.result.inputBytes > 0);
    assert.equal(typeof r.result.outputBytes, "number");
    assert.equal(typeof r.result.durationMs, "number");
    // the interface declaration is stripped from the output
    assert.doesNotMatch(r.result.code, /interface\s+G/);

    const hist = await call("compile-history", ctxA, {});
    assert.equal(hist.result.total, 1);
    assert.equal(hist.result.history[0].engine, "strip-types-fallback");
    assert.equal(hist.result.history[0].loader, "ts");
  });

  it("rejects empty and oversized source", async () => {
    assert.equal((await call("compile", ctxA, { source: "   " })).error, "source required");
    const big = "a".repeat(200_001);
    assert.match((await call("compile", ctxA, { source: big })).error, /too large/);
  });
});

describe("tools — research history record + clear (offline, no network)", () => {
  it("records a history row and clears it without hitting the network", () => {
    // Seed a synthetic history row directly through the per-user STATE store so
    // we exercise research-history / research-clear without a live fetch.
    const STATE = globalThis._concordSTATE;
    STATE.toolsLens = {
      searchHistory: new Map([["user_a", [
        { id: "s1", query: "concord", resultCount: 3, at: new Date().toISOString(), topUrl: "https://x" },
      ]]]),
      compileHistory: new Map(),
      envelopes: new Map(),
      seq: new Map(),
    };

    return Promise.resolve().then(async () => {
      const hist = await call("research-history", ctxA, { limit: 20 });
      assert.equal(hist.ok, true);
      assert.equal(hist.result.total, 1);
      assert.equal(hist.result.history[0].query, "concord");

      const cleared = await call("research-clear", ctxA, {});
      assert.equal(cleared.ok, true);
      assert.equal((await call("research-history", ctxA, {})).result.total, 0);
    });
  });
});

describe("tools — per-user isolation", () => {
  it("never leaks one user's envelopes to another", async () => {
    await call("esign-create", ctxA, { title: "A-only", document: "t", parties: [{ name: "P" }] });
    assert.equal((await call("esign-list", ctxA, {})).result.total, 1);
    assert.equal((await call("esign-list", ctxB, {})).result.total, 0);
  });
});

describe("tools — fail-CLOSED numeric guard (assassin V2)", () => {
  it("rejects a poisoned limit instead of clamping to ok:true", async () => {
    for (const bad of [NaN, Infinity, -1, 1e308]) {
      const r = await call("research-history", ctxA, { limit: bad });
      assert.equal(r.ok, false, `limit=${bad} should fail-closed`);
      assert.equal(r.error, "invalid_limit");
      const c = await call("compile-history", ctxA, { limit: bad });
      assert.equal(c.ok, false, `compile-history limit=${bad} should fail-closed`);
      assert.equal(c.error, "invalid_limit");
    }
  });

  it("still honours a valid limit", async () => {
    const r = await call("research-history", ctxA, { limit: 5 });
    assert.equal(r.ok, true);
  });
});
