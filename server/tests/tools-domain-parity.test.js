// Contract tests for server/domains/tools.js — web research (live API),
// compile/transpile, and the multi-party e-signature workflow.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerToolsActions from "../domains/tools.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`tools.${name}`);
  if (!fn) throw new Error(`tools.${name} not registered`);
  return fn(ctx, { id: null, data: params, meta: {} }, params);
}

before(() => { registerToolsActions(register); });

beforeEach(() => {
  // Fresh in-memory STATE per test so per-user buckets don't leak.
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("tools.research (web research)", () => {
  it("rejects an empty query", async () => {
    const r = await call("research", ctxA, { query: "" });
    assert.equal(r.ok, false);
  });

  it("shapes DuckDuckGo RelatedTopics into a readable result list", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("duckduckgo.com")) {
        return {
          ok: true,
          json: async () => ({
            AbstractText: "TypeScript is a strongly typed language.",
            AbstractSource: "Wikipedia",
            AbstractURL: "https://en.wikipedia.org/wiki/TypeScript",
            RelatedTopics: [
              { Text: "TypeScript - a language", FirstURL: "https://duckduckgo.com/TypeScript" },
              { Topics: [{ Text: "TSC - the compiler", FirstURL: "https://duckduckgo.com/TSC" }] },
            ],
          }),
        };
      }
      throw new Error("unexpected url");
    };
    const r = await call("research", ctxA, { query: "typescript" });
    assert.equal(r.ok, true);
    assert.equal(r.result.abstract.source, "Wikipedia");
    assert.ok(r.result.results.length >= 2);
    assert.equal(r.result.results[0].source, "DuckDuckGo");
    assert.ok(r.result.results[0].url);
  });

  it("falls back to Wikipedia OpenSearch when DDG is sparse", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("duckduckgo.com")) {
        return { ok: true, json: async () => ({ RelatedTopics: [] }) };
      }
      if (String(url).includes("wikipedia.org")) {
        return {
          ok: true,
          json: async () => ([
            "rust",
            ["Rust (programming language)"],
            ["A systems programming language"],
            ["https://en.wikipedia.org/wiki/Rust"],
          ]),
        };
      }
      throw new Error("unexpected url");
    };
    const r = await call("research", ctxA, { query: "rust" });
    assert.equal(r.ok, true);
    assert.equal(r.result.results[0].source, "Wikipedia");
    assert.equal(r.result.results[0].title, "Rust (programming language)");
  });

  it("records each search into per-user history", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ RelatedTopics: [{ Text: "x - y", FirstURL: "https://e/x" }] }),
    });
    await call("research", ctxA, { query: "alpha" });
    const h = call("research-history", ctxA, {});
    assert.equal(h.ok, true);
    assert.equal(h.result.total, 1);
    assert.equal(h.result.history[0].query, "alpha");
  });

  it("clears history", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ RelatedTopics: [{ Text: "a - b", FirstURL: "https://e/a" }] }) });
    await call("research", ctxA, { query: "beta" });
    const cleared = call("research-clear", ctxA, {});
    assert.equal(cleared.ok, true);
    assert.equal(call("research-history", ctxA, {}).result.total, 0);
  });
});

describe("tools.compile (transpile)", () => {
  it("rejects empty source", async () => {
    const r = await call("compile", ctxA, { source: "" });
    assert.equal(r.ok, false);
  });

  it("transpiles TypeScript and records compile history", async () => {
    const r = await call("compile", ctxA, {
      source: "const greet = (name: string): string => `hi ${name}`;\nexport default greet;",
      target: "es2022",
    });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.code === "string" && r.result.code.length > 0);
    assert.ok(["esbuild", "strip-types-fallback"].includes(r.result.engine));
    assert.equal(r.result.target, "es2022");
    assert.ok(r.result.outputBytes > 0);
    const hist = call("compile-history", ctxA, {});
    assert.equal(hist.ok, true);
    assert.equal(hist.result.total, 1);
    assert.equal(hist.result.history[0].target, "es2022");
  });

  it("supports a minify toggle", async () => {
    const r = await call("compile", ctxA, {
      source: "const longVariableName = 1 + 2 + 3;\nconsole.log(longVariableName);",
      minify: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.minify, true);
  });
});

describe("tools e-signature workflow", () => {
  it("rejects an envelope with no parties", () => {
    const r = call("esign-create", ctxA, { title: "NDA", document: "terms here", parties: [] });
    assert.equal(r.ok, false);
  });

  it("creates a multi-party envelope with an audit trail", () => {
    const r = call("esign-create", ctxA, {
      title: "Mutual NDA",
      document: "This Non-Disclosure Agreement is entered into by the parties below.",
      parties: [{ name: "Alice", role: "discloser" }, { name: "Bob", role: "recipient" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.envelope.parties.length, 2);
    assert.equal(r.result.envelope.status, "out_for_signature");
    assert.equal(r.result.envelope.audit[0].event, "created");
    assert.ok(r.result.envelope.documentHash);
  });

  it("runs a full multi-party signing flow to completion", () => {
    const env = call("esign-create", ctxA, {
      title: "Agreement",
      document: "Binding terms.",
      parties: [{ name: "Alice" }, { name: "Bob" }],
    }).result.envelope;
    const first = call("esign-sign", ctxA, { envelopeId: env.id, partyId: env.parties[0].id });
    assert.equal(first.ok, true);
    assert.equal(first.result.completed, false);
    const second = call("esign-sign", ctxA, { envelopeId: env.id, partyId: env.parties[1].id });
    assert.equal(second.ok, true);
    assert.equal(second.result.completed, true);
    assert.equal(second.result.envelope.status, "completed");
  });

  it("verifies signatures and detects document tampering", () => {
    const env = call("esign-create", ctxA, {
      title: "Contract",
      document: "Original document body.",
      parties: [{ name: "Alice" }],
    }).result.envelope;
    call("esign-sign", ctxA, { envelopeId: env.id, partyId: env.parties[0].id });
    const verify = call("esign-verify", ctxA, { envelopeId: env.id });
    assert.equal(verify.ok, true);
    assert.equal(verify.result.documentIntact, true);
    assert.equal(verify.result.allValid, true);

    // Tamper with the stored document, then re-verify.
    const s = globalThis._concordSTATE.toolsLens;
    s.envelopes.get("user_a")[0].document = "Tampered body.";
    const reverify = call("esign-verify", ctxA, { envelopeId: env.id });
    assert.equal(reverify.result.documentIntact, false);
    assert.equal(reverify.result.allValid, false);
  });

  it("verifies a standalone signature token", () => {
    const env = call("esign-create", ctxA, {
      title: "Doc", document: "body", parties: [{ name: "Alice" }],
    }).result.envelope;
    const signed = call("esign-sign", ctxA, { envelopeId: env.id, partyId: env.parties[0].id });
    const sig = signed.result.envelope.parties[0].signature;
    const good = call("esign-verify-token", ctxA, { token: sig.token, payload: sig.payload });
    assert.equal(good.ok, true);
    assert.equal(good.result.valid, true);
    const bad = call("esign-verify-token", ctxA, { token: "wrong", payload: sig.payload });
    assert.equal(bad.result.valid, false);
  });

  it("lists and voids envelopes", () => {
    const env = call("esign-create", ctxA, {
      title: "Voidable", document: "body", parties: [{ name: "Alice" }],
    }).result.envelope;
    const list = call("esign-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    const voided = call("esign-void", ctxA, { envelopeId: env.id, reason: "no longer needed" });
    assert.equal(voided.ok, true);
    assert.equal(voided.result.envelope.status, "voided");
    // Cannot sign a voided envelope.
    const blocked = call("esign-sign", ctxA, { envelopeId: env.id, partyId: env.parties[0].id });
    assert.equal(blocked.ok, false);
  });

  it("fetches envelope detail", () => {
    const env = call("esign-create", ctxA, {
      title: "Detail", document: "body", parties: [{ name: "Alice" }],
    }).result.envelope;
    const d = call("esign-detail", ctxA, { envelopeId: env.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.envelope.title, "Detail");
  });
});
