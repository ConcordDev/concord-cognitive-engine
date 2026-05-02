// server/tests/unit/messaging-adapters.test.js
// Unit tests for all 6 messaging adapters and the inbound pipeline.
// Uses Node.js built-in test runner (node:test + node:assert).

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Shared contract tests for every adapter.
 * Each adapter must:
 *   - export platform (string)
 *   - export isConfigured() → boolean
 *   - export parseIncoming(null)  → { ok: false }
 *   - export parseIncoming({})   → { ok: false }
 */
async function contractTests(adapterName) {
  const mod = await import(`../../lib/messaging/adapters/${adapterName}.js`);

  describe(`${adapterName}: parseIncoming(null) → { ok: false }`, () => {
    test("does not throw on null input", () => {
      assert.doesNotThrow(() => mod.parseIncoming(null), `${adapterName}.parseIncoming(null) should not throw`);
    });

    test("returns ok: false on null input", () => {
      const result = mod.parseIncoming(null);
      assert.equal(result.ok, false, `${adapterName}.parseIncoming(null) should return { ok: false }`);
    });
  });

  describe(`${adapterName}: parseIncoming({}) → { ok: false }`, () => {
    test("does not throw on empty object input", () => {
      assert.doesNotThrow(() => mod.parseIncoming({}), `${adapterName}.parseIncoming({}) should not throw`);
    });

    test("returns ok: false on empty object input", () => {
      const result = mod.parseIncoming({});
      assert.equal(result.ok, false, `${adapterName}.parseIncoming({}) should return { ok: false }`);
    });
  });

  describe(`${adapterName}: isConfigured() → boolean`, () => {
    test("isConfigured returns a boolean", () => {
      const result = mod.isConfigured();
      assert.equal(typeof result, "boolean", `${adapterName}.isConfigured() should return a boolean`);
    });

    test("isConfigured returns false when env vars are absent (test environment)", () => {
      // In CI/test env none of the messaging secrets are set, so isConfigured must be false
      assert.equal(mod.isConfigured(), false, `${adapterName}: isConfigured() should be false in test env (no env vars set)`);
    });
  });

  describe(`${adapterName}: platform string export`, () => {
    test("exports platform as a non-empty string", () => {
      assert.equal(typeof mod.platform, "string", `${adapterName}: platform should be a string`);
      assert.ok(mod.platform.length > 0, `${adapterName}: platform should be non-empty`);
    });

    test("platform value matches adapter name", () => {
      assert.equal(mod.platform, adapterName, `${adapterName}: platform should equal "${adapterName}"`);
    });
  });
}

// Run contract tests for all 6 adapters
for (const name of ["whatsapp", "telegram", "discord", "signal", "imessage", "slack"]) {
  await contractTests(name);
}

// ─── inbound-pipeline.js ──────────────────────────────────────────────────────

describe("inbound-pipeline: processInboundMessage", () => {
  test("skips processing when normalized.ok is false", async () => {
    const { processInboundMessage } = await import("../../lib/messaging/inbound-pipeline.js");

    let inferCalled = false;
    const mockAdapter = {
      platform: "test",
      sendMessage: async () => ({ ok: true }),
    };
    const normalizedFailed = { ok: false, text: "", externalId: "", chatId: "" };

    // Provide a mock db that would fail loudly if queried
    const mockDb = {
      prepare: () => { throw new Error("db should not be called when normalized.ok is false"); },
    };

    // Should return early without calling infer or touching db
    await assert.doesNotReject(
      processInboundMessage({
        adapter: mockAdapter,
        normalized: normalizedFailed,
        db: mockDb,
        infer: () => { inferCalled = true; return { finalText: "hi" }; },
        createDTU: () => {},
      }),
      "processInboundMessage should not throw when normalized.ok is false"
    );

    assert.equal(inferCalled, false, "infer should not be called when normalized.ok is false");
  });

  test("skips processing when normalized.text is empty string", async () => {
    const { processInboundMessage } = await import("../../lib/messaging/inbound-pipeline.js");

    let inferCalled = false;
    const mockAdapter = {
      platform: "test",
      sendMessage: async () => ({ ok: true }),
    };

    // ok: true but text is empty — pipeline should skip
    const normalizedNoText = { ok: true, text: "", externalId: "u1", chatId: "c1" };

    const mockDb = {
      prepare: () => { throw new Error("db should not be called when text is empty"); },
    };

    await assert.doesNotReject(
      processInboundMessage({
        adapter: mockAdapter,
        normalized: normalizedNoText,
        db: mockDb,
        infer: () => { inferCalled = true; return { finalText: "hi" }; },
        createDTU: () => {},
      })
    );

    assert.equal(inferCalled, false, "infer should not be called when text is empty");
  });

  test("does not throw when given minimal valid inputs with ok: false", async () => {
    const { processInboundMessage } = await import("../../lib/messaging/inbound-pipeline.js");

    await assert.doesNotReject(
      processInboundMessage({
        adapter: { platform: "slack", sendMessage: async () => ({}) },
        normalized: { ok: false },
        db: null,
        infer: async () => ({}),
        createDTU: () => {},
      }),
      "should not throw with normalized.ok: false even with null db"
    );
  });
});
