// server/tests/byo-providers-openrouter.test.js
//
// OpenRouter is priority-1 in the Free Cloud Fleet order
// (server/lib/free-cloud-router.js's PROVIDERS list + OPENROUTER_API_KEY
// mapping) but until this fix, the actual execution path — providerChat()
// in server/lib/byo-providers.js, which free-cloud-router-extended.js
// dispatches every call through — had no 'openrouter' adapter at all, so
// picking the provider always led to `unknown_provider_openrouter` and a
// silent fall-through to Ollama. This pins the adapter is wired: a real
// model default per slot, and the dispatcher actually reaching fetch()
// with an OpenAI-compatible request shape instead of erroring closed.
//
// Network isolation: global fetch is stubbed for the file's lifetime —
// same pattern as byo-rate-limit-router.test.js.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { providerChat } from "../lib/byo-providers.js";

const ORIGINAL_FETCH = globalThis.fetch;
let lastCall = null;

after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function stubFetchOk() {
  globalThis.fetch = async (url, init) => {
    lastCall = { url, init };
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "hi from openrouter" } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    };
  };
}

describe("providerChat() dispatches 'openrouter' instead of erroring unknown_provider", () => {
  it("resolves a default model per slot and hits the real OpenRouter endpoint", async () => {
    stubFetchOk();
    const r = await providerChat({
      provider: "openrouter",
      apiKey: "sk-or-test-key",
      slot: "utility",
      messages: [{ role: "user", content: "ping" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.text, "hi from openrouter");
    assert.equal(r.tokensIn, 3);
    assert.equal(r.tokensOut, 4);
    assert.ok(lastCall, "fetch should have been called");
    assert.equal(lastCall.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(lastCall.init.headers["Authorization"], "Bearer sk-or-test-key");
    const body = JSON.parse(lastCall.init.body);
    assert.equal(body.model, "meta-llama/llama-3.1-8b-instruct:free"); // utility default
  });

  it("falls back to the conscious default when slot has no explicit mapping", async () => {
    stubFetchOk();
    await providerChat({
      provider: "openrouter",
      apiKey: "sk-or-test-key",
      slot: "some_unmapped_slot",
      messages: [{ role: "user", content: "ping" }],
    });
    const body = JSON.parse(lastCall.init.body);
    assert.equal(body.model, "meta-llama/llama-3.3-70b-instruct:free"); // conscious default
  });

  it("still fails closed with a clear error for a truly unknown provider", async () => {
    const r = await providerChat({
      provider: "not-a-real-provider",
      apiKey: "x",
      slot: "utility",
      messages: [],
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "unknown_provider_not-a-real-provider");
  });
});
