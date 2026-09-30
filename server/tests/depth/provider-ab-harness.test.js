// server/tests/depth/provider-ab-harness.test.js

import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { up as upBilling } from "../../migrations/438_provider_billing_telemetry.js";
import {
  loadEnvFile,
  resolveConfiguredProviders,
  apiKeyForProvider,
} from "../../lib/runtime/provider-env-loader.js";
import {
  probeProvider,
  runMirrorComparison,
  resetSessionSpend,
  MIRROR_MODELS,
} from "../../lib/runtime/provider-ab-harness.js";

describe("provider-env-loader", () => {
  it("loads env file without overwriting existing vars", () => {
    const prev = process.env.PROVIDER_ENV_LOADER_TEST;
    process.env.PROVIDER_ENV_LOADER_TEST = "existing";
    const p = join(tmpdir(), `concord-env-test-${Date.now()}.env`);
    writeFileSync(p, "PROVIDER_ENV_LOADER_TEST=from_file\nGROQ_API_KEY=test_groq_key_12345678\n");
    const r = loadEnvFile(p);
    assert.equal(r.ok, true);
    assert.equal(process.env.PROVIDER_ENV_LOADER_TEST, "existing");
    assert.ok(process.env.GROQ_API_KEY?.startsWith("test_groq"));
    unlinkSync(p);
    if (prev === undefined) delete process.env.PROVIDER_ENV_LOADER_TEST;
    else process.env.PROVIDER_ENV_LOADER_TEST = prev;
    delete process.env.GROQ_API_KEY;
  });

  it("apiKeyForProvider resolves groq alias", () => {
    process.env.GROQ_API_KEY = "groq_test_key_abcdefghij";
    assert.equal(apiKeyForProvider("groq"), "groq_test_key_abcdefghij");
    delete process.env.GROQ_API_KEY;
  });
});

describe("provider-ab-harness (mocked fetch)", () => {
  let db;
  let originalFetch;

  before(() => {
    db = new Database(":memory:");
    upBilling(db);
    originalFetch = global.fetch;
    resetSessionSpend();
  });

  after(() => {
    global.fetch = originalFetch;
    db?.close();
  });

  it("probeProvider records provider billing telemetry", async () => {
    global.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "OK" } }],
        usage: { prompt_tokens: 12, completion_tokens: 2 },
      }),
    }));

    process.env.GROQ_API_KEY = "groq_test_key_abcdefghij";
    const r = await probeProvider("groq", {
      db,
      modelId: "llama-3.1-8b-instant",
      path: "probe_test",
    });
    assert.equal(r.ok, true);
    assert.equal(r.tokensIn, 12);
    assert.equal(r.tokensOut, 2);

    const row = db.prepare(`
      SELECT COUNT(*) AS c FROM provider_billing_telemetry WHERE billing_source = 'provider'
    `).get();
    assert.ok(row.c >= 1);
    delete process.env.GROQ_API_KEY;
  });

  it("runMirrorComparison compares two providers on same logical model", async () => {
    let call = 0;
    global.fetch = mock.fn(async () => {
      call += 1;
      const out = call === 1 ? 40 : 25;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Summary here." } }],
          usage: { prompt_tokens: 50, completion_tokens: out },
        }),
      };
    });

    process.env.GROQ_API_KEY = "groq_test_key_abcdefghij";
    process.env.OPENROUTER_API_KEY = "openrouter_test_key_abcdefghijkl";

    const r = await runMirrorComparison({
      db,
      mirrorId: MIRROR_MODELS[0].id,
      providers: ["groq", "openrouter"],
    });
    assert.equal(r.ok, true);
    assert.equal(r.runs.length, 2);
    assert.ok(r.comparison?.leanestTokens);
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  it("xai budget blocks probe when cap exceeded", async () => {
    process.env.CONCORD_XAI_BUDGET_USD = "0";
    process.env.XAI_API_KEY = "xai_test_key_abcdefghijklmnop";
    resetSessionSpend();
    const r = await probeProvider("xai", { modelId: "grok-2-latest" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "xai_budget_exceeded");
    delete process.env.XAI_API_KEY;
    delete process.env.CONCORD_XAI_BUDGET_USD;
  });
});
