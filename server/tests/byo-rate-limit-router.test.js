// server/tests/byo-rate-limit-router.test.js
//
// Proves the per-key rate limiter (docs/lens-specs/byo-keys-capability-
// map.md item #9) is actually load-bearing — wired into the REAL
// outbound-call chokepoint, server/lib/byo-router.js#brainChat — not
// just a UI-decoration number that nothing enforces.
//
// This exercises brainChat() end-to-end against a real in-memory
// user_brain_overrides row (migration 170), through the exact override
// branch every BYO-key caller (chat, expert-mode, reason.verify,
// agent-marathon, maker-checker, llm.local) goes through.
//
// Network isolation: global fetch is stubbed for the lifetime of this
// file so the test never depends on real network reachability (this
// sandbox routes HTTPS through a proxy; a live provider call is neither
// necessary nor desirable here). The stub also lets us assert, by call
// count, that a rate-limited request never reaches the provider fetch
// at all — the gate has to run BEFORE decrypt + provider dispatch, not
// just exist somewhere in the file.
//
// No DB_PATH needed — better-sqlite3(':memory:'), same pattern as
// server/tests/byo-keys.test.js.
//
// Every brainChat() call here passes `brainMode: "high_power"` explicitly.
// This file's fixture DB has no `users` table, so brainChat's own
// brain_mode lookup would fail-closed to 'private' and skip the BYO
// override path entirely (see server/tests/brain-mode-router.test.js for
// that gate's own dedicated coverage) — this file is specifically about
// the rate limiter, not the mode gate, so it supplies the mode directly
// to keep exercising exactly what it always tested.

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { setKey } from "../lib/byo-keys.js";
import { up as upMig170 } from "../migrations/170_byo_brain_overrides.js";
import { brainChat } from "../lib/byo-router.js";
import { setRateLimit, getRateLimitStatus } from "../lib/byo-rate-limit.js";

const ORIGINAL_FETCH = globalThis.fetch;
let fetchCallCount = 0;

function stubFetch() {
  fetchCallCount = 0;
  globalThis.fetch = async () => {
    fetchCallCount++;
    throw new Error("network disabled in test — byo-rate-limit-router.test.js stub");
  };
}

function setup() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, content TEXT);`);
  upMig170(db);
  return db;
}

beforeEach(() => {
  globalThis._concordSTATE = {};
  process.env.JWT_SECRET = "test-jwt-secret-for-byo-rate-limit-router-tests";
  stubFetch();
});

after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("brainChat() enforces the per-slot rate limit before touching the network", () => {
  it("allowed requests reach the provider dispatch (fetch is attempted) and consume a token", async () => {
    const db = setup();
    await setKey(db, "user_a", {
      slot: "conscious", provider: "anthropic", modelId: "claude-opus-4-7",
      apiKey: "sk-ant-fakekey-abc-1234567890",
    });
    setRateLimit("user_a", "conscious", 2);

    const r = await brainChat({ db, userId: "user_a", slot: "conscious", messages: [{ role: "user", content: "hi" }], brainMode: "high_power" });

    // Gate let it through: it reached the (stubbed) provider fetch, so
    // the failure is a network error, never "rate_limited".
    assert.equal(r.ok, false);
    assert.notEqual(r.error, "rate_limited");
    assert.equal(fetchCallCount, 1, "an allowed request must actually attempt the provider call");

    const status = getRateLimitStatus("user_a", 0);
    assert.equal(status.result.slots[0].remaining, 1, "one token must have been consumed by the real router path");
  });

  it("the request that exceeds the limit is rejected by brainChat() itself, WITHOUT ever calling fetch", async () => {
    const db = setup();
    await setKey(db, "user_a", {
      slot: "conscious", provider: "anthropic", modelId: "claude-opus-4-7",
      apiKey: "sk-ant-fakekey-abc-1234567890",
    });
    setRateLimit("user_a", "conscious", 1);

    const first = await brainChat({ db, userId: "user_a", slot: "conscious", messages: [{ role: "user", content: "hi" }], brainMode: "high_power" });
    assert.notEqual(first.error, "rate_limited");
    assert.equal(fetchCallCount, 1);

    const second = await brainChat({ db, userId: "user_a", slot: "conscious", messages: [{ role: "user", content: "hi again" }], brainMode: "high_power" });
    assert.equal(second.ok, false);
    assert.equal(second.error, "rate_limited");
    assert.equal(second.provider, "anthropic");
    assert.ok(Number.isFinite(second.retryAfterMs) && second.retryAfterMs > 0);
    // The critical assertion: the blocked call never reached the network.
    assert.equal(fetchCallCount, 1, "a rate-limited call must be rejected before the provider fetch, not after");
  });

  it("a slot with NO configured rate limit is unaffected (fail-open) — many calls all reach fetch", async () => {
    const db = setup();
    await setKey(db, "user_a", {
      slot: "utility", provider: "openai", modelId: "gpt-4o-mini",
      apiKey: "sk-openai-fakekey-abc-1234567890",
    });
    // No setRateLimit call for this slot.
    for (let i = 0; i < 5; i++) {
      const r = await brainChat({ db, userId: "user_a", slot: "utility", messages: [{ role: "user", content: "hi" }], brainMode: "high_power" });
      assert.notEqual(r.error, "rate_limited");
    }
    assert.equal(fetchCallCount, 5);
  });

  it("per-user isolation holds through the real router path", async () => {
    const db = setup();
    await setKey(db, "user_a", { slot: "conscious", provider: "anthropic", apiKey: "sk-ant-fakekey-a-1234567890" });
    await setKey(db, "user_b", { slot: "conscious", provider: "anthropic", apiKey: "sk-ant-fakekey-b-1234567890" });
    setRateLimit("user_a", "conscious", 1);
    setRateLimit("user_b", "conscious", 1);

    await brainChat({ db, userId: "user_a", slot: "conscious", messages: [{ role: "user", content: "hi" }], brainMode: "high_power" });
    const aBlocked = await brainChat({ db, userId: "user_a", slot: "conscious", messages: [{ role: "user", content: "hi" }], brainMode: "high_power" });
    assert.equal(aBlocked.error, "rate_limited");

    // User B's own bucket is untouched by user A's exhaustion.
    const bAllowed = await brainChat({ db, userId: "user_b", slot: "conscious", messages: [{ role: "user", content: "hi" }], brainMode: "high_power" });
    assert.notEqual(bAllowed.error, "rate_limited");
  });

  it("the concord_default fallback path (no override) never invokes the rate limiter at all", async () => {
    const db = setup();
    // No override row for this user/slot at all — brainChat should fall
    // straight through to the Ollama default path, which doesn't touch
    // the BYO rate limiter (there's no BYO key to protect).
    setRateLimit("ghost_user", "conscious", 1); // configured but irrelevant — no override exists
    const r = await brainChat({ db, userId: "ghost_user", slot: "conscious", messages: [{ role: "user", content: "hi" }], brainMode: "high_power" });
    assert.notEqual(r.error, "rate_limited");
    assert.equal(r.provider, "concord_default");
    // The BYO provider fetch stub was never hit — ollamaChat targets a
    // different (local) URL, not the stubbed global fetch failure mode
    // we're asserting on here, so we only assert the *shape*, not a
    // fetch count, for this fallback case.
  });
});
