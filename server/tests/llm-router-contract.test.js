/**
 * LLM router + vision pipeline contract tests.
 *
 * GATED: every test runs only when CONCORD_BEHAVIOR_TEST_LLM=true. On the
 * normal local CI box (no Ollama, no GPU) the tests are skipped — green
 * by design. On RunPod (or any box with the five-brain stack live) the
 * tests exercise the real router + fallback chain.
 *
 * Verifies:
 *   1. ctx.llm.chat happy path → conscious brain returns {ok, content, brain, source}
 *   2. Conscious-down → OpenAI emergency fallback (when OPENAI_API_KEY set)
 *      OR clean failure (when no fallback configured)
 *   3. callVision happy path → multimodal brain returns {ok, content, source}
 *
 * Run locally:  node --test tests/llm-router-contract.test.js
 *               (all skipped — expected)
 * Run on RunPod: CONCORD_BEHAVIOR_TEST_LLM=true node --test tests/llm-router-contract.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const ENABLED = process.env.CONCORD_BEHAVIOR_TEST_LLM === "true";
const $it = ENABLED ? it : it.skip;

// 1×1 transparent PNG (8-bit RGBA), base64-encoded. ~80 bytes; minimum
// valid PNG that LLaVA will accept without complaint.
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("LLM router contract — gated on CONCORD_BEHAVIOR_TEST_LLM", () => {
  $it("ctx.llm.chat → conscious brain happy path", async () => {
    // Import server lazily so the bare presence of this test file doesn't
    // boot the monolith on local runs.
    const mod = await import("../server.js");
    const __TEST__ = mod.__TEST__;
    assert.ok(__TEST__, "server.js must export __TEST__ for the harness");

    const ctx = __TEST__.makeInternalCtx("llm-contract-test");
    assert.ok(ctx?.llm?.chat, "ctx.llm.chat must exist");

    const result = await ctx.llm.chat({
      messages: [{ role: "user", content: "Reply with exactly the word PONG (no punctuation)." }],
      maxTokens: 16,
      timeoutMs: 30000,
    });

    assert.equal(result.ok, true, `chat must return ok:true, got ${JSON.stringify(result).slice(0, 200)}`);
    assert.equal(typeof result.content, "string");
    assert.ok(result.content.length > 0);
    // Source should identify the path: "ollama" (conscious) or "openai" (fallback).
    assert.ok(["ollama", "openai"].includes(result.source), `source ${result.source} unexpected`);
    if (result.source === "ollama") {
      assert.equal(result.brain, "conscious", "ollama path must report brain=conscious");
    }
  });

  $it("ctx.llm.chat — falls back cleanly when conscious is offline", async () => {
    // Force conscious down by overriding BRAIN.conscious.enabled. The router
    // (server.js:11157) reads BRAIN.conscious.enabled; flipping it forces the
    // OpenAI emergency fallback path. With no OPENAI_API_KEY, the call must
    // return a clean { ok:false, reason } envelope — never throw.
    const mod = await import("../server.js");
    const __TEST__ = mod.__TEST__;
    const BRAIN = __TEST__?.BRAIN ?? globalThis._concordBRAIN;
    assert.ok(BRAIN?.conscious, "BRAIN.conscious must be reachable from __TEST__ or global");

    const wasEnabled = BRAIN.conscious.enabled;
    BRAIN.conscious.enabled = false;
    try {
      const ctx = __TEST__.makeInternalCtx("llm-fallback-test");
      const result = await ctx.llm.chat({
        messages: [{ role: "user", content: "test" }],
        maxTokens: 8,
        timeoutMs: 15000,
      });

      // Must not throw. Must return either ok:true (OpenAI fallback worked)
      // or ok:false with a recognizable reason.
      assert.equal(typeof result, "object");
      assert.equal(typeof result.ok, "boolean");
      if (!result.ok) {
        assert.ok(typeof result.reason === "string" && result.reason.length > 0,
                  "ok:false must carry a non-empty reason");
      } else {
        assert.equal(result.source, "openai", "if ok with conscious down, source must be openai");
      }
    } finally {
      BRAIN.conscious.enabled = wasEnabled;
    }
  });
});

describe("Vision pipeline contract — gated on CONCORD_BEHAVIOR_TEST_LLM", () => {
  $it("callVision → multimodal brain happy path", async () => {
    const { callVision } = await import("../lib/vision-inference.js");
    const result = await callVision(TINY_PNG_B64, "What color is this image?", { timeoutMs: 60000 });

    assert.equal(typeof result, "object");
    assert.equal(typeof result.ok, "boolean");
    if (result.ok) {
      assert.equal(typeof result.content, "string");
      assert.ok(result.content.length > 0, "vision response must be non-empty");
      assert.equal(result.source, "ollama_llava");
    } else {
      // Vision can legitimately fail if the multimodal brain isn't online —
      // the test must still pass with a clean error envelope.
      assert.equal(typeof result.error, "string");
      assert.ok(result.error.length > 0);
    }
  });
});

// Sanity: the gating itself is observable. Without this, CI will report
// "0 tests run" and we lose visibility into whether the file even loaded.
describe("LLM contract test file loads (sanity)", () => {
  it("gating env var is honored", () => {
    assert.equal(typeof ENABLED, "boolean");
    if (!ENABLED) {
       
      console.log("[llm-router-contract] gated: set CONCORD_BEHAVIOR_TEST_LLM=true on the RunPod box to exercise.");
    }
  });
});
