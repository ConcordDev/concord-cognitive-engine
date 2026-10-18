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

// ── INC-138: the free-cloud chain survives a dead slug, a busy Gemini, and a dead provider ──
import { freeCloudProviderChat } from "../lib/free-cloud-router-extended.js";
import { _testing as fcr, modelsFor } from "../lib/free-cloud-router.js";
import { platformProviderChat } from "../lib/platform-providers.js";
import { BYO_PROVIDERS } from "../lib/byo-providers.js";

const Q = [{ role: "user", content: "What is the boiling point of water at sea level?" }];
const okQuota = { fcfsTryConsumeDb: () => ({ allowed: true }), fcfsRecordUsageDb: () => {} };
function scripted(script) {
  const calls = [];
  const providerChat = async (a) => {
    calls.push(`${a.provider}/${a.modelId}`);
    const next = script(a, calls.length);
    return typeof next === "string" ? { ok: false, text: "", error: next } : { ok: true, text: next.text, tokensIn: 1, tokensOut: 1 };
  };
  return { calls, providerChat };
}

test("INC-138: no withdrawn OpenRouter slug is a default, and OpenRouter has 2-3 ordered free models", () => {
  const dead = /llama-3\.3-70b-instruct:free|qwen-2\.5-72b-instruct:free|llama-3\.1-8b-instruct:free|qwen-2\.5-coder-32b-instruct:free|llama-3\.2-90b-vision-instruct:free/;
  for (const m of [...Object.values(fcr.DEFAULT_MODELS.openrouter), ...Object.values(BYO_PROVIDERS.defaultModels.openrouter)]) assert.doesNotMatch(m, dead);
  const list = modelsFor("openrouter", "conscious");
  assert.ok(list.length >= 2 && list.length <= 3, String(list));
  assert.ok(list.every((m) => m.endsWith(":free")));
});

test("INC-138: OpenRouter 404 on the first slug -> next free slug answers", async () => {
  const { calls, providerChat } = scripted((a, n) => (n === 1 ? "openrouter_404: unavailable for free" : { text: "100 °C" }));
  const r = await freeCloudProviderChat({ db: {}, userId: "u1", slot: "conscious", messages: Q }, {
    ...okQuota, providerChat,
    freeCloudCandidates: () => [{ provider: "openrouter", models: ["a:free", "b:free", "c:free"], apiKey: "k" }],
  });
  assert.equal(r.ok, true); assert.equal(r.model, "b:free");
  assert.deepEqual(calls, ["openrouter/a:free", "openrouter/b:free"]);
});

test("INC-138: every OpenRouter model 404/429/5xx -> next provider (groq) answers; cerebras without adapter is skipped", async () => {
  const errs = ["openrouter_404: gone", "openrouter_429: rate", "openrouter_502: bad gw"];
  const { calls, providerChat } = scripted((a, n) => (a.provider === "openrouter" ? errs[n - 1] : { text: "100 °C at 1 atm" }));
  const r = await freeCloudProviderChat({ db: {}, userId: "u1", slot: "conscious", messages: Q }, {
    ...okQuota, providerChat,
    freeCloudCandidates: () => [
      { provider: "openrouter", models: ["a:free", "b:free", "c:free"], apiKey: "k" },
      { provider: "cerebras", models: ["x"], apiKey: "k" },
      { provider: "groq", models: ["llama-3.3-70b-versatile"], apiKey: "k" },
    ],
  });
  assert.equal(r.ok, true); assert.equal(r.provider, "groq");
  assert.equal(calls.length, 4); assert.ok(!calls.some((c) => c.startsWith("cerebras")));
});

test("INC-138: free-cloud Gemini 503 high demand -> one retry, then the lighter Gemini model", async () => {
  process.env.CONCORD_FREE_CLOUD_RETRY_MS = "0";
  try {
    const { calls, providerChat } = scripted((a, n) => (n <= 2 ? "google_503: high demand" : { text: "100 °C" }));
    const r = await freeCloudProviderChat({ db: {}, userId: "u1", slot: "conscious", messages: Q }, {
      ...okQuota, providerChat,
      freeCloudCandidates: () => [{ provider: "gemini", models: ["gemini-3.6-flash", "gemini-3.5-flash-lite"], apiKey: "k" }],
    });
    assert.equal(r.ok, true); assert.equal(r.model, "gemini-3.5-flash-lite");
    assert.deepEqual(calls, ["google/gemini-3.6-flash", "google/gemini-3.6-flash", "google/gemini-3.5-flash-lite"]);
  } finally { delete process.env.CONCORD_FREE_CLOUD_RETRY_MS; }
});

test("INC-138: all providers down -> honest failure with the attempt trail", async () => {
  const { providerChat } = scripted(() => "groq_500: down");
  const r = await freeCloudProviderChat({ db: {}, userId: "u1", slot: "conscious", messages: Q }, {
    ...okQuota, providerChat, freeCloudCandidates: () => [{ provider: "groq", models: ["m"], apiKey: "k" }],
  });
  assert.equal(r.ok, false); assert.equal(r.attempts.length, 1); assert.match(r.error, /groq_500/);
});

test("INC-138: platform Gemini 503 -> retried once after a short backoff, then gemini-3.5-flash-lite answers", async () => {
  const saved = { k: process.env.CONCORD_PLATFORM_GOOGLE_API_KEY, p: process.env.CONCORD_PLATFORM_PROVIDER_CONSCIOUS, d: process.env.CONCORD_PLATFORM_RETRY_MS };
  const realFetch = globalThis.fetch; const realState = globalThis._concordSTATE;
  process.env.CONCORD_PLATFORM_GOOGLE_API_KEY = "test-key"; delete process.env.CONCORD_PLATFORM_PROVIDER_CONSCIOUS;
  process.env.CONCORD_PLATFORM_RETRY_MS = "0"; globalThis._concordSTATE = {};
  const models = [];
  globalThis.fetch = async (url) => {
    const m = /models\/([^:]+):generateContent/.exec(decodeURIComponent(String(url)));
    models.push(m?.[1]);
    if (m?.[1] !== "gemini-3.5-flash-lite") return { ok: false, status: 503, headers: new Map(), text: async () => '{"error":{"code":503,"message":"high demand"}}' };
    return { ok: true, status: 200, headers: new Map(), json: async () => ({ candidates: [{ content: { parts: [{ text: "100 °C" }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }) };
  };
  try {
    const r = await platformProviderChat({ slot: "conscious", messages: Q });
    assert.equal(r.ok, true, r.error); assert.equal(r.model, "gemini-3.5-flash-lite");
    assert.deepEqual(models, ["gemini-3.6-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]);
  } finally {
    globalThis.fetch = realFetch; globalThis._concordSTATE = realState;
    for (const [k, v] of [["CONCORD_PLATFORM_GOOGLE_API_KEY", saved.k], ["CONCORD_PLATFORM_PROVIDER_CONSCIOUS", saved.p], ["CONCORD_PLATFORM_RETRY_MS", saved.d]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
