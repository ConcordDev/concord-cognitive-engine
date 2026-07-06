// Phase D — endpoint-ROUTING wiring (as opposed to tests/brain-multi-endpoint.test.js,
// which already pins pickBrainEndpoint's own least-connections algorithm).
//
// This file proves the fix for a real production bug: `pickBrainEndpoint` /
// `noteEndpointStart` / `noteEndpointFinish` in lib/brain-config.js were fully
// built + unit-tested, but the actual dispatch functions that carry every
// piece of real traffic — `callBrain()` and the two `ctx.llm.chat()`
// implementations in server.js — read a completely separate, hand-rolled
// singular-URL `BRAIN` object and never called the picker. Setting
// `BRAIN_<NAME>_URLS` had zero effect on real requests.
//
// The tests below don't mock/spy pickBrainEndpoint (its exports are live
// ESM bindings — not reassignable from a consumer module). Instead they use
// the seam the task explicitly suggested: real local fake-Ollama HTTP
// servers + before/after snapshots of `getEndpointStats()` (the same state
// `/api/admin/brain-endpoints` reports). That's a stronger proof than a
// spy — it shows the URL pickBrainEndpoint chose is the SAME url the real
// fetch() hit, and that noteEndpointStart/Finish tracked that exact URL.
//
// Run: node --test tests/brain-endpoint-wiring.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

function makeFakeOllamaServer(label) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch { /* ignore */ }
      // Only count real /api/chat traffic — the only endpoint callBrain() /
      // ctx.llm.chat() ever hit. Boot-time warmup/health-check requests
      // (e.g. POST /api/generate) land on these same fake ports and must
      // not pollute the hit-counting assertions below; they still get a
      // 200 response so they don't hang or warn elsewhere.
      if (req.method === "POST" && req.url === "/api/chat") {
        hits.push(parsed);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: { content: `reply-from-${label}` }, eval_count: 3, done: true }));
    });
  });
  return { server, hits, label, url: null };
}

function listen(fake) {
  return new Promise((resolve, reject) => {
    fake.server.listen(0, "127.0.0.1", (err) => {
      if (err) return reject(err);
      const { port } = fake.server.address();
      fake.url = `http://127.0.0.1:${port}`;
      resolve(fake);
    });
  });
}

let fakeUtilA, fakeUtilB;      // utility brain — multi-endpoint (BRAIN_UTILITY_URLS)
let fakeSubconsciousSolo;      // subconscious brain — legacy singular (BRAIN_SUBCONSCIOUS_URL)
let fakeConsciousA, fakeConsciousB; // conscious brain — multi-endpoint, exercises ctx.llm.chat()
let __TEST__, brainConfig;

before(async () => {
  fakeUtilA = makeFakeOllamaServer("util-A");
  fakeUtilB = makeFakeOllamaServer("util-B");
  fakeSubconsciousSolo = makeFakeOllamaServer("solo");
  fakeConsciousA = makeFakeOllamaServer("conscious-A");
  fakeConsciousB = makeFakeOllamaServer("conscious-B");
  await Promise.all(
    [fakeUtilA, fakeUtilB, fakeSubconsciousSolo, fakeConsciousA, fakeConsciousB].map(listen)
  );

  // Multi-endpoint brain under test: utility → [A, B].
  process.env.BRAIN_UTILITY_URLS = `${fakeUtilA.url},${fakeUtilB.url}`;
  delete process.env.BRAIN_UTILITY_URL;

  // Legacy singular-URL brain (regression/fallback case): subconscious.
  delete process.env.BRAIN_SUBCONSCIOUS_URLS;
  process.env.BRAIN_SUBCONSCIOUS_URL = fakeSubconsciousSolo.url;

  // Multi-endpoint conscious, to exercise ctx.llm.chat() (a separate
  // hand-rolled dispatch path from callBrain()).
  process.env.BRAIN_CONSCIOUS_URLS = `${fakeConsciousA.url},${fakeConsciousB.url}`;
  delete process.env.BRAIN_CONSCIOUS_URL;

  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.CONCORD_NO_LISTEN = process.env.CONCORD_NO_LISTEN || "true";
  // Isolate persisted STATE (same rationale as tests/depth/_harness.js) so
  // this file's server.js boot doesn't collide with a stale state file.
  process.env.STATE_PATH = process.env.STATE_PATH
    || path.join(os.tmpdir(), `concord-brain-wiring-state-${process.pid}-${Date.now()}.json`);

  const serverMod = await import("../server.js");
  __TEST__ = serverMod.__TEST__;
  brainConfig = await import("../lib/brain-config.js");

  assert.ok(__TEST__?.callBrain, "server.js __TEST__ must expose callBrain for this wiring test");
  assert.ok(__TEST__?.BRAIN, "server.js __TEST__ must expose BRAIN for this wiring test");
});

after(async () => {
  await Promise.all(
    [fakeUtilA, fakeUtilB, fakeSubconsciousSolo, fakeConsciousA, fakeConsciousB].map(
      (f) => new Promise((resolve) => f.server.close(() => resolve()))
    )
  );
});

// Registered after the fake-server-close hook above so it runs last —
// node:test runs after() hooks in registration order.
registerServerCleanExit(() => __TEST__);

describe("Phase D wiring fix — callBrain() sources its URL from pickBrainEndpoint", () => {
  it("multi-endpoint utility: dispatches to a real pickBrainEndpoint candidate, not the hardcoded singular default", async () => {
    brainConfig._resetEndpointStats();
    fakeUtilA.hits.length = 0;
    fakeUtilB.hits.length = 0;
    __TEST__.BRAIN.utility.enabled = true;

    // Sanity: the legacy singular BRAIN.utility.url still resolves to the
    // hardcoded docker-compose default — proving neither fake endpoint is
    // reachable through the OLD (pre-fix) code path that read brain.url
    // directly. If the fix weren't wired, this call would fail/timeout
    // rather than reach fakeUtilA/fakeUtilB.
    assert.equal(__TEST__.BRAIN.utility.url, "http://ollama-utility:11434");

    const before = brainConfig.getEndpointStats().utility;
    assert.deepEqual(before.map((e) => e.lastHealthyAt), [0, 0], "no prior traffic recorded");

    const result = await __TEST__.callBrain("utility", "wiring test prompt");
    assert.equal(result.ok, true, `expected ok:true, got ${JSON.stringify(result)}`);
    assert.match(result.content, /^reply-from-util-(A|B)$/);

    const totalHits = fakeUtilA.hits.length + fakeUtilB.hits.length;
    assert.equal(totalHits, 1, "exactly one fake endpoint received the real HTTP request");

    const hitUrl = fakeUtilA.hits.length === 1 ? fakeUtilA.url : fakeUtilB.url;
    const idleUrl = hitUrl === fakeUtilA.url ? fakeUtilB.url : fakeUtilA.url;

    const stats = brainConfig.getEndpointStats().utility;
    const hitStat = stats.find((s) => s.url === hitUrl);
    const idleStat = stats.find((s) => s.url === idleUrl);

    assert.ok(hitStat, "dispatched endpoint must be tracked by brain-config.js");
    assert.equal(hitStat.inflight, 0, "inflight counter released after the call completes (noteEndpointFinish ran)");
    assert.ok(hitStat.lastHealthyAt > 0, "noteEndpointFinish(url, {ok:true}) recorded success on the SAME url the real fetch hit");
    assert.equal(idleStat.lastHealthyAt, 0, "the endpoint NOT dispatched to must be untouched");
  });

  it("least-connections routing reaches the real dispatch: a busy endpoint is avoided on the next call", async () => {
    brainConfig._resetEndpointStats();
    fakeUtilA.hits.length = 0;
    fakeUtilB.hits.length = 0;
    __TEST__.BRAIN.utility.enabled = true;

    // Simulate endpoint A already carrying an in-flight request.
    brainConfig.noteEndpointStart(fakeUtilA.url);

    const result = await __TEST__.callBrain("utility", "second prompt, A is busy");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(fakeUtilB.hits.length, 1, "the idle endpoint (B) must receive the call while A is marked busy");
    assert.equal(fakeUtilA.hits.length, 0, "the busy endpoint (A) must be avoided");

    brainConfig.noteEndpointFinish(fakeUtilA.url, { ok: true }); // release the manual mark
  });
});

describe("Phase D wiring fix — single-endpoint fallback is unchanged (regression safety)", () => {
  it("callBrain('subconscious', …) with no BRAIN_SUBCONSCIOUS_URLS set still dispatches to the legacy singular URL", async () => {
    brainConfig._resetEndpointStats();
    fakeSubconsciousSolo.hits.length = 0;
    __TEST__.BRAIN.subconscious.enabled = true;

    assert.equal(__TEST__.BRAIN.subconscious.url, fakeSubconsciousSolo.url, "legacy singular URL resolution is unaffected by the fix");

    const result = await __TEST__.callBrain("subconscious", "solo prompt");
    assert.equal(result.ok, true, `expected ok:true, got ${JSON.stringify(result)}`);
    assert.equal(result.content, "reply-from-solo");
    assert.equal(fakeSubconsciousSolo.hits.length, 1);

    const stats = brainConfig.getEndpointStats().subconscious;
    assert.equal(stats.length, 1, "single-endpoint brain has exactly one candidate");
    assert.equal(stats[0].url, fakeSubconsciousSolo.url);
    assert.equal(stats[0].inflight, 0);
    assert.ok(stats[0].lastHealthyAt > 0);
  });
});

describe("Phase D wiring fix — ctx.llm.chat() (makeCtx) is a separate dispatch path, also fixed", () => {
  it("ctx.llm.chat routes the conscious brain through pickBrainEndpoint, not the hardcoded BRAIN.conscious.url alone", async () => {
    brainConfig._resetEndpointStats();
    fakeConsciousA.hits.length = 0;
    fakeConsciousB.hits.length = 0;
    __TEST__.BRAIN.conscious.enabled = true;

    const ctx = __TEST__.makeCtx(null);
    assert.ok(ctx?.llm?.chat, "ctx.llm.chat must exist");

    const result = await ctx.llm.chat({
      messages: [{ role: "user", content: "wiring test" }],
      maxTokens: 16,
      timeoutMs: 5000,
    });

    assert.equal(result.ok, true, `expected ok:true, got ${JSON.stringify(result)}`);
    assert.match(result.content, /^reply-from-conscious-(A|B)$/);

    const totalHits = fakeConsciousA.hits.length + fakeConsciousB.hits.length;
    assert.equal(totalHits, 1, "exactly one fake conscious endpoint received the real HTTP request");

    const hitUrl = fakeConsciousA.hits.length === 1 ? fakeConsciousA.url : fakeConsciousB.url;
    const stats = brainConfig.getEndpointStats().conscious;
    const hitStat = stats.find((s) => s.url === hitUrl);
    assert.ok(hitStat, "dispatched conscious endpoint must be tracked");
    assert.equal(hitStat.inflight, 0);
    assert.ok(hitStat.lastHealthyAt > 0, "ctx.llm.chat's own fetch is now wrapped in noteEndpointStart/Finish");
  });
});
