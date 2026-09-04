import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeTwoBDialogue, CONCORD_2B_PROVIDER_ID } from "../lib/concordia-two-b.js";

describe("Concord 2B dialogue provider", () => {
  it("uses injected 2B text and stamps provider id", async () => {
    const r = await composeTwoBDialogue(
      { npcId: "lamplighter", npcName: "The Lamplighter", line: "Keep the Court unpaved.", text: "Who keeps this court?", requestId: "r1", worldId: "concordia-hub" },
      { chat: async () => ({ text: "The Court stays dirt. I light what I can.", model: "qwen3.5:2b" }) },
    );
    assert.equal(r.ok, true);
    assert.equal(r.provider, CONCORD_2B_PROVIDER_ID);
    assert.equal(r.fallback, false);
    assert.equal(r.model, "qwen3.5:2b");
    assert.equal(r.requestId, "r1");
    assert.match(r.text, /Court stays dirt/);
    assert.doesNotMatch(r.text, /Aurelia/i);
    assert.doesNotMatch(r.text, /loves her/i);
  });

  it("rejects banned 2B output and falls back deterministically", async () => {
    const r = await composeTwoBDialogue(
      { npcId: "n1", npcName: "Kiren", text: "hello" },
      { chat: async () => "Concord admits he loves her in Aurelia." },
    );
    assert.equal(r.ok, true);
    assert.equal(r.provider, CONCORD_2B_PROVIDER_ID);
    assert.equal(r.fallback, true);
    assert.equal(r.model, "deterministic");
    assert.equal(r.reason, "empty_or_banned");
    assert.doesNotMatch(r.text, /Aurelia/i);
    assert.doesNotMatch(r.text, /loves her/i);
    assert.ok(r.text.length > 0);
  });

  it("falls back honestly when the 2B chat throws", async () => {
    const r = await composeTwoBDialogue(
      { npcId: "n2", npcName: "Orin" },
      { chat: async () => { throw new Error("brain_unavailable"); } },
    );
    assert.equal(r.ok, true);
    assert.equal(r.fallback, true);
    assert.equal(r.reason, "brain_unavailable");
    assert.ok(r.text.length > 0);
  });

  it("calls local 127.0.0.1:11434 with think:false, not docker ollama-conscious", async () => {
    const seen = [];
    const prev = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      seen.push({ url: String(url), body: String(opts?.body || "") });
      return { ok: true, json: async () => ({ message: { content: "The Court stays dirt." } }) };
    };
    try {
      const r = await composeTwoBDialogue({ npcId: "lamplighter", npcName: "The Lamplighter", text: "Who keeps this?" });
      assert.equal(r.ok, true);
      assert.equal(r.fallback, false);
      assert.equal(r.model, "qwen3.5:2b");
      assert.equal(seen.length, 1);
      assert.match(seen[0].url, /127\.0\.0\.1:11434\/api\/chat/);
      assert.doesNotMatch(seen[0].url, /ollama-conscious/);
      assert.match(seen[0].body, /"think":false/);
    } finally {
      globalThis.fetch = prev;
    }
  });
});
