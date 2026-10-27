// GDELT headlines/daily-briefing: per-category cache, single-queue spacing,
// request timeout, 429/5xx backoff with degraded-but-ok answers.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerNewsActions, {
  __resetGdeltCacheForTests,
  __configureGdeltForTests,
} from "../domains/news.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  return ACTIONS.get(`news.${name}`)(ctxA, { id: null, data: {}, meta: {} }, params);
}
const ctxA = { actor: { userId: "u" }, userId: "u" };

const realFetch = globalThis.fetch;
const article = (title) => ({ title, url: `https://example.com/${encodeURIComponent(title)}`, domain: "example.com" });
const okResponse = (titles) => ({ ok: true, status: 200, json: async () => ({ articles: titles.map(article) }) });
const errResponse = (status) => ({ ok: false, status, json: async () => ({}) });

before(() => { registerNewsActions(register); });
beforeEach(() => {
  __resetGdeltCacheForTests();
  __configureGdeltForTests({ spacingMs: 0 });
});
afterEach(() => { globalThis.fetch = realFetch; __resetGdeltCacheForTests(); });

describe("GDELT cache", () => {
  it("second headlines call within 15 minutes is served from cache (one fetch)", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return okResponse(["A", "B", "C", "D", "E", "F"]); };
    const first = await call("headlines", { category: "tech", limit: 5 });
    const second = await call("headlines", { category: "tech", limit: 50 });
    assert.equal(calls, 1);
    assert.equal(first.result.count, 5);
    // Different limits share one cache entry; the limit only slices the list.
    assert.equal(second.result.count, 6);
    assert.equal(second.result.degraded, undefined);
  });

  it("requests maxrecords=50 regardless of the requested limit", async () => {
    let url = "";
    globalThis.fetch = async (u) => { url = u; return okResponse([]); };
    await call("headlines", { category: "science", limit: 7 });
    assert.match(url, /maxrecords=50/);
  });

  it("cache expires after 15 minutes and is refetched", async () => {
    let now = 1_000_000;
    __configureGdeltForTests({ now: () => now });
    let calls = 0;
    globalThis.fetch = async () => { calls++; return okResponse(["X"]); };
    await call("headlines", { category: "business" });
    now += 14 * 60 * 1000;
    await call("headlines", { category: "business" });
    assert.equal(calls, 1);
    now += 2 * 60 * 1000;
    await call("headlines", { category: "business" });
    assert.equal(calls, 2);
  });
});

describe("GDELT queue", () => {
  it("concurrent calls are serialized: never two requests in flight", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    globalThis.fetch = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return okResponse(["Z"]);
    };
    const results = await Promise.all(
      ["tech", "science", "business", "politics"].map((category) => call("headlines", { category })),
    );
    assert.equal(maxInFlight, 1);
    assert.ok(results.every((r) => r.ok === true && r.result.count === 1));
  });

  it("request starts are spaced by the configured minimum gap", async () => {
    __configureGdeltForTests({ spacingMs: 120 });
    const starts = [];
    globalThis.fetch = async () => { starts.push(Date.now()); return okResponse([]); };
    await Promise.all([call("headlines", { category: "tech" }), call("headlines", { category: "health" })]);
    assert.equal(starts.length, 2);
    assert.ok(starts[1] - starts[0] >= 110, `gap was ${starts[1] - starts[0]} ms`);
  });

  it("concurrent calls for the same category share one in-flight fetch", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return okResponse(["Shared"]);
    };
    const results = await Promise.all([1, 2, 3].map(() => call("headlines", { category: "sports" })));
    assert.equal(calls, 1);
    assert.ok(results.every((r) => r.result.headlines[0].title === "Shared"));
  });
});

describe("GDELT failure handling", () => {
  it("429 with cached data: ok:true, degraded, stale cache, and no fetch during backoff", async () => {
    let now = 5_000_000;
    __configureGdeltForTests({ now: () => now });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return calls === 1 ? okResponse(["Cached one", "Cached two"]) : errResponse(429);
    };
    await call("headlines", { category: "world" });

    now += 16 * 60 * 1000; // cache is now stale
    const limited = await call("headlines", { category: "world" });
    assert.equal(limited.ok, true);
    assert.equal(calls, 2);
    assert.equal(limited.result.degraded, true);
    assert.equal(limited.result.degradedReason, "rate_limited");
    assert.equal(limited.result.stale, true);
    assert.ok(limited.result.cachedAt);
    assert.deepEqual(limited.result.headlines.map((h) => h.title), ["Cached one", "Cached two"]);

    now += 30 * 1000; // still inside the 60 s backoff window
    const during = await call("headlines", { category: "world" });
    assert.equal(calls, 2, "no GDELT call while backing off");
    assert.equal(during.result.degraded, true);
    assert.equal(during.result.headlines.length, 2);
  });

  it("backoff doubles on repeated failures and resets on success", async () => {
    let now = 9_000_000;
    __configureGdeltForTests({ now: () => now });
    let calls = 0;
    let respond = errResponse(429);
    globalThis.fetch = async () => { calls++; return respond; };

    await call("headlines", { category: "health" }); // fail #1 -> 60 s window
    now += 61 * 1000;
    await call("headlines", { category: "health" }); // fail #2 -> 120 s window
    assert.equal(calls, 2);
    now += 90 * 1000;
    await call("headlines", { category: "health" });
    assert.equal(calls, 2, "still inside the doubled 120 s window");
    now += 40 * 1000;
    respond = okResponse(["Back"]);
    const ok = await call("headlines", { category: "health" });
    assert.equal(calls, 3);
    assert.equal(ok.result.degraded, undefined);
    assert.equal(ok.result.headlines[0].title, "Back");
  });

  it("no cache and a failure: ok:true, empty list, degraded with a reason (no invented headlines)", async () => {
    globalThis.fetch = async () => errResponse(503);
    const r = await call("headlines", { category: "entertainment" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.headlines, []);
    assert.equal(r.result.count, 0);
    assert.equal(r.result.degraded, true);
    assert.equal(r.result.degradedReason, "upstream_error: GDELT 503");
    assert.equal(r.result.cachedAt, undefined);
  });

  it("a hanging fetch is aborted by the timeout and reported as degraded", async () => {
    __configureGdeltForTests({ timeoutMs: 40 });
    let signal = null;
    globalThis.fetch = (_url, opts) => {
      signal = opts.signal;
      return new Promise(() => {}); // never settles and ignores nothing
    };
    const started = Date.now();
    const r = await call("headlines", { category: "top" });
    assert.ok(Date.now() - started < 1000, "timeout must bound the call");
    assert.equal(signal.aborted, true);
    assert.equal(r.ok, true);
    assert.equal(r.result.degradedReason, "timeout");
    assert.deepEqual(r.result.headlines, []);
  });

  it("daily-briefing answers ok:true within its budget when GDELT is slow", async () => {
    __configureGdeltForTests({ briefingBudgetMs: 60, timeoutMs: 2000 });
    globalThis.fetch = async () => {
      await new Promise((r) => setTimeout(r, 80));
      return okResponse(["Slow story"]);
    };
    const started = Date.now();
    const r = await call("daily-briefing");
    const elapsed = Date.now() - started;
    assert.equal(r.ok, true);
    assert.ok(elapsed < 500, `briefing took ${elapsed} ms`);
    assert.equal(r.result.degraded, true);
    assert.equal(r.result.degradedReason, "budget_exceeded");
    assert.deepEqual(r.result.topStories.bullets, []);
    assert.equal(r.result.topStories.unavailableReason, "budget_exceeded");
    // Let the queued background fetches finish so they do not leak into the next test.
    await new Promise((r) => setTimeout(r, 400));
  });

  it("daily-briefing uses cached sections without waiting when they are fresh", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return okResponse(["Fresh"]); };
    await call("daily-briefing"); // fills all four categories
    const again = await call("daily-briefing");
    assert.equal(calls, 4);
    assert.equal(again.result.degraded, undefined);
    assert.deepEqual(again.result.tech.bullets, ["Fresh"]);
  });

  it("LLM closing that does not return within 2.5 s keeps the default closing", async () => {
    __configureGdeltForTests({ llmClosingMs: 30 });
    globalThis.fetch = async () => okResponse(["Story"]);
    const ctx = {
      ...ctxA,
      llm: { chat: () => new Promise((r) => setTimeout(() => r({ text: "Too late" }), 300)) },
    };
    const r = await ACTIONS.get("news.daily-briefing")(ctx, { id: null, data: {}, meta: {} }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.closing, "That's the briefing. Read any story in full from the Headlines tab.");
  });
});
