// INC-137: High Power / BYO get cloud answers when the pod brain is down; Private never calls a cloud.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudChatAvailable, cloudFallbackChat, llmReadyFor } from "../lib/llm-cloud-fallback.js";
import { registerBrainModeRoutes, setAtSeconds } from "../routes/brain-mode.js";

const boom = (name) => () => { throw new Error(`Private Mode touched ${name}`); };
const PRIVATE = { userId: "u1", brainMode: "private" };
const HIGH = { userId: "u1", brainMode: "high_power" };

test("Private Mode: no cloud lookup, no cloud call, ever", async () => {
  const deps = { getOverride: boom("getOverride"), platformProviderConfigured: boom("platformProviderConfigured"),
    pickFreeCloudProvider: boom("pickFreeCloudProvider"), freeCloudProviderChat: boom("freeCloudProviderChat") };
  assert.equal(cloudChatAvailable({ db: {}, actor: PRIVATE }, deps), false);
  assert.equal(cloudChatAvailable({ db: {}, actor: null }, deps), false);
  assert.equal(cloudChatAvailable({ db: {}, actor: { userId: "u1" } }, deps), false);
  const r = await cloudFallbackChat({ db: {}, actor: PRIVATE, messages: [{ role: "user", content: "hi" }] }, deps);
  assert.equal(r.ok, false);
  assert.equal(r.error, "private_mode_local_only");
  assert.equal(llmReadyFor({ localReady: false, db: {}, actor: PRIVATE }, deps), false);
  assert.equal(llmReadyFor({ localReady: true, db: {}, actor: PRIVATE }, deps), true);
});

test("Private Mode end to end: byo-router brainChat never contacts a cloud host", async () => {
  const { brainChat } = await import("../lib/byo-router.js");
  const hosts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { hosts.push(new URL(String(url)).host); throw new Error("offline (test)"); };
  const saved = {};
  for (const k of ["OPENROUTER_API_KEY", "CEREBRAS_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "CLOUDFLARE_API_TOKEN"]) { saved[k] = process.env[k]; process.env[k] = "test-key"; }
  try {
    const r = await brainChat({ db: null, userId: "u1", slot: "conscious", brainMode: "private", messages: [{ role: "user", content: "hi" }], opts: { timeoutMs: 500 } });
    assert.equal(r.ok, false);
    const cloud = hosts.filter((h) => /openrouter|cerebras|groq|googleapis|generativelanguage|mistral|cloudflare/i.test(h));
    assert.deepEqual(cloud, [], `cloud hosts contacted: ${cloud.join(", ")}`);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("High Power with the pod down: a cloud route exists and the fallback calls it", async () => {
  let called = null;
  const deps = { getOverride: () => null, platformProviderConfigured: () => false, pickFreeCloudProvider: () => ({ provider: "groq" }),
    freeCloudProviderChat: async (a) => { called = a; return { ok: true, text: "100 °C", provider: "groq", model: "llama" }; } };
  assert.equal(cloudChatAvailable({ db: {}, actor: HIGH }, deps), true);
  assert.equal(llmReadyFor({ localReady: false, db: {}, actor: HIGH }, deps), true);
  const r = await cloudFallbackChat({ db: {}, actor: HIGH, messages: [{ role: "user", content: "boiling point?" }] }, deps);
  assert.equal(r.ok, true); assert.equal(r.provider, "groq"); assert.equal(called.userId, "u1");
  // BYO key alone counts as a route
  assert.equal(cloudChatAvailable({ db: {}, actor: HIGH }, { getOverride: () => ({ provider: "openai" }), platformProviderConfigured: () => false, pickFreeCloudProvider: () => null }), true);
  // nothing configured → honest false
  assert.equal(cloudChatAvailable({ db: {}, actor: HIGH }, { getOverride: () => null, platformProviderConfigured: () => false, pickFreeCloudProvider: () => null }), false);
});

function fakeApp() {
  const routes = {};
  const app = { get: (p, _a, h) => { routes[`GET ${p}`] = h; }, post: (p, _a, h) => { routes[`POST ${p}`] = h; } };
  const rows = new Map([["u1", { brain_mode: "private", brain_mode_set_at: 1792321127009 }]]);
  const db = { prepare: (sql) => ({
    get: (id) => rows.get(id),
    run: (mode, at, id) => { rows.set(id, { brain_mode: mode, brain_mode_set_at: at }); },
  }) };
  registerBrainModeRoutes(app, { db, requireAuth: () => {} });
  const call = (key, body) => new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(j) { resolve({ status: this.statusCode, body: j }); } };
    routes[key]({ user: { id: "u1" }, body }, res);
  });
  return { call, rows };
}

test("/api/brain-mode enforces the High Power allowlist and stores seconds", async () => {
  const prev = process.env.CONCORD_HIGH_POWER_ALLOWLIST;
  try {
    const { call, rows } = fakeApp();
    // legacy millisecond value is reported in seconds
    assert.equal((await call("GET /api/brain-mode")).body.brain_mode_set_at, 1792321127);
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "someone-else";
    const denied = await call("POST /api/brain-mode", { mode: "high_power" });
    assert.equal(denied.status, 403); assert.equal(rows.get("u1").brain_mode, "private");
    const priv = await call("POST /api/brain-mode", { mode: "private" });
    assert.equal(priv.status, 200);
    assert.ok(rows.get("u1").brain_mode_set_at < 1e11, "seconds, not ms");
    process.env.CONCORD_HIGH_POWER_ALLOWLIST = "u1";
    const ok = await call("POST /api/brain-mode", { mode: "high_power" });
    assert.equal(ok.status, 200); assert.equal(rows.get("u1").brain_mode, "high_power");
    assert.equal(setAtSeconds(1792321126), 1792321126);
  } finally {
    if (prev === undefined) delete process.env.CONCORD_HIGH_POWER_ALLOWLIST; else process.env.CONCORD_HIGH_POWER_ALLOWLIST = prev;
  }
});
