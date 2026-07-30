// server/tests/brain-mode-router.test.js
//
// Task #34 of the Private Mode / High Power Mode plan: end-to-end proof of
// byo-router.js#brainChat's full precedence contract, at the real network
// boundary (a stubbed global.fetch categorized by hostname), not just by
// reading the source.
//
// Contract under test (see byo-router.js's own header comments):
//   Private:     ALWAYS local Ollama — skips BOTH the BYO override lookup
//                and the platform-provider path entirely, even when this
//                account has its own active BYO override configured.
//   High Power:  BYO override (if active) -> platform provider (if
//                configured) -> local Ollama fallback.
//   DB error:    getBrainMode() fails CLOSED to 'private' (the one
//                deliberate exception to BYO's fail-open philosophy).
//
// The critical assertion the plan calls for: a Private-mode user with an
// ACTIVE BYO override must produce ZERO fetch calls to that provider's
// real hostname — proving the override lookup is skipped outright, not
// merely that its result gets discarded after the fact.

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { setKey } from "../lib/byo-keys.js";
import { up as upMig170 } from "../migrations/170_byo_brain_overrides.js";
import { up as upMig397 } from "../migrations/397_brain_mode.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

// brain-config.js's BRAIN_CONFIG is a module-level const computed ONCE
// from env vars at import time (same footgun documented in
// tests/inference-metering-chat-wiring.test.js and
// tests/brain-multi-endpoint.test.js) -- byo-router.js transitively
// imports it via lib/inference/ollama-client.js, so BRAIN_CONSCIOUS_URL
// must be set BEFORE that import chain first runs. A plain top-level
// statement here executes before this dynamic import() (dynamic imports
// are NOT hoisted the way static `import` declarations are), so this is
// the one static import in this file deferred to a dynamic one.
process.env.BRAIN_CONSCIOUS_URL = "http://fake-ollama-test-host:11434";
delete process.env.BRAIN_CONSCIOUS_URLS;
const { brainChat } = await import("../lib/byo-router.js");

// Categorize every fetch call by hostname so a single stub can prove BOTH
// "no call reached provider X" and "a call reached provider Y" without
// needing per-test fetch replacement.
const PROVIDER_HOSTS = {
  anthropic: "api.anthropic.com",
  openai: "api.openai.com",
  xai: "api.x.ai",
  groq: "api.groq.com",
  mistral: "api.mistral.ai",
  google: "generativelanguage.googleapis.com",
};

let calls;

function stubFetch() {
  calls = { anthropic: 0, openai: 0, xai: 0, groq: 0, mistral: 0, google: 0, ollama: 0, other: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    const hit = Object.entries(PROVIDER_HOSTS).find(([, host]) => u.includes(host));
    if (hit) calls[hit[0]]++;
    else if (u.includes("fake-ollama-test-host")) calls.ollama++;
    else calls.other++;
    throw new Error("network disabled in test — brain-mode-router.test.js stub");
  };
}

function setup() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, content TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY);
  `);
  upMig170(db);
  upMig397(db);
  db.prepare(`INSERT INTO users (id) VALUES ('u1')`).run();
  return db;
}

beforeEach(() => {
  globalThis._concordSTATE = {};
  process.env.JWT_SECRET = "test-jwt-secret-for-brain-mode-router-tests";
  delete process.env.CONCORD_PLATFORM_GROQ_API_KEY;
  delete process.env.CONCORD_PLATFORM_GOOGLE_API_KEY;
  delete process.env.CONCORD_PLATFORM_MISTRAL_API_KEY;
  delete process.env.CONCORD_PLATFORM_PROVIDER_CONSCIOUS;
  stubFetch();
});

after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
});

describe("brainChat() — Private Mode: whole-account, no-exceptions guarantee", () => {
  it("a Private-mode user with an ACTIVE BYO override never triggers a fetch to that provider at all", async () => {
    const db = setup();
    db.prepare(`UPDATE users SET brain_mode = 'private' WHERE id = 'u1'`).run();
    await setKey(db, "u1", { slot: "conscious", provider: "anthropic", apiKey: "sk-ant-fake-key-1234567890" });

    await brainChat({ db, userId: "u1", slot: "conscious", messages: [{ role: "user", content: "hi" }] });

    assert.equal(calls.anthropic, 0, "Private mode must skip the BYO override lookup outright, not just discard its result");
    assert.equal(calls.ollama, 1, "Private mode must still reach local Ollama");
  });

  it("Private mode also skips a configured platform provider entirely", async () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-operator-key";
    const db = setup();
    db.prepare(`UPDATE users SET brain_mode = 'private' WHERE id = 'u1'`).run();

    await brainChat({ db, userId: "u1", slot: "conscious", messages: [{ role: "user", content: "hi" }] });

    assert.equal(calls.groq, 0);
    assert.equal(calls.ollama, 1);
  });

  it("the returned provider tag is honestly 'concord_default', not the configured-but-unused override", async () => {
    const db = setup();
    db.prepare(`UPDATE users SET brain_mode = 'private' WHERE id = 'u1'`).run();
    await setKey(db, "u1", { slot: "conscious", provider: "anthropic", apiKey: "sk-ant-fake-key-1234567890" });

    const r = await brainChat({ db, userId: "u1", slot: "conscious", messages: [{ role: "user", content: "hi" }] });
    assert.equal(r.provider, "concord_default");
  });
});

describe("brainChat() — High Power Mode: BYO -> platform -> Ollama precedence", () => {
  it("an active BYO override wins over a configured platform provider", async () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-operator-key";
    const db = setup();
    db.prepare(`UPDATE users SET brain_mode = 'high_power' WHERE id = 'u1'`).run();
    await setKey(db, "u1", { slot: "conscious", provider: "anthropic", apiKey: "sk-ant-fake-key-1234567890" });

    await brainChat({ db, userId: "u1", slot: "conscious", messages: [{ role: "user", content: "hi" }] });

    assert.equal(calls.anthropic, 1, "BYO override must be tried first");
    assert.equal(calls.groq, 0, "platform provider must not be reached when BYO succeeded in being attempted");
  });

  it("with NO BYO override, a configured platform provider (groq) is used", async () => {
    // groq is platform-providers.js's default for utility/subconscious/
    // repair, NOT conscious (which defaults to google) -- use the
    // matching slot, or this would need CONCORD_PLATFORM_PROVIDER_CONSCIOUS
    // to override it. utility is the more representative case anyway
    // (groq is the no-training-tradeoff default for the higher-volume slots).
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-operator-key";
    const db = setup();
    db.prepare(`UPDATE users SET brain_mode = 'high_power' WHERE id = 'u1'`).run();

    await brainChat({ db, userId: "u1", slot: "utility", messages: [{ role: "user", content: "hi" }] });

    assert.equal(calls.groq, 1);
    assert.equal(calls.ollama, 0);
  });

  it("with NO BYO override and google configured for the slot, google is used", async () => {
    process.env.CONCORD_PLATFORM_GOOGLE_API_KEY = "test-operator-key";
    process.env.CONCORD_PLATFORM_PROVIDER_CONSCIOUS = "google";
    const db = setup();
    db.prepare(`UPDATE users SET brain_mode = 'high_power' WHERE id = 'u1'`).run();

    await brainChat({ db, userId: "u1", slot: "conscious", messages: [{ role: "user", content: "hi" }] });

    assert.equal(calls.google, 1);
  });

  it("with NO BYO override and mistral configured for the slot, mistral is used", async () => {
    process.env.CONCORD_PLATFORM_MISTRAL_API_KEY = "test-operator-key";
    process.env.CONCORD_PLATFORM_PROVIDER_CONSCIOUS = "mistral";
    const db = setup();
    db.prepare(`UPDATE users SET brain_mode = 'high_power' WHERE id = 'u1'`).run();

    await brainChat({ db, userId: "u1", slot: "conscious", messages: [{ role: "user", content: "hi" }] });

    assert.equal(calls.mistral, 1);
  });

  it("with NEITHER a BYO override nor a platform provider configured, falls all the way through to local Ollama", async () => {
    const db = setup();
    db.prepare(`UPDATE users SET brain_mode = 'high_power' WHERE id = 'u1'`).run();

    const r = await brainChat({ db, userId: "u1", slot: "conscious", messages: [{ role: "user", content: "hi" }] });

    assert.equal(calls.ollama, 1);
    assert.equal(r.provider, "concord_default");
  });
});

describe("brainChat() — brain_mode lookup fails CLOSED to 'private'", () => {
  it("a missing users table (migration 397 not applied) fails closed — no BYO/platform reached despite a configured override", async () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-operator-key";
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, content TEXT);`);
    upMig170(db);
    // Deliberately NOT running upMig397 — users table (and brain_mode
    // column) simply doesn't exist in this db.
    await setKey(db, "u1", { slot: "conscious", provider: "anthropic", apiKey: "sk-ant-fake-key-1234567890" });

    const r = await brainChat({ db, userId: "u1", slot: "conscious", messages: [{ role: "user", content: "hi" }] });

    assert.equal(calls.anthropic, 0, "a lookup failure must fail CLOSED, never accidentally open a cloud path");
    assert.equal(calls.groq, 0);
    assert.equal(calls.ollama, 1);
    assert.equal(r.provider, "concord_default");
  });

  it("a missing db object fails closed to private", async () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-operator-key";
    const r = await brainChat({ db: null, userId: "u1", slot: "conscious", messages: [{ role: "user", content: "hi" }] });
    assert.equal(calls.groq, 0);
    assert.equal(calls.ollama, 1);
    assert.equal(r.provider, "concord_default");
  });

  it("a missing userId fails closed to private", async () => {
    process.env.CONCORD_PLATFORM_GROQ_API_KEY = "test-operator-key";
    const db = setup();
    const r = await brainChat({ db, userId: null, slot: "conscious", messages: [{ role: "user", content: "hi" }] });
    assert.equal(calls.groq, 0);
    assert.equal(r.provider, "concord_default");
  });
});

describe("brainChat() — an explicitly-passed brainMode short-circuits the DB lookup", () => {
  it("brainMode: 'private' passed by an already-mode-aware caller (e.g. ctx.llm.chat) is honored without a DB read", async () => {
    const db = setup();
    // Account is actually high_power in the DB...
    db.prepare(`UPDATE users SET brain_mode = 'high_power' WHERE id = 'u1'`).run();
    await setKey(db, "u1", { slot: "conscious", provider: "anthropic", apiKey: "sk-ant-fake-key-1234567890" });

    // ...but the caller explicitly passes 'private' (matches how
    // ctx.llm.chat threads ctx.actor.brainMode through for free).
    await brainChat({ db, userId: "u1", slot: "conscious", messages: [{ role: "user", content: "hi" }], brainMode: "private" });

    assert.equal(calls.anthropic, 0, "an explicit brainMode argument must win over the DB value");
    assert.equal(calls.ollama, 1);
  });
});
