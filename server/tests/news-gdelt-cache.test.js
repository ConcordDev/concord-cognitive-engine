// GDELT headlines/daily-briefing/grounding on the shared feed-cache "gdelt"
// source: per-key cache, single-queue spacing, request timeout, 429/5xx
// back-off with degraded-but-ok answers, the ONE shared request budget, and
// the staggered heartbeat warm. No test touches the network: the SSRF-guarded
// transport is replaced with the module test transport, which delegates to
// whatever globalThis.fetch the test installs.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerNewsActions, {
  __resetGdeltCacheForTests,
  __configureGdeltForTests,
} from "../domains/news.js";
import registerGroundingActions from "../domains/grounding.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { configureFeedCache, warmTick, stats } from "../lib/feed-cache.js";
import { ensureGdeltSource, NEWS_CATEGORIES } from "../lib/gdelt-source.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
const ctxA = { actor: { userId: "u" }, userId: "u" };
function call(name, params = {}) {
  return ACTIONS.get(`news.${name}`)(ctxA, { id: null, data: {}, meta: {} }, params);
}
function callGrounding(name, params = {}) {
  return ACTIONS.get(`grounding.${name}`)(ctxA, { id: null, data: {}, meta: {} }, params);
}

const realFetch = globalThis.fetch;
const article = (title) => ({ title, url: `https://example.com/${encodeURIComponent(title)}`, domain: "example.com" });
const okResponse = (titles) => ({ ok: true, status: 200, json: async () => ({ articles: titles.map(article) }) });
const errResponse = (status) => ({ ok: false, status, json: async () => ({}) });
const flush = (ms = 15) => new Promise((r) => setTimeout(r, ms));

before(() => {
  registerNewsActions(register);
  registerGroundingActions(register);
  __setPublicFetchTestTransport((url, init) => globalThis.fetch(url, init));
});
beforeEach(() => {
  __resetGdeltCacheForTests();
  configureFeedCache({ logUpstream: () => {}, log: () => {} });
  // The shared 100 s budget has its own tests below; the rest exercise cache/queue/back-off.
  __configureGdeltForTests({ spacingMs: 0, everyMs: 0 });
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

  it("past the 15 minute TTL the stale copy is served at once and refreshed once in the background", async () => {
    let now = 1_000_000;
    __configureGdeltForTests({ now: () => now });
    let calls = 0;
    globalThis.fetch = async () => { calls++; return okResponse([`X${calls}`]); };
    await call("headlines", { category: "business" });
    now += 14 * 60 * 1000;
    const fresh = await call("headlines", { category: "business" });
    assert.equal(calls, 1);
    assert.equal(fresh.result.stale, false);
    now += 2 * 60 * 1000;
    const stale = await call("headlines", { category: "business" });
    assert.equal(stale.result.stale, true, "served stale, never blocked on the network");
    assert.equal(stale.result.status, "stale");
    assert.equal(stale.result.headlines[0].title, "X1");
    await flush();
    assert.equal(calls, 2);
    const after = await call("headlines", { category: "business" });
    assert.equal(after.result.headlines[0].title, "X2");
    assert.equal(after.result.stale, false);
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
  it("429 with cached data: ok:true, stale + degraded, and no fetch during back-off", async () => {
    let now = 5_000_000;
    __configureGdeltForTests({ now: () => now });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return calls === 1 ? okResponse(["Cached one", "Cached two"]) : errResponse(429);
    };
    await call("headlines", { category: "world" });

    now += 16 * 60 * 1000; // cache is now stale: this call serves it and refreshes behind the scenes
    const first = await call("headlines", { category: "world" });
    assert.equal(first.ok, true);
    assert.equal(first.result.stale, true);
    await flush();
    assert.equal(calls, 2);

    now += 30 * 1000; // inside the 60 s back-off window
    const during = await call("headlines", { category: "world" });
    assert.equal(calls, 2, "no GDELT call while backing off");
    assert.equal(during.ok, true);
    assert.equal(during.result.degraded, true);
    assert.equal(during.result.degradedReason, "rate_limited");
    assert.equal(during.result.stale, true);
    assert.ok(during.result.cachedAt);
    assert.ok(during.result.fetchedAt);
    assert.deepEqual(during.result.headlines.map((h) => h.title), ["Cached one", "Cached two"]);
  });

  it("back-off doubles on repeated failures and resets on success", async () => {
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

  it("no cache and a failure: honest unavailable with reason + lastOkAt, no invented headlines", async () => {
    globalThis.fetch = async () => errResponse(503);
    const r = await call("headlines", { category: "entertainment" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.headlines, []);
    assert.equal(r.result.count, 0);
    assert.equal(r.result.status, "unavailable");
    assert.equal(r.result.stale, false);
    assert.equal(r.result.fetchedAt, null);
    assert.equal(r.result.lastOkAt, null);
    assert.equal(r.result.degraded, true);
    assert.equal(r.result.degradedReason, "upstream_error: GDELT 503");
    assert.equal(r.result.reason, "upstream_error: GDELT 503");
    assert.equal(r.result.cachedAt, undefined);
  });

  it("a hanging fetch is aborted by the timeout and reported as degraded", async () => {
    __configureGdeltForTests({ timeoutMs: 40 });
    let signal = null;
    globalThis.fetch = (_url, opts) => {
      signal = opts.signal;
      return new Promise(() => {}); // never settles
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
    assert.equal(r.result.degradedReason, "warming");
    assert.deepEqual(r.result.topStories.bullets, []);
    assert.equal(r.result.topStories.unavailableReason, "warming");
    assert.equal(r.result.status, "unavailable");
    // Let the queued background fetches finish so they do not leak into the next test.
    await flush(400);
  });

  it("daily-briefing uses cached sections without waiting when they are fresh", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return okResponse(["Fresh"]); };
    await call("daily-briefing"); // fills all four categories
    const again = await call("daily-briefing");
    assert.equal(calls, 4);
    assert.equal(again.result.degraded, undefined);
    assert.deepEqual(again.result.tech.bullets, ["Fresh"]);
    assert.equal(again.result.status, "fresh");
    assert.equal(again.result.stale, false);
    assert.ok(again.result.fetchedAt);
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

describe("GDELT back-off with a queue", () => {
  it("requests queued behind a 429 do not hit GDELT and do not stretch the back-off", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return errResponse(429); };
    const results = await Promise.all(
      ["tech", "science", "business"].map((category) => call("headlines", { category })),
    );
    assert.equal(calls, 1);
    assert.ok(results.every((r) => r.ok === true && r.result.degraded === true && r.result.degradedReason === "rate_limited"));
    // One 429 -> one 60 s window, not 60 -> 120 -> 240.
    globalThis.fetch = async () => { calls++; return okResponse(["back"]); };
    const during = await call("headlines", { category: "tech" });
    assert.equal(calls, 1);
    assert.equal(during.result.degraded, true);
  });
});

describe("daily-briefing total deadline", () => {
  it("slow GDELT and a slow LLM still return inside the total deadline", async () => {
    __configureGdeltForTests({ briefingBudgetMs: 60, briefingTotalMs: 200, llmClosingMs: 1000, llmMinMs: 20, timeoutMs: 2000 });
    // The first GDELT section answers in time so there is something to summarise;
    // the rest are slow and miss the 60 ms section budget.
    let fetches = 0;
    globalThis.fetch = async () => {
      const delay = ++fetches === 1 ? 10 : 80;
      await new Promise((r) => setTimeout(r, delay));
      return okResponse(["Story"]);
    };
    let llmCalls = 0;
    const ctx = {
      ...ctxA,
      llm: { chat: () => { llmCalls++; return new Promise((r) => setTimeout(() => r({ text: "Too late" }), 1000)); } },
    };
    const started = Date.now();
    const r = await ACTIONS.get("news.daily-briefing")(ctx, { id: null, data: {}, meta: {} }, {});
    const elapsed = Date.now() - started;
    assert.equal(r.ok, true);
    // Uncapped, this would take the 60 ms GDELT budget plus the full 1000 ms LLM cap.
    assert.ok(elapsed < 500, `briefing took ${elapsed} ms`);
    assert.equal(llmCalls, 1, "the LLM was attempted with the time that was left");
    assert.equal(r.result.closing, "That's the briefing. Read any story in full from the Headlines tab.");
    // Let the queued background fetches finish so they do not leak into the next test.
    await flush(400);
  });

  it("makes no LLM call when every section is empty", async () => {
    globalThis.fetch = async () => okResponse([]);
    let llmCalls = 0;
    const ctx = { ...ctxA, llm: { chat: async () => { llmCalls++; return { text: "Should not run" }; } } };
    const r = await ACTIONS.get("news.daily-briefing")(ctx, { id: null, data: {}, meta: {} }, {});
    assert.equal(r.ok, true);
    assert.equal(llmCalls, 0);
    assert.equal(r.result.closing, "That's the briefing. Read any story in full from the Headlines tab.");
  });

  it("during GDELT back-off with no cached copy, returns at once with no new fetch", async () => {
    let calls = 0;
    __configureGdeltForTests({ now: () => 7_000_000 }); // frozen clock keeps the 60 s window open
    globalThis.fetch = async () => { calls++; return errResponse(429); };
    await call("headlines", { category: "world" }); // sets the back-off window
    assert.equal(calls, 1);
    const started = Date.now();
    const r = await call("daily-briefing");
    const elapsed = Date.now() - started;
    assert.equal(calls, 1, "no GDELT request while backing off");
    assert.ok(elapsed < 1000, `briefing took ${elapsed} ms during back-off`);
    assert.equal(r.ok, true);
    assert.equal(r.result.degraded, true);
    assert.equal(r.result.degradedReason, "rate_limited");
    assert.deepEqual(r.result.topStories.bullets, []);
    assert.equal(r.result.topStories.unavailableReason, "rate_limited");
  });
});

describe("headlines metadata", () => {
  it("fresh: fetchedAt (ISO), stale:false, status:fresh, existing fields kept", async () => {
    globalThis.fetch = async () => okResponse(["One"]);
    const r = await call("headlines", { category: "tech" });
    assert.equal(r.result.status, "fresh");
    assert.equal(r.result.stale, false);
    assert.equal(new Date(r.result.fetchedAt).toISOString(), r.result.fetchedAt);
    assert.equal(r.result.headlines.length, 1);
    assert.match(r.result.source, /GDELT/);
    assert.equal(r.result.degraded, undefined);
  });

  it("a headline without a parseable GDELT date has publishedAt:null, never an invented timestamp", async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ articles: [{ title: "No date", url: "https://example.com/n", domain: "example.com" }] }) });
    const r = await call("headlines", { category: "tech" });
    assert.equal(r.result.headlines[0].publishedAt, null);
  });
});

describe("shared GDELT budget (1 upstream request / ~100 s across every caller)", () => {
  it("headlines, daily-briefing and discoverCoverage share one token; a second call inside 100 s never hits upstream", async () => {
    let now = 20_000_000;
    __configureGdeltForTests({ now: () => now, everyMs: 100_000 });
    let calls = 0;
    globalThis.fetch = async () => { calls++; return okResponse(["Budgeted"]); };

    const first = await call("headlines", { category: "tech" });
    assert.equal(first.result.status, "fresh");
    assert.equal(calls, 1);

    // Different key, inside the window: honest unavailable, no upstream.
    now += 10_000;
    const other = await call("headlines", { category: "world" });
    assert.equal(calls, 1);
    assert.equal(other.result.status, "unavailable");
    assert.equal(other.result.degradedReason, "budget_exhausted");
    assert.deepEqual(other.result.headlines, []);

    // grounding.discoverCoverage draws on the SAME bucket.
    const cov = await callGrounding("discoverCoverage", { claim: "solar panel installations rose sharply" });
    assert.equal(calls, 1);
    assert.equal(cov.ok, false);
    assert.equal(cov.reason, "gdelt_unreachable");
    assert.equal(cov.detail, "budget_exhausted");

    // daily-briefing sections also see no upstream.
    const brief = await call("daily-briefing");
    assert.equal(calls, 1);
    assert.equal(brief.result.topStories.status, "unavailable"); // world: no token
    assert.equal(brief.result.topStories.unavailableReason, "budget_exhausted");
    assert.deepEqual(brief.result.tech.bullets, ["Budgeted"]); // tech: cached copy still served
    assert.equal(brief.result.status, "stale"); // partially unavailable

    // The cached key is still served from cache.
    const again = await call("headlines", { category: "tech" });
    assert.equal(again.result.headlines[0].title, "Budgeted");
    assert.equal(calls, 1);

    // After ~100 s a token is back and exactly one more request is allowed.
    now += 100_000;
    const cov2 = await callGrounding("discoverCoverage", { claim: "solar panel installations rose sharply" });
    assert.equal(cov2.ok, true);
    assert.equal(calls, 2);
    const blocked = await call("headlines", { category: "world" });
    assert.equal(blocked.result.status, "unavailable");
    assert.equal(calls, 2);
  });

  it("a stale entry is served (not refetched) when the budget is empty", async () => {
    let now = 30_000_000;
    __configureGdeltForTests({ now: () => now, everyMs: 100_000, ttlMs: 30_000 });
    let calls = 0;
    globalThis.fetch = async () => { calls++; return okResponse(["Old"]); };
    await call("headlines", { category: "science" });
    now += 40_000; // past the (shortened) TTL, budget still empty
    const r = await call("headlines", { category: "science" });
    await flush();
    assert.equal(calls, 1);
    assert.equal(r.result.stale, true);
    assert.equal(r.result.status, "stale");
    assert.equal(r.result.headlines[0].title, "Old");
  });

  it("discoverCoverage keeps its failure contract and never fabricates articles", async () => {
    globalThis.fetch = async () => errResponse(503);
    const r = await callGrounding("discoverCoverage", { claim: "some claim about energy" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "gdelt_unreachable");
    assert.equal(r.result, undefined);
  });
});

describe("heartbeat warm (feed-cache warmTick)", () => {
  const open = () => true;

  it("does one GDELT fetch per call and always moves the stalest category", async () => {
    let now = 40_000_000;
    __configureGdeltForTests({ now: () => now });
    ensureGdeltSource();
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(u); return okResponse(["W"]); };

    const seen = [];
    for (let i = 0; i < NEWS_CATEGORIES.length; i++) {
      const w = await warmTick(i * 5, { shouldRun: open });
      assert.equal(w.ran, true);
      assert.equal(w.refreshed.length, 1, "at most one GDELT warm fetch per call");
      seen.push(w.refreshed[0].key);
      assert.equal(urls.length, i + 1);
      now += 1000;
    }
    assert.deepEqual(seen, NEWS_CATEGORIES, "never-fetched categories first, one per call");

    // Everything is fresh now: nothing to do, no upstream.
    const idle = await warmTick(100, { shouldRun: open });
    assert.deepEqual(idle.refreshed, []);
    assert.equal(urls.length, 9);

    // Past the TTL all are due: the stalest ("top", fetched first) goes first.
    now += 16 * 60 * 1000;
    const w2 = await warmTick(105, { shouldRun: open });
    assert.equal(w2.refreshed.length, 1);
    assert.equal(w2.refreshed[0].key, "top");
    assert.equal(urls.length, 10);
    const w3 = await warmTick(110, { shouldRun: open });
    assert.equal(w3.refreshed[0].key, "world");
  });

  it("is skipped entirely when the idle/load gate says no", async () => {
    ensureGdeltSource();
    let calls = 0;
    globalThis.fetch = async () => { calls++; return okResponse(["W"]); };
    const w = await warmTick(0, { shouldRun: () => false });
    assert.equal(w.ran, false);
    assert.equal(w.reason, "gated");
    assert.equal(calls, 0);
  });

  it("warm fetches draw from the same 100 s budget", async () => {
    let now = 50_000_000;
    __configureGdeltForTests({ now: () => now, everyMs: 100_000 });
    ensureGdeltSource();
    let calls = 0;
    globalThis.fetch = async () => { calls++; return okResponse(["W"]); };
    await warmTick(0, { shouldRun: open });
    assert.equal(calls, 1);
    now += 75_000; // next REALTIME_DATA call: 0.75 of a token
    const w = await warmTick(5, { shouldRun: open });
    assert.equal(calls, 1, "no token, no upstream");
    assert.equal(w.refreshed[0].status, "unavailable");
    assert.equal(w.refreshed[0].reason, "budget_exhausted");
    now += 75_000;
    await warmTick(10, { shouldRun: open });
    assert.equal(calls, 2);
  });

  it("logs one structured line per real upstream fetch (warm, miss) and none for cache hits", async () => {
    const lines = [];
    configureFeedCache({ logUpstream: (l) => lines.push(l) });
    __configureGdeltForTests({});
    ensureGdeltSource();
    globalThis.fetch = async () => okResponse(["L"]);
    await warmTick(0, { shouldRun: open });
    await call("headlines", { category: "top" });   // warmed key: a hit
    await call("headlines", { category: "sports" }); // cold key: a miss
    await call("headlines", { category: "sports" }); // hit
    assert.deepEqual(lines, [
      "[feed-cache] upstream source=gdelt key=top reason=warm",
      "[feed-cache] upstream source=gdelt key=sports reason=miss",
    ]);
    assert.ok(lines.every((l) => !l.includes("http")), "no URLs in the log line");
    assert.equal(stats().gdelt.misses, 2);
  });
});
