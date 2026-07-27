// server/tests/platform-provider-dtu-provenance.test.js
//
// Task #27 of the Private Mode / High Power Mode plan: prove platform-
// funded (operator-paid) calls get a visibly distinct DTU provenance tag
// from a user's own BYO key -- "google_platform" vs plain "google" -- and
// that no code change to provenanceFrom() was needed for this, because it
// already reads brainResult.provider/model generically with no allowlist.
//
// Chain under test: platformProviderChat() -> providerChat() -> a
// provider adapter (stubbed fetch, no live network) -> the _platform-
// suffixed provider tag -> byo-router.js#provenanceFrom() -> the exact
// {minted_by_provider, minted_by_model} shape chat-agent.js/expert-mode.js
// spread onto a minted DTU.

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { platformProviderChat } from "../lib/platform-providers.js";
import { provenanceFrom } from "../lib/byo-router.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

function stubGoogleSuccess() {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: "synthetic platform reply" }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
    }),
  });
}

function stubGroqSuccess() {
  // Groq/Mistral are OpenAI-compatible (openaiCompatibleChat).
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "synthetic groq reply" } }],
      usage: { prompt_tokens: 8, completion_tokens: 3 },
    }),
  });
}

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("CONCORD_PLATFORM_")) delete process.env[k];
  }
  // platform-providers-budget.js's token bucket lives under
  // globalThis._concordSTATE.platformProviders -- same convention as
  // byo-rate-limit-router.test.js's beforeEach.
  globalThis._concordSTATE = {};
});

after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
});

describe("platform-provider calls carry a distinct _platform provenance tag", () => {
  it("google_platform (default conscious-slot provider) is distinct from a user's own BYO 'google' tag", async () => {
    process.env.CONCORD_PLATFORM_GOOGLE_API_KEY = "test-operator-key";
    stubGoogleSuccess();

    const r = await platformProviderChat({
      slot: "conscious",
      messages: [{ role: "user", content: "hi" }],
    });

    assert.equal(r.ok, true);
    assert.equal(r.provider, "google_platform");
    assert.notEqual(r.provider, "google", "must never be indistinguishable from a user's own paid BYO key");

    const prov = provenanceFrom(r);
    assert.equal(prov.minted_by_provider, "google_platform");
    assert.equal(prov.minted_by_model, r.model);
  });

  it("groq_platform (default utility-slot provider) carries the same distinct tagging", async () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-operator-key";
    stubGroqSuccess();

    const r = await platformProviderChat({
      slot: "utility",
      messages: [{ role: "user", content: "classify this" }],
    });

    assert.equal(r.ok, true);
    assert.equal(r.provider, "groq_platform");

    const prov = provenanceFrom(r);
    assert.equal(prov.minted_by_provider, "groq_platform");
  });

  it("an operator override to mistral for a slot also tags '_platform', not bare 'mistral'", async () => {
    process.env.CONCORD_PLATFORM_PROVIDER_UTILITY = "mistral";
    process.env.CONCORD_PLATFORM_MISTRAL_API_KEY = "test-operator-key";
    stubGroqSuccess(); // mistral is also OpenAI-compatible; same stub shape works

    const r = await platformProviderChat({
      slot: "utility",
      messages: [{ role: "user", content: "hi" }],
    });

    assert.equal(r.ok, true);
    assert.equal(r.provider, "mistral_platform");
  });

  it("provenanceFrom() needed NO changes for this -- it already reads brainResult.provider/model generically", () => {
    // Directly exercises the generic (no-allowlist) contract: any string
    // shape, including one provenanceFrom has never seen before, passes
    // through untouched.
    const fakeFutureProvider = { provider: "some_future_platform_provider_v2", model: "whatever-model-id" };
    const prov = provenanceFrom(fakeFutureProvider);
    assert.equal(prov.minted_by_provider, "some_future_platform_provider_v2");
    assert.equal(prov.minted_by_model, "whatever-model-id");
  });

  it("a Private-Mode / no-BYO fallback (concord_default) is unaffected -- still the honest local tag", () => {
    const prov = provenanceFrom({ provider: "concord_default", model: "ollama" });
    assert.equal(prov.minted_by_provider, "concord_default");
    assert.equal(prov.minted_by_model, "ollama");
  });
});
