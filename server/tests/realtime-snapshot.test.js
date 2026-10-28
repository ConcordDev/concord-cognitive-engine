// Phase 4 of the feed-cache project: realtime-feeds on the shared feed-cache, the REST
// snapshot (GET /api/realtime/feed/:feed), and one upstream fetch shared between
// realtime-feeds, feed-manager and the news RSS pool for the same URL.
//
// No test touches the network: all outbound HTTP goes through lib/shared-http.js, whose
// transport is injected with __setSharedHttpFetchImpl.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { _resetFeedCacheForTests, configureFeedCache, get, flushPersist, loadPersisted } from "../lib/feed-cache.js";
import {
  __setSharedHttpFetchImpl as setSharedTransport, getSharedText, getSharedTextOrThrow, isSharedUpstream, sharedUpstreamUrls,
  yahooChartUrl, COINGECKO_TOP10_URL, NPR_TOP_URL, BBC_WORLD_URL, WHO_DON_URL,
} from "../lib/shared-http.js";
import { setMarketTransportForTests, getMarketUpstream } from "../lib/market-feed-sources.js";

// RSS/JSON text URLs go through shared-http; the Yahoo chart + CoinGecko URLs go through the market cache
// (lib/market-feed-sources.js). One counting fake serves both so hit counts prove they share ONE fetch.
function __setSharedHttpFetchImpl(fn) {
  setSharedTransport(fn);
  setMarketTransportForTests(fn);
}
import {
  tickRealTimeFeeds, getRealtimeSnapshot, getRealtimeFeedStatus, getRealtimeFeedData,
  ensureRealtimeSource, resolveFeedKey, REALTIME_FEEDS, __enableRealtimeTickForTests, __resetRealtimeFeedsForTests,
} from "../emergent/realtime-feeds.js";
import { FINANCE_FEEDS, NEWS_FEEDS } from "../lib/feed-sources.js";
import { initFeedManager, registerFeed, forceTick } from "../lib/feed-manager.js";
import { forceActive } from "../lib/presence-idle.js";
import createUniversalExportRouter from "../routes/universal-export.js";

const ALL_COINS = ["bitcoin", "ethereum", "solana", "cardano", "polkadot", "ripple", "dogecoin", "chainlink", "avalanche-2", "polygon-ecosystem-token"];

function yahooBody(sym) {
  return JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 105, previousClose: 100, currency: "USD", exchangeName: `X${sym}` } }] } });
}
const NPR_XML = `<rss><channel><item><title>NPR headline one</title><link>https://www.npr.org/a</link><pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate><description>d</description></item></channel></rss>`;
const WHO_XML = `<rss><channel><item><title>Outbreak notice</title><link>https://www.who.int/n</link><pubDate>Tue, 27 Oct 2026 09:00:00 GMT</pubDate></item></channel></rss>`;

/** Counting fake upstream: url -> body (string) | "fail". Unknown URL -> 404. */
function makeUpstream(extra = {}) {
  const hits = new Map();
  const bodies = new Map();
  for (const s of ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX"]) bodies.set(yahooChartUrl(s), yahooBody(s));
  bodies.set(COINGECKO_TOP10_URL, JSON.stringify(Object.fromEntries(ALL_COINS.map((id, i) => [id, { usd: 100 + i, usd_24h_change: 1.234, usd_market_cap: 1e9 + i }]))));
  bodies.set(NPR_TOP_URL, NPR_XML);
  bodies.set(WHO_DON_URL, WHO_XML);
  for (const [k, v] of Object.entries(extra)) bodies.set(k, v);
  const impl = async (url) => {
    hits.set(url, (hits.get(url) || 0) + 1);
    const b = bodies.get(url);
    if (b === undefined) return { ok: false, status: 404, headers: { get: () => null }, text: async () => "" };
    if (b === "fail") return { ok: false, status: 503, headers: { get: () => null }, text: async () => "" };
    return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => b };
  };
  return { impl, hits, bodies, total: () => [...hits.values()].reduce((a, b) => a + b, 0) };
}

let clock;
beforeEach(() => {
  _resetFeedCacheForTests();
  __resetRealtimeFeedsForTests();
  clock = { t: Date.now() }; // the REST snapshot ages entries against the wall clock
  configureFeedCache({ now: () => clock.t, sleep: async () => {}, logUpstream: null });
  __enableRealtimeTickForTests(true);
});
afterEach(() => {
  __setSharedHttpFetchImpl(null);
  __enableRealtimeTickForTests(false);
  _resetFeedCacheForTests();
});

function emitSpy() {
  const events = [];
  const fn = (name, payload) => events.push({ name, payload });
  fn.events = events;
  return fn;
}

describe("realtime snapshot: cold state is honest", () => {
  it("returns status unavailable with a reason and NO data when nothing is cached", () => {
    const s = getRealtimeSnapshot("finance");
    assert.equal(s.known, true);
    assert.equal(s.status, "unavailable");
    assert.equal(s.reason, "not_fetched_yet");
    assert.equal(s.data, null);
    assert.equal(s.lastOkAt, null);
    assert.equal(getRealtimeFeedData("finance"), null);
  });

  it("energy (note-only event, no data source) is always honestly unavailable", () => {
    const s = getRealtimeSnapshot("energy:update");
    assert.equal(s.status, "unavailable");
    assert.equal(s.reason, "requires_eia_api_key");
    assert.equal(s.data, null);
  });

  it("unknown feed names are not known", () => {
    assert.equal(getRealtimeSnapshot("chat").known, false);
    assert.equal(resolveFeedKey("__proto__"), null);
    assert.equal(resolveFeedKey("finance"), "finance:ticker");
    assert.equal(resolveFeedKey("legal"), "legal:update");
    assert.equal(resolveFeedKey("news:update"), "news:update");
  });
});

describe("realtime tick runs on feed-cache; socket payload shape is unchanged", () => {
  it("emits finance:ticker / crypto:ticker with the original payload shapes", async () => {
    const up = makeUpstream();
    __setSharedHttpFetchImpl(up.impl);
    const emit = emitSpy();
    await tickRealTimeFeeds({ settings: {} }, 5, emit, null, null);

    const fin = emit.events.find((e) => e.name === "finance:ticker").payload;
    assert.equal(fin.ok, true);
    assert.deepEqual(fin.quotes.map((q) => q.symbol), ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX"]);
    assert.deepEqual(Object.keys(fin.quotes[0]).sort(), ["change", "changePercent", "currency", "exchange", "previousClose", "price", "symbol"]);
    assert.equal(fin.quotes[0].changePercent, "5.00");
    assert.ok(["open", "closed"].includes(fin.marketStatus));
    assert.ok(Date.parse(fin.fetchedAt) > 0);

    const cry = emit.events.find((e) => e.name === "crypto:ticker").payload;
    assert.equal(cry.ok, true);
    // the shared upstream URL returns 10 coins; the socket payload still carries the original 5
    assert.deepEqual(cry.coins.map((c) => c.id), ["bitcoin", "ethereum", "solana", "cardano", "polkadot"]);
    assert.deepEqual(Object.keys(cry.coins[0]).sort(), ["change24h", "id", "marketCap", "price"]);
    assert.equal(cry.coins[0].change24h, "1.23");
  });

  it("a second tick inside the TTL re-emits the cached payload without any upstream fetch", async () => {
    const up = makeUpstream();
    __setSharedHttpFetchImpl(up.impl);
    const emit = emitSpy();
    await tickRealTimeFeeds({ settings: {} }, 5, emit, null, null);
    const before = up.total();
    assert.ok(before >= 6); // 5 yahoo symbols + 1 coingecko
    clock.t += 30_000;
    await tickRealTimeFeeds({ settings: {} }, 5, emit, null, null);
    assert.equal(up.total(), before, "TTL hit: no upstream call");
    const fins = emit.events.filter((e) => e.name === "finance:ticker");
    assert.equal(fins.length, 2);
    assert.equal(fins[0].payload.fetchedAt, fins[1].payload.fetchedAt, "same cached payload re-emitted");
  });

  it("bridges items to DTUs only on a real build, not on cache hits", async () => {
    __setSharedHttpFetchImpl(makeUpstream().impl);
    const bridged = [];
    const bridge = async (evt) => { bridged.push(evt); };
    await tickRealTimeFeeds({ settings: {} }, 5, emitSpy(), null, bridge);
    const first = bridged.length;
    assert.equal(bridged.filter((b) => b.type === "market:trade").length, 5);
    assert.equal(bridged.filter((b) => b.type === "market:crypto").length, 5);
    clock.t += 10_000;
    await tickRealTimeFeeds({ settings: {} }, 5, emitSpy(), null, bridge);
    assert.equal(bridged.length, first, "cache hit does not re-bridge");
  });

  it("a failed upstream emits nothing, is not cached as data, and the snapshot says unavailable", async () => {
    const up = makeUpstream();
    for (const s of ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX"]) up.bodies.set(yahooChartUrl(s), "fail");
    __setSharedHttpFetchImpl(up.impl);
    const emit = emitSpy();
    await tickRealTimeFeeds({ settings: {} }, 5, emit, null, null);
    assert.equal(emit.events.some((e) => e.name === "finance:ticker"), false);
    assert.equal(emit.events.some((e) => e.name === "crypto:ticker"), true, "other feeds are unaffected");
    const s = getRealtimeSnapshot("finance");
    assert.equal(s.status, "unavailable");
    assert.match(s.reason, /upstream_error/);
    assert.equal(s.data, null);
  });
});

describe("realtime snapshot: cached data + metadata", () => {
  it("returns the SAME payload as the socket event, plus fetchedAt / stale / status", async () => {
    __setSharedHttpFetchImpl(makeUpstream().impl);
    const emit = emitSpy();
    await tickRealTimeFeeds({ settings: {} }, 5, emit, null, null);
    const emitted = emit.events.find((e) => e.name === "finance:ticker").payload;

    const s = getRealtimeSnapshot("finance");
    assert.equal(s.status, "fresh");
    assert.equal(s.stale, false);
    assert.equal(s.fetchedAt, new Date(clock.t).toISOString());
    assert.deepEqual(s.data, emitted, "REST data === socket payload");
    assert.deepEqual(getRealtimeFeedData("finance:ticker"), emitted);
  });

  it("flags stale after two missed cadences, and goes unavailable past the feed's max age (with lastOkAt)", async () => {
    __setSharedHttpFetchImpl(makeUpstream().impl);
    await tickRealTimeFeeds({ settings: {} }, 5, emitSpy(), null, null);
    const cfg = REALTIME_FEEDS["finance:ticker"];
    const okAt = new Date(clock.t).toISOString();

    const staleAt = clock.t + 2 * cfg.everyTicks * 15_000 + 1000;
    const st = getRealtimeSnapshot("finance", staleAt);
    assert.equal(st.status, "stale");
    assert.equal(st.stale, true);
    assert.ok(st.data, "stale data is still served, flagged");

    const old = getRealtimeSnapshot("finance", clock.t + cfg.maxAgeMs + 1000);
    assert.equal(old.status, "unavailable");
    assert.equal(old.reason, "too_old");
    assert.equal(old.lastOkAt, okAt);
    assert.equal(old.data, null);
  });

  it("status lists per-feed snapshot state and feed-cache stats", async () => {
    __setSharedHttpFetchImpl(makeUpstream().impl);
    await tickRealTimeFeeds({ settings: {} }, 5, emitSpy(), null, null);
    const st = getRealtimeFeedStatus();
    assert.equal(st.snapshots["finance:ticker"].status, "fresh");
    assert.equal(st.snapshots["news:update"].status, "unavailable");
    assert.equal(st.snapshots["energy:update"].reason, "requires_eia_api_key");
    assert.ok(st.cacheSize >= 2);
    assert.ok(st.feedCache.realtime && st.feedCache.market.coingecko && st.feedCache.market.yahooChart);
    assert.ok(Array.isArray(st.feeds));
  });

  it("survives a restart: persisted snapshot answers before the first tick", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-snap-"));
    try {
      configureFeedCache({ dir, persistDebounceMs: 10_000 });
      __setSharedHttpFetchImpl(makeUpstream().impl);
      await tickRealTimeFeeds({ settings: {} }, 5, emitSpy(), null, null);
      assert.equal(await flushPersist(), true);

      // simulate a fresh process: wipe the in-memory cache, keep the file
      const now = clock.t;
      _resetFeedCacheForTests();
      configureFeedCache({ now: () => now + 20_000, dir, logUpstream: null });
      ensureRealtimeSource();
      loadPersisted();
      const s = getRealtimeSnapshot("crypto", now + 20_000);
      assert.equal(s.status, "fresh");
      assert.equal(s.data.coins.length, 5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("GET /api/realtime/feed/:feed + /api/realtime/status", () => {
  async function withServer(fn) {
    const app = express();
    app.use(createUniversalExportRouter({ dtus: new Map() }, async () => ({ ok: true }), () => ({})));
    const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
  }

  it("cold: 200 with the honest unavailable shape; unknown feed: 404", async () => {
    await withServer(async (base) => {
      const cold = await (await fetch(`${base}/api/realtime/feed/finance`)).json();
      assert.equal(cold.ok, true);
      assert.equal(cold.status, "unavailable");
      assert.equal(cold.reason, "not_fetched_yet");
      assert.equal(cold.data, null);
      assert.equal("known" in cold, false);
      const unk = await fetch(`${base}/api/realtime/feed/not-a-feed`);
      assert.equal(unk.status, 404);
      assert.equal((await unk.json()).reason, "unknown_feed");
    });
  });

  it("warm: returns the cached payload with fetchedAt / stale / status, and /status lists snapshots", async () => {
    __setSharedHttpFetchImpl(makeUpstream().impl);
    const emit = emitSpy();
    await tickRealTimeFeeds({ settings: {} }, 5, emit, null, null);
    const emitted = emit.events.find((e) => e.name === "crypto:ticker").payload;
    await withServer(async (base) => {
      const j = await (await fetch(`${base}/api/realtime/feed/crypto:ticker`)).json();
      assert.equal(j.ok, true);
      assert.equal(j.status, "fresh");
      assert.equal(j.stale, false);
      assert.equal(j.fetchedAt, new Date(clock.t).toISOString());
      assert.deepEqual(j.data, emitted);
      const st = await (await fetch(`${base}/api/realtime/status`)).json();
      assert.equal(st.ok, true);
      assert.equal(st.snapshots["crypto:ticker"].status, "fresh");
    });
  });
});

describe("one upstream fetch shared across realtime-feeds, feed-manager and the news pool", () => {
  it("every shared-upstream URL feed-manager lists is read through the shared cache", () => {
    const fmUrls = [...FINANCE_FEEDS, ...NEWS_FEEDS].map((f) => f.url);
    const shared = fmUrls.filter(isSharedUpstream);
    for (const u of [yahooChartUrl("^GSPC"), yahooChartUrl("^IXIC"), yahooChartUrl("^DJI"), COINGECKO_TOP10_URL, NPR_TOP_URL, BBC_WORLD_URL]) {
      assert.ok(fmUrls.includes(u), `feed-sources.js lists ${u}`);
      assert.ok(shared.includes(u), `${u} is a shared upstream`);
    }
    assert.ok(sharedUpstreamUrls().includes(WHO_DON_URL));
  });

  it("realtime tick + feed-manager tick + shared read of the same URL cost ONE upstream fetch", async () => {
    const up = makeUpstream();
    __setSharedHttpFetchImpl(up.impl);
    process.env.CONCORD_FEED_ROBOTS_CHECK = "0";
    forceActive();
    const dtus = new Map();
    initFeedManager({ STATE: { dtus }, db: null, io: null, logger: console });

    // 1) realtime-feeds builds finance (^GSPC among them) and crypto
    await tickRealTimeFeeds({ settings: {} }, 5, emitSpy(), null, null);
    assert.equal(up.hits.get(yahooChartUrl("^GSPC")), 1);
    assert.equal(up.hits.get(COINGECKO_TOP10_URL), 1);

    // 2) feed-manager polls the SAME Yahoo + CoinGecko URLs (its own feed definitions) seconds later
    clock.t += 20_000;
    const yahoo = FINANCE_FEEDS.find((f) => f.url === yahooChartUrl("^GSPC"));
    const gecko = FINANCE_FEEDS.find((f) => f.url === COINGECKO_TOP10_URL);
    assert.ok(yahoo && gecko);
    registerFeed({ ...yahoo, id: "t_rt_yahoo", enabled: false });
    registerFeed({ ...gecko, id: "t_rt_gecko", enabled: false });
    await forceTick("t_rt_yahoo");
    await forceTick("t_rt_gecko");
    assert.equal(up.hits.get(yahooChartUrl("^GSPC")), 1, "feed-manager read the realtime-warmed entry");
    assert.equal(up.hits.get(COINGECKO_TOP10_URL), 1, "feed-manager read the realtime-warmed entry");

    // 3) the same URL through the market reader again: still one
    const r = await getMarketUpstream(yahooChartUrl("^GSPC"));
    assert.equal(r.ok, true);
    assert.equal(r.stale, false);
    assert.equal(up.hits.get(yahooChartUrl("^GSPC")), 1);
  });

  it("concurrent readers of one URL coalesce into a single upstream request", async () => {
    const up = makeUpstream();
    __setSharedHttpFetchImpl(up.impl);
    const rs = await Promise.all([
      getSharedTextOrThrow(NPR_TOP_URL, { ttlMs: 60_000 }),
      getSharedTextOrThrow(NPR_TOP_URL, { ttlMs: 60_000 }),
      getSharedText(NPR_TOP_URL, { ttlMs: 60_000 }),
    ]);
    assert.equal(up.hits.get(NPR_TOP_URL), 1);
    assert.ok(rs.every((r) => (r.text || r.status) !== undefined));
  });

  it("a failing shared URL backs off per key and never caches the failure as data", async () => {
    const up = makeUpstream({ [WHO_DON_URL]: "fail" });
    __setSharedHttpFetchImpl(up.impl);
    const a = await getSharedText(WHO_DON_URL, { ttlMs: 60_000 });
    assert.equal(a.status, "unavailable");
    const b = await getSharedText(WHO_DON_URL, { ttlMs: 60_000 });
    assert.equal(b.status, "unavailable");
    assert.equal(b.reason, "key_backoff");
    assert.equal(up.hits.get(WHO_DON_URL), 1, "second read did not hit the dead host");
    // other URLs are unaffected (no source-wide breaker)
    assert.equal((await getSharedText(NPR_TOP_URL, { ttlMs: 60_000 })).status, "fresh");
    // after the back-off window the host is retried
    up.bodies.set(WHO_DON_URL, WHO_XML);
    clock.t += 61_000;
    assert.equal((await getSharedText(WHO_DON_URL, { ttlMs: 60_000 })).status, "fresh");
  });

  it("realtime news builds from the same NPR upstream the news pool and feed-manager use", async () => {
    const up = makeUpstream({ [BBC_WORLD_URL]: NPR_XML, "https://feeds.bbci.co.uk/news/rss.xml": NPR_XML });
    __setSharedHttpFetchImpl(up.impl);
    const emit = emitSpy();
    await tickRealTimeFeeds({ settings: {} }, 10, emit, null, null);
    const news = emit.events.find((e) => e.name === "news:update").payload;
    assert.equal(news.ok, true);
    assert.ok(news.articles.length >= 1);
    assert.deepEqual(Object.keys(news.articles[0]).sort(), ["contentPolicy", "imageUrl", "link", "pubDate", "source", "summary", "title"]);
    const before = up.hits.get(NPR_TOP_URL);
    // the news pool's reader (production path) hits the same cache entry
    await getSharedTextOrThrow(NPR_TOP_URL, { ttlMs: 5 * 60_000 });
    assert.equal(up.hits.get(NPR_TOP_URL), before);
  });
});
