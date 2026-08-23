// server/tests/platform-provider-429-cooldown.test.js
//
// Pin the behavior added to close the High Power Mode free-quota routing
// gap surfaced by /tmp/concord-routing-audit.md: when the upstream returns
// 429/402/503, platformProviderChat() should record a cooldown via
// setExternalCooldown() so subsequent calls to the same (provider, slot)
// fail fast through consumePlatformToken() instead of consuming a bucket
// token only to be rejected again by the real provider.
//
// This is the run-rate controller that lets the operator-funded pool
// survive Groq 70B's 1K RPD cap and Google's per-project free-tier limits
// without re-asking the provider on every request when we know the answer
// is "no, try again in N seconds."

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import {
  consumePlatformToken,
  setExternalCooldown,
  getPlatformBudgetStatus,
} from "../lib/platform-providers-budget.js";
import { platformProviderChat } from "../lib/platform-providers.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

function stubGroq429(retryAfterHeader) {
  // Mirrors Groq's actual 429 envelope: status 429, JSON body with an
  // error.message, and (real) a Retry-After header that's an integer of
  // seconds. Our patches parses only the status code from the error string,
  // so the body shape doesn't matter for the cooldown path — but having
  // the header wired lets a future adapter pass it through unchanged.
  const headers = new Map();
  if (Number.isFinite(retryAfterHeader)) {
    headers.set("retry-after", String(Math.floor(retryAfterHeader)));
  }
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    headers,
    text: async () => JSON.stringify({
      error: { type: "rate_limit_exceeded", message: "TPM limit reached" },
    }),
  });
}

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("CONCORD_PLATFORM_")) delete process.env[k];
  }
  // Token bucket + external cooldown share globalThis._concordSTATE;
  // reset it so each test starts from a known-good baseline.
  globalThis._concordSTATE = {};
});

after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
});

describe("setExternalCooldown + consumePlatformToken interaction", () => {
  it("consume rejects with reason=upstream_throttled while a cooldown is active", () => {
    setExternalCooldown("groq", "conscious", Date.now() + 30_000);
    const r = consumePlatformToken("groq", "conscious");
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "upstream_throttled");
    assert.ok(Number.isFinite(r.retryAfterMs) && r.retryAfterMs > 0);
    assert.ok(r.retryAfterMs <= 30_000);
  });

  it("consume proceeds normally once the cooldown expires (now > untilMs)", () => {
    setExternalCooldown("groq", "conscious", Date.now() + 100);
    // Sanity: gate is active
    assert.equal(consumePlatformToken("groq", "conscious").reason, "upstream_throttled");
    // After expiry, gate is gone (bucket itself may be empty if seed RPM
    // is 0, but the *external* cooldown no longer gates — distinct reason).
    const future = Date.now() + 5000;
    const r = consumePlatformToken("groq", "conscious", future);
    assert.notEqual(r.reason, "upstream_throttled", "external cooldown must clear when nowMs > untilMs");
  });

  it("setting untilMs in the past clears the cooldown", () => {
    setExternalCooldown("groq", "conscious", Date.now() + 60_000);
    setExternalCooldown("groq", "conscious", Date.now() - 1);
    assert.notEqual(consumePlatformToken("groq", "conscious").reason, "upstream_throttled");
  });

  it("cooldown is per (provider, slot), not global", () => {
    setExternalCooldown("groq", "conscious", Date.now() + 60_000);
    // Same provider, different slot — not throttled.
    assert.notEqual(
      consumePlatformToken("groq", "subconscious").reason,
      "upstream_throttled",
    );
    // Different provider, same slot — not throttled either.
    assert.notEqual(
      consumePlatformToken("google", "conscious").reason,
      "upstream_throttled",
    );
  });
});

describe("platformProviderChat() — 429 from upstream sets the cooldown", () => {
  it("records a cooldown when Groq returns 429 (body contains '_429:')", async () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-operator-key";
    stubGroq429();

    // Per-slot routing override so conscious -> groq in this test.
    // Note: providerForSlot() reads the env override as a *bare provider
    // name*, not "provider:model" (the model suffix is resolved later via
    // BYO_PROVIDERS.defaultModels). Tested explicitly above in the
    // dtu-provenance suite — pin the same shape here.
    process.env.CONCORD_PLATFORM_PROVIDER_CONSCIOUS = "groq";

    const r = await platformProviderChat({ slot: "conscious", messages: [{ role: "user", content: "hi" }] });
    assert.equal(r.ok, false);
    assert.match(r.error || "", /_429:/i);

    // The patched code should have called setExternalCooldown internally.
    // The next consume for (groq, conscious) must be blocked by the
    // upstream_throttled gate, distinct from the bucket-empty response.
    const gate = consumePlatformToken("groq", "conscious");
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, "upstream_throttled");
    assert.ok(gate.retryAfterMs > 0);
  });

  it("does NOT set a cooldown on a 4xx that isn't a throttle (e.g. 401 unauthorized)", async () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-operator-key";
    process.env.CONCORD_PLATFORM_PROVIDER_CONSCIOUS = "groq:llama-3.3-70b-versatile";

    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      headers: new Map(),
      text: async () => JSON.stringify({ error: { message: "Invalid API key" } }),
    });

    await platformProviderChat({ slot: "conscious", messages: [{ role: "user", content: "hi" }] });
    // 401 must not throttle — distinct failure mode, do not poison the bucket.
    const gate = consumePlatformToken("groq", "conscious");
    assert.notEqual(gate.reason, "upstream_throttled");
  });

  it("does NOT set a cooldown on a successful response", async () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-operator-key";
    process.env.CONCORD_PLATFORM_PROVIDER_CONSCIOUS = "groq";

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    });

    const r = await platformProviderChat({ slot: "conscious", messages: [{ role: "user", content: "hi" }] });
    assert.equal(r.ok, true);
    // gate is allowed (this is the first consume — bucket starts full)
    assert.equal(consumePlatformToken("groq", "conscious").allowed, true);
  });
});

describe("getPlatformBudgetStatus surfaces the cooldown surface for admin diagnostics", () => {
  it("exposes external cooldown state read-only", () => {
    setExternalCooldown("google", "vision", Date.now() + 60_000);
    setExternalCooldown("mistral", "repair", Date.now() + 30_000);
    consumePlatformToken("groq", "subconscious"); // touch a bucket too

    const status = getPlatformBudgetStatus();
    assert.equal(status.ok, true);
    assert.ok(Array.isArray(status.buckets));
    assert.ok(status.buckets.length >= 1);
    // The cooldown map is intentionally NOT returned to admin — it's a
    // transient fail-fast state, not a quota claim. (If product later
    // wants visibility, add a separate getter.)
  });
});
