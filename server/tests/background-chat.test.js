// Background chat: governor-gated LLM calls for non-user-facing work.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { governedBackgroundChat, workerGate } from "../lib/inference/background-chat.js";

const ENV_KEYS = ["CONCORD_BG_BRAIN", "BRAIN_BACKGROUND_URL"];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function makeGate({ allow, reason = null, mode = "enforce" } = {}) {
  const releaseCalls = [];
  return {
    gate: {
      allow,
      reason,
      mode,
      release: (outcome = {}) => {
        releaseCalls.push(outcome);
      },
    },
    releaseCalls,
  };
}

describe("governedBackgroundChat", () => {
  it("returns a governor-denied response and never calls chat when the gate denies", async () => {
    const chatCalls = [];
    const { gate, releaseCalls } = makeGate({ allow: false, reason: "kind_inflight_cap" });

    const r = await governedBackgroundChat("dream", [{ role: "user", content: "hi" }], {
      _admit: () => gate,
      _chat: async (...args) => {
        chatCalls.push(args);
        return { ok: true, text: "nope" };
      },
    });

    assert.equal(r.ok, false);
    assert.ok(r.error.startsWith("bg_governor_denied:"), r.error);
    assert.ok(r.error.includes("kind_inflight_cap"));
    assert.equal(r.governed, true);
    assert.equal(chatCalls.length, 0);
    assert.equal(releaseCalls.length, 0);
  });

  it("uses the background brain when the governor allows and one is available", async () => {
    const chatCalls = [];
    const { gate, releaseCalls } = makeGate({ allow: true });

    const r = await governedBackgroundChat("forward_sim", [
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ], {
      _admit: () => gate,
      _hasBg: () => true,
      _chat: async (brain, messages, opts) => {
        chatCalls.push({ brain, messages, opts });
        return { ok: true, text: "prediction", toolCalls: [], tokensIn: 3, tokensOut: 5 };
      },
    });

    assert.equal(r.ok, true);
    assert.equal(r.text, "prediction");
    assert.equal(r.brainUsed, "background");
    assert.equal(r.governed, true);
    assert.equal(chatCalls.length, 1);
    assert.equal(chatCalls[0].brain, "background");
    assert.deepEqual(chatCalls[0].messages, [
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    assert.equal(releaseCalls.length, 1);
    assert.deepEqual(releaseCalls[0], { ok: true, error: undefined });
  });

  it("falls back to the subconscious brain when no background brain is configured", async () => {
    const chatCalls = [];
    const { gate, releaseCalls } = makeGate({ allow: true });

    const r = await governedBackgroundChat("dream", [{ role: "user", content: "hi" }], {
      _admit: () => gate,
      _hasBg: () => false,
      _chat: async (brain, messages) => {
        chatCalls.push({ brain, messages });
        return { ok: true, text: "subconscious output" };
      },
    });

    assert.equal(r.ok, true);
    assert.equal(r.brainUsed, "subconscious");
    assert.equal(chatCalls[0].brain, "subconscious");
    assert.equal(releaseCalls.length, 1);
    assert.equal(releaseCalls[0].ok, true);
  });

  it("releases with ok:false when the chat call throws", async () => {
    const { gate, releaseCalls } = makeGate({ allow: true });

    const r = await governedBackgroundChat("forward_sim", [{ role: "user", content: "hi" }], {
      _admit: () => gate,
      _hasBg: () => true,
      _chat: async () => {
        throw new Error("chat exploded");
      },
    });

    assert.equal(r.ok, false);
    assert.ok(r.error.includes("chat exploded"));
    assert.equal(r.brainUsed, "background");
    assert.equal(releaseCalls.length, 1);
    assert.equal(releaseCalls[0].ok, false);
    assert.ok(releaseCalls[0].error.includes("chat exploded"));
  });

  it("honours CONCORD_BG_BRAIN=0 to force the subconscious brain", async () => {
    process.env.CONCORD_BG_BRAIN = "0";
    const chatCalls = [];
    const { gate, releaseCalls } = makeGate({ allow: true });

    const r = await governedBackgroundChat("dream", [{ role: "user", content: "hi" }], {
      _admit: () => gate,
      _hasBg: () => true,
      _chat: async (brain, messages) => {
        chatCalls.push({ brain, messages });
        return { ok: true, text: "forced subconscious" };
      },
    });

    assert.equal(r.ok, true);
    assert.equal(r.brainUsed, "subconscious");
    assert.equal(chatCalls[0].brain, "subconscious");
    assert.equal(releaseCalls.length, 1);
    assert.equal(releaseCalls[0].ok, true);
  });
});


describe("worker-thread gate (main governor status file)", () => {
  it("denies in a worker when the main breaker is open", async () => {
    let called = false;
    const r = await governedBackgroundChat("dream", [], {
      _inWorker: true, _workerGate: () => "main_breaker_open",
      _admit: () => ({ allow: true, release() {} }), _chat: async () => { called = true; return { ok: true, text: "x" }; },
    });
    assert.equal(r.ok, false); assert.equal(r.error, "bg_governor_denied:main_breaker_open"); assert.equal(called, false);
  });
  it("workerGate reads the status file", () => {
    const now = Date.parse("2026-10-18T18:00:30Z");
    const mk = (o) => () => JSON.stringify({ generatedAt: "2026-10-18T18:00:00Z", mode: "enforce", breaker: { state: "closed" }, ...o });
    assert.equal(workerGate({ now, read: mk({}) }), null);
    assert.equal(workerGate({ now, read: mk({ breaker: { state: "open" } }) }), "main_breaker_open");
    assert.equal(workerGate({ now: now + 120000, read: mk({}) }), "main_status_stale");
    assert.equal(workerGate({ now, read: () => { throw new Error("nope"); } }), "main_status_unreadable");
  });
});
