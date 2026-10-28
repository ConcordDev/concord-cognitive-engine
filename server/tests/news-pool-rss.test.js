// Phase 3 of the feed-cache project: rotating news pool, vetted RSS sources, the
// license gate / outlet policy (full vs summary-only vs excluded), Concord-written
// summaries, the GDELT 20 s timeout + 8 s user wait ("warming"), and the warm gate.
//
// No test touches the network: RSS goes through __setNewsSourcesTestHooks({fetchImpl}),
// GDELT through the public-fetch test transport, the LLM is an injected function.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerNewsActions, {
  __resetGdeltCacheForTests, __configureGdeltForTests,
} from "../domains/news.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { configureFeedCache, warmTick, registerSource, get } from "../lib/feed-cache.js";
import { GDELT_TIMEOUT_MS } from "../lib/gdelt-source.js";
import {
  NEWS_FEED_REGISTRY, enabledNewsFeeds, isFeedEnabled, feedTier, feedsForCategory,
  __setNewsSourcesTestHooks, __configureNewsSourcesForTests, peekNewsFeed, parseNewsFeed,
} from "../lib/news-sources.js";
import {
  hostTier, isExcludedHost, applyOutletPolicy, validateConcordSummary, shortSnippet,
  countRestrictedFullTextDtus, FULL_HOSTS, SNIPPET_MAX,
} from "../lib/news-outlet-policy.js";
import {
  runSummaryBatch, __resetSummarizerForTests, summaryQueueSize, summaryFor, SUMMARY_BUDGET,
} from "../lib/news-summarizer.js";
import { parseRSS, isRestrictedFeedItem, initFeedManager, registerFeed, forceTick } from "../lib/feed-manager.js";
import { checkQualityGate } from "../lib/ingest-quality.js";
import { forceActive } from "../lib/presence-idle.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
const ctxA = { actor: { userId: "u" }, userId: "u" };
function call(name, params = {}) {
  return ACTIONS.get(`news.${name}`)(ctxA, { id: null, data: {}, meta: {} }, params);
}

const DESC_SENTINEL = "SENTINEL-OUTLET-BODY-TEXT";
const realFetch = globalThis.fetch;
const noSleep = async () => {};

function xmlFor(url, n = 3, { descBase } = {}) {
  const host = new URL(url).hostname.replace(/\./g, "_");
  const path = new URL(url).pathname.replace(/\W+/g, "_");
  const items = [];
  for (let i = 0; i < n; i++) {
    const day = String(20 - i).padStart(2, "0");
    items.push(`<item><title>Headline ${host}${path} number ${i}</title><link>https://${new URL(url).hostname}/story/${path}/${i}</link>`
      + `<pubDate>Tue, ${day} Oct 2026 10:00:00 GMT</pubDate>`
      + `<description><![CDATA[<p>${descBase || `${DESC_SENTINEL} ${host} ${i} quick brown fox jumps over the lazy dog while the weather stays calm`}</p>]]></description></item>`);
  }
  return `<?xml version="1.0"?><rss><channel><title>t</title>${items.join("")}</channel></rss>`;
}

/** fetchImpl for RSS: records every URL, serves a feed per URL (or an override). */
function makeRssFetch(overrides = {}) {
  const urls = [];
  const impl = async (url) => {
    urls.push(String(url));
    const o = overrides[url] ?? overrides["*"];
    if (typeof o === "function") return o(url);
    if (o === "fail") return { ok: false, status: 503, text: async () => "", json: async () => ({}) };
    if (typeof o === "string") return { ok: true, status: 200, text: async () => o, json: async () => JSON.parse(o) };
    if (/hacker-news\.firebaseio\.com\/v0\/topstories/.test(url)) {
      return { ok: true, status: 200, json: async () => [101, 102], text: async () => "[]" };
    }
    const m = /hacker-news\.firebaseio\.com\/v0\/item\/(\d+)\.json/.exec(url);
    if (m) {
      return { ok: true, status: 200, json: async () => ({ id: Number(m[1]), type: "story", title: `HN story ${m[1]}`, url: `https://example.org/hn/${m[1]}`, time: Math.floor(Date.parse("2026-10-25T00:00:00Z") / 1000) }), text: async () => "{}" };
    }
    return { ok: true, status: 200, text: async () => xmlFor(url, 12), json: async () => ({}) };
  };
  return { impl, urls };
}

const gdeltArticle = (title, url, seendate, domain = "example.com") => ({ title, url, domain, seendate });
const gdeltOk = (arts) => ({ ok: true, status: 200, json: async () => ({ articles: arts }) });

async function warmAll(times = 12) {
  for (let i = 0; i < times; i++) await warmTick(i, { shouldRun: () => true });
}

before(() => {
  registerNewsActions(register);
  __setPublicFetchTestTransport((url, init) => globalThis.fetch(url, init));
});
beforeEach(() => {
  __resetGdeltCacheForTests();
  __resetSummarizerForTests();
  configureFeedCache({ logUpstream: () => {}, log: () => {}, sleep: noSleep });
  __configureGdeltForTests({ spacingMs: 0, everyMs: 0 });
  __setNewsSourcesTestHooks({ robots: async () => true });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  __setNewsSourcesTestHooks({});
  __resetGdeltCacheForTests();
  __resetSummarizerForTests();
});

// ── outlet policy ───────────────────────────────────────────────────────────

describe("outlet policy tiers", () => {
  it("full-display outlets", () => {
    for (const u of [
      "https://www.sciencedaily.com/rss/top/science.xml", "https://www.nasa.gov/feed/",
      "https://hacker-news.firebaseio.com/v0/topstories.json", "https://www.fda.gov/x.xml",
      "https://science.nasa.gov/a", "https://www.federalregister.gov/documents/current.rss",
    ]) assert.equal(hostTier(u), "full", u);
    assert.ok(FULL_HOSTS.includes("sciencedaily.com"));
  });

  it("unknown / unlisted hosts default to restricted (summary-only)", () => {
    for (const u of [
      "https://feeds.bbci.co.uk/news/rss.xml", "https://www.theguardian.com/world/rss",
      "https://feeds.npr.org/1001/rss.xml", "https://totally-unknown-blog.example/feed", "", "not a url",
    ]) assert.equal(hostTier(u), "restricted", u);
  });

  it("a look-alike host does not inherit full-display status", () => {
    assert.equal(hostTier("https://sciencedaily.com.evil.example/rss"), "restricted");
    assert.equal(hostTier("https://notnasa.gov.example/x"), "restricted");
  });

  it("excluded outlets and dead relays", () => {
    for (const u of [
      "https://www.aljazeera.com/xml/rss/all.xml", "https://www.france24.com/en/rss",
      "https://www.abc.net.au/news/feed/51120/rss.xml", "https://feeds.reuters.com/reuters/topNews",
      "https://rsshub.app/apnews/topics/apf-topnews",
    ]) {
      assert.equal(hostTier(u), "excluded", u);
      assert.equal(isExcludedHost(u), true);
    }
  });

  it("applyOutletPolicy: restricted items drop the description entirely", () => {
    const r = applyOutletPolicy({ title: "H", url: "https://feeds.bbci.co.uk/a", publishedAt: "2026-10-20T00:00:00Z", source: "BBC News", description: DESC_SENTINEL });
    assert.equal(r.contentPolicy, "summary-only");
    assert.equal(r.summary, null);
    assert.equal(JSON.stringify(r).includes(DESC_SENTINEL), false);
    const f = applyOutletPolicy({ title: "H", url: "https://www.nasa.gov/a", source: "NASA", description: "Short NASA text." });
    assert.equal(f.contentPolicy, "full");
    assert.equal(f.snippet, "Short NASA text.");
  });

  it("shortSnippet is bounded and never reworded", () => {
    const long = "A fact. ".repeat(100);
    const s = shortSnippet(long);
    assert.ok(s.length <= SNIPPET_MAX);
    assert.ok(long.startsWith(s.replace(/…$/, "")));
  });
});

// ── registry / license gate ─────────────────────────────────────────────────

describe("license gate and registry", () => {
  it("Reuters and rsshub are gone everywhere in the registry; excluded outlets are not registered", () => {
    const blob = JSON.stringify(NEWS_FEED_REGISTRY).toLowerCase();
    for (const bad of ["reuters", "rsshub", "aljazeera", "france24", "abc.net.au"]) {
      assert.equal(blob.includes(bad), false, `registry must not mention ${bad}`);
    }
  });

  it("no excluded host is ever enabled, and every enabled feed has terms + attribution + license", () => {
    for (const f of enabledNewsFeeds()) {
      assert.notEqual(feedTier(f), "excluded", f.id);
      assert.ok(f.termsUrl?.startsWith("https://"), `${f.id} termsUrl`);
      assert.ok(f.attribution, `${f.id} attribution`);
      assert.ok(["public-domain", "open", "commercial-display-ok", "noncommercial-only"].includes(f.license), f.id);
    }
    assert.equal(isFeedEnabled({ id: "x", url: "https://www.aljazeera.com/rss", kind: "rss", categories: [], enabled: true }), false);
  });

  it("noncommercial-only feeds are summary-only (never full display); full tier only for cleared outlets", () => {
    for (const f of NEWS_FEED_REGISTRY) {
      if (f.license === "noncommercial-only") assert.equal(feedTier(f), "restricted", f.id);
      if (feedTier(f) === "full") assert.ok(["public-domain", "open", "commercial-display-ok"].includes(f.license), f.id);
    }
    const enabledIds = enabledNewsFeeds().map((f) => f.id);
    for (const id of ["sciencedaily-science", "nasa-news", "hacker-news", "bbc-top", "npr-top", "guardian-world", "arstechnica", "theverge", "techcrunch"]) {
      assert.ok(enabledIds.includes(id), `${id} enabled`);
    }
  });

  it("DW and CBC are registered but OFF", () => {
    const dw = NEWS_FEED_REGISTRY.find((f) => f.id === "dw-all");
    const cbc = NEWS_FEED_REGISTRY.find((f) => f.id === "cbc-top");
    assert.ok(dw && cbc);
    assert.equal(isFeedEnabled(dw), false);
    assert.equal(isFeedEnabled(cbc), false);
    assert.equal(enabledNewsFeeds().some((f) => /dw\.com|cbc\.ca/.test(f.url)), false);
  });

  it("the legacy feed lists no longer carry Reuters / rsshub", async () => {
    const { NEWS_FEEDS } = await import("../lib/feed-sources.js");
    assert.equal(JSON.stringify(NEWS_FEEDS).toLowerCase().includes("reuters"), false);
    assert.equal(JSON.stringify(NEWS_FEEDS).toLowerCase().includes("rsshub"), false);
    const { default: fs } = await import("node:fs");
    const rt = fs.readFileSync(new URL("../emergent/realtime-feeds.js", import.meta.url), "utf8");
    assert.equal(/feeds\.reuters\.com|rsshub\.app/.test(rt), false);
  });

  it("feed-manager refuses to register an excluded outlet", () => {
    initFeedManager({ STATE: { dtus: new Map() }, db: null, io: null, logger: console });
    const r = registerFeed({ id: "x_rsshub", url: "https://rsshub.app/apnews/topics/apf-topnews", type: "rss" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "excluded_outlet");
  });
});

// ── RSS warm + pool ─────────────────────────────────────────────────────────

describe("RSS sources on the warm tick", () => {
  it("warm tick fetches only enabled registry URLs (never excluded/disabled hosts, never article pages)", async () => {
    const rss = makeRssFetch();
    __setNewsSourcesTestHooks({ fetchImpl: rss.impl, robots: async () => true });
    __configureNewsSourcesForTests({ sleep: noSleep, perMin: 1000 });
    await warmAll(12);
    const allowed = new Set(enabledNewsFeeds().map((f) => f.url));
    assert.ok(rss.urls.length > 0);
    for (const u of rss.urls) {
      if (/hacker-news\.firebaseio\.com/.test(u)) continue;
      assert.ok(allowed.has(u), `unexpected fetch ${u}`);
      assert.notEqual(hostTier(u), "excluded");
    }
    assert.equal(rss.urls.some((u) => /example\.org\/hn|\/story\//.test(u)), false, "article pages are never fetched");
  });

  it("restricted feed items never persist the feed description; full items keep a bounded snippet", async () => {
    const rss = makeRssFetch();
    __setNewsSourcesTestHooks({ fetchImpl: rss.impl, robots: async () => true });
    __configureNewsSourcesForTests({ sleep: noSleep, perMin: 1000 });
    await warmAll(12);
    const bbc = peekNewsFeed("bbc-top");
    assert.ok(bbc, "bbc-top cached");
    assert.equal(JSON.stringify(bbc.data).includes(DESC_SENTINEL), false, "no outlet text in the cached/persisted record");
    for (const it of bbc.data) {
      assert.equal(it.contentPolicy, "summary-only");
      assert.equal("summary" in it, false);
      assert.equal("description" in it, false);
    }
    const sd = peekNewsFeed("sciencedaily-science");
    assert.equal(sd.data[0].contentPolicy, "full");
    assert.ok(sd.data[0].snippet.includes(DESC_SENTINEL));
    assert.ok(sd.data[0].snippet.length <= SNIPPET_MAX);
    assert.ok(summaryQueueSize() > 0, "restricted items queue for a Concord summary (in memory only)");
  });

  it("unparseable feed => honest failure, nothing cached, no fake items", async () => {
    const rss = makeRssFetch({ "*": "<html><body>Not a feed</body></html>" });
    __setNewsSourcesTestHooks({ fetchImpl: rss.impl, robots: async () => true });
    __configureNewsSourcesForTests({ sleep: noSleep, perMin: 1000 });
    await assert.rejects(() => parseNewsFeed("<html>nope</html>", NEWS_FEED_REGISTRY[0]), /no_items_parsed/);
    await warmAll(12);
    assert.equal(peekNewsFeed("bbc-top"), null);
    globalThis.fetch = async () => { throw new Error("offline"); };
    const r = await call("headlines", { category: "top" });
    assert.equal(r.result.status, "unavailable");
    assert.deepEqual(r.result.headlines, []);
    assert.ok(r.result.reason);
  });

  it("a feed that keeps failing backs off on its own and does not block the others", async () => {
    const rss = makeRssFetch({ "https://feeds.bbci.co.uk/news/rss.xml": "fail" });
    __setNewsSourcesTestHooks({ fetchImpl: rss.impl, robots: async () => true });
    __configureNewsSourcesForTests({ sleep: noSleep, perMin: 1000 });
    await warmAll(12);
    const bbcCalls = rss.urls.filter((u) => u === "https://feeds.bbci.co.uk/news/rss.xml").length;
    assert.equal(bbcCalls, 1, "failing feed is tried once, then sits out its own back-off window");
    assert.ok(peekNewsFeed("npr-top"), "other feeds still warmed");
  });

  it("robots.txt disallow => feed not fetched", async () => {
    const rss = makeRssFetch();
    __setNewsSourcesTestHooks({ fetchImpl: rss.impl, robots: async (u) => !/bbci\.co\.uk/.test(u) });
    __configureNewsSourcesForTests({ sleep: noSleep, perMin: 1000 });
    await warmAll(12);
    assert.equal(rss.urls.some((u) => /bbci\.co\.uk/.test(u)), false);
    assert.equal(peekNewsFeed("bbc-top"), null);
  });
});

describe("news.headlines pool, rotation, dedupe, source labels", () => {
  async function primed({ gdelt = [] } = {}) {
    const rss = makeRssFetch();
    __setNewsSourcesTestHooks({ fetchImpl: rss.impl, robots: async () => true });
    __configureNewsSourcesForTests({ sleep: noSleep, perMin: 1000 });
    let gdeltCalls = 0;
    globalThis.fetch = async () => { gdeltCalls++; return gdeltOk(gdelt); };
    await warmAll(12);
    return { rss, gdeltCalls: () => gdeltCalls };
  }

  it("per-article source labels: each item names its own outlet, not one global label", async () => {
    await primed({ gdelt: [gdeltArticle("A GDELT story about robots", "https://news.example.com/robots", "20261026T120000Z", "news.example.com")] });
    const r = await call("headlines", { category: "top", limit: 50 });
    const sources = new Set(r.result.headlines.map((h) => h.source));
    assert.ok(sources.has("BBC News"));
    assert.ok(sources.has("NPR"));
    assert.ok(sources.has("ScienceDaily"));
    assert.ok(sources.has("news.example.com"));
    assert.equal(sources.has("GDELT Project"), false);
    for (const h of r.result.headlines) {
      assert.ok(h.url.startsWith("http"));
      assert.ok(h.attribution);
      assert.ok(["full", "summary-only"].includes(h.contentPolicy));
    }
    assert.match(r.result.source, /GDELT/);
  });

  it("restricted items never carry outlet text in the response", async () => {
    await primed();
    const r = await call("headlines", { category: "top", limit: 50 });
    for (const h of r.result.headlines.filter((x) => x.contentPolicy === "summary-only")) {
      assert.equal(h.summary, null, "no summary yet => null, never the outlet text");
      assert.equal(h.snippet, null);
    }
    const bbcOnly = r.result.headlines.filter((h) => h.source === "BBC News");
    assert.ok(bbcOnly.length > 0);
    assert.equal(JSON.stringify(bbcOnly).includes(DESC_SENTINEL), false);
    const sd = r.result.headlines.find((h) => h.source === "ScienceDaily");
    assert.ok(sd.snippet.includes(DESC_SENTINEL));
  });

  it("successive cursors give different windows, wrap when exhausted, and cause NO upstream calls", async () => {
    const { rss, gdeltCalls } = await primed();
    const first = await call("headlines", { category: "top", limit: 5 });
    const ids1 = first.result.headlines.map((h) => h.id);
    assert.equal(ids1.length, 5);
    assert.ok(first.result.total > 5);
    assert.equal(typeof first.result.nextCursor, "number");
    const rssBefore = rss.urls.length;
    const gBefore = gdeltCalls();
    const second = await call("headlines", { category: "top", limit: 5, cursor: first.result.nextCursor });
    const ids2 = second.result.headlines.map((h) => h.id);
    assert.equal(ids2.length, 5);
    assert.equal(ids2.some((id) => ids1.includes(id)), false, "next window is different");
    // walk to the end: it wraps to 0
    let cur = second.result.nextCursor;
    let guard = 0;
    while (cur !== 0 && guard++ < 50) {
      const r = await call("headlines", { category: "top", limit: 5, cursor: cur });
      cur = r.result.nextCursor;
    }
    assert.equal(cur, 0, "wraps to the start when exhausted");
    const wrapped = await call("headlines", { category: "top", limit: 5, cursor: 0 });
    assert.deepEqual(wrapped.result.headlines.map((h) => h.id), ids1);
    assert.equal(rss.urls.length, rssBefore, "cursor refresh made no RSS call");
    assert.equal(gdeltCalls(), gBefore, "cursor refresh made no GDELT call");
  });

  it("no cursor => backwards-compatible shape; sorted newest first; undated items last", async () => {
    await primed({ gdelt: [gdeltArticle("Undated GDELT item here", "https://u.example.com/x", undefined, "u.example.com")] });
    const r = await call("headlines", { category: "top", limit: 50 });
    const h = r.result.headlines;
    for (const k of ["id", "category", "title", "url", "source", "publishedAt"]) assert.ok(k in h[0], k);
    const times = h.map((x) => (x.publishedAt ? Date.parse(x.publishedAt) : -Infinity));
    for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i], "newest first");
    const undated = h.find((x) => x.title === "Undated GDELT item here");
    assert.equal(undated.publishedAt, null, "no invented date");
    assert.equal(h[h.length - 1].publishedAt, null);
  });

  it("dedupes the same story across GDELT and RSS (RSS keeps the real outlet label)", async () => {
    const sameUrl = "https://feeds.bbci.co.uk/story/_news_rss_xml/0";
    const title = "Headline feeds_bbci_co_uk_news_rss_xml number 0";
    await primed({ gdelt: [gdeltArticle(title, sameUrl, "20261020T100000Z", "bbc.co.uk")] });
    const r = await call("headlines", { category: "top", limit: 50 });
    const matches = r.result.headlines.filter((h) => h.title === title);
    assert.equal(matches.length, 1, "one copy");
    assert.equal(matches[0].source, "BBC News");
  });

  it("excluded outlets indexed by GDELT (Al Jazeera, France 24, ABC AU) never appear", async () => {
    await primed({ gdelt: [
      gdeltArticle("Excluded AJ story", "https://www.aljazeera.com/news/2026/10/27/x", "20261027T100000Z", "aljazeera.com"),
      gdeltArticle("Excluded F24 story", "https://www.france24.com/en/x", "20261027T100000Z", "france24.com"),
      gdeltArticle("Excluded ABC AU story", "https://www.abc.net.au/news/x", "20261027T100000Z", "abc.net.au"),
      gdeltArticle("Allowed GDELT story here", "https://allowed.example.com/x", "20261027T100000Z", "allowed.example.com"),
    ] });
    const r = await call("headlines", { category: "top", limit: 50 });
    const titles = r.result.headlines.map((h) => h.title);
    assert.ok(titles.includes("Allowed GDELT story here"));
    for (const t of ["Excluded AJ story", "Excluded F24 story", "Excluded ABC AU story"]) assert.equal(titles.includes(t), false, t);
  });

  it("category switch shows that category's own pool", async () => {
    await primed();
    const tech = await call("headlines", { category: "tech", limit: 50 });
    const sports = await call("headlines", { category: "sports", limit: 50 });
    assert.ok(tech.result.headlines.some((h) => h.source === "Hacker News"));
    assert.ok(sports.result.headlines.every((h) => h.source !== "Hacker News"));
    assert.deepEqual(feedsForCategory("sports").map((f) => f.id), ["guardian-sport"]);
  });
});

// ── Concord summaries ───────────────────────────────────────────────────────

describe("Concord summaries", () => {
  const desc = "The city council voted on Tuesday to approve a new transit plan that adds six bus routes and extends service hours through the weekend for residents.";

  it("rejects a summary sharing 8+ consecutive words with the description; accepts 7", () => {
    const copied = "Officials said the city council voted on Tuesday to approve a plan.";
    assert.deepEqual(validateConcordSummary(copied, desc), { ok: false, reason: "copied_from_source" });
    const seven = "Locals saw the city council voted on Tuesday to approve changes, reportedly.";
    // "the city council voted on Tuesday to approve" is 8 words -> rejected; trim one word -> 7 shared -> ok
    assert.equal(validateConcordSummary(seven, desc).ok, false);
    const sevenOk = "Locals saw city council voted on Tuesday to approve changes to local buses.";
    assert.equal(validateConcordSummary(sevenOk, desc).ok, true);
  });

  it("rejects empty, too short, too long and too many sentences", () => {
    assert.equal(validateConcordSummary("", desc).reason, "empty");
    assert.equal(validateConcordSummary("Too short.", desc).reason, "too_short");
    assert.equal(validateConcordSummary(Array(60).fill("alpha").join(" "), desc).reason, "too_long");
    assert.equal(validateConcordSummary("One short claim here. Two short claims here. Three short claims here.", desc).reason, "too_many_sentences");
    assert.equal(validateConcordSummary("Transit expansion approved: more routes and longer hours are coming.", desc).ok, true);
  });

  async function warmedWithQueue() {
    const rss = makeRssFetch();
    __setNewsSourcesTestHooks({ fetchImpl: rss.impl, robots: async () => true });
    __configureNewsSourcesForTests({ sleep: noSleep, perMin: 1000 });
    globalThis.fetch = async () => gdeltOk([]);
    await warmAll(12);
  }

  it("stores a valid summary and the headline then carries it labelled summaryBy:concord", async () => {
    await warmedWithQueue();
    const prompts = [];
    const out = await runSummaryBatch({
      llm: async (p) => { prompts.push(p); return "A short original summary describing the development for readers."; },
      ready: () => true, max: 50,
    });
    assert.ok(out.stored > 0);
    assert.ok(prompts[0].includes(DESC_SENTINEL), "description is the in-memory prompt input");
    // walk every window of the pool (the summarized items may not sit in the first page)
    const all = [];
    let cursor = 0;
    let r;
    do {
      // "tech": the summarizer takes the newest-queued items first, i.e. the last feeds warmed (TechCrunch, The Verge, Ars)
      r = await call("headlines", { category: "tech", limit: 50, cursor });
      all.push(...r.result.headlines);
      cursor = r.result.nextCursor;
    } while (cursor !== 0);
    r = { result: { ...r.result, headlines: all } };
    const withSummary = r.result.headlines.filter((h) => h.summary);
    assert.ok(withSummary.length > 0);
    for (const h of withSummary) {
      assert.equal(h.summaryBy, "concord");
      assert.equal(h.contentPolicy, "summary-only");
    }
    // outlet text still absent everywhere
    // (full-tier ScienceDaily/NASA snippets legitimately carry the feed text; summary-only items never do)
    assert.equal(JSON.stringify(r.result.headlines.filter((h) => h.contentPolicy === "summary-only")).includes(DESC_SENTINEL), false);
  });

  it("a copied summary is rejected and the item keeps summary:null (never fabricated)", async () => {
    await warmedWithQueue();
    const out = await runSummaryBatch({
      llm: async (p) => /Source text:\n([\s\S]*?)\n\nSummary:/.exec(p)[1], // echoes the outlet text verbatim
      ready: () => true, max: 50,
    });
    assert.equal(out.stored, 0);
    assert.ok(out.rejected > 0);
    const r = await call("headlines", { category: "top", limit: 50 });
    assert.ok(r.result.headlines.every((h) => h.summary === null || h.summary === undefined));
  });

  it("skipped when no brain is ready or the LLM throws; budget is bounded", async () => {
    await warmedWithQueue();
    const q = summaryQueueSize();
    assert.ok(q > 0);
    assert.equal((await runSummaryBatch({ llm: async () => "x", ready: () => false })).reason, "brain_not_ready");
    assert.equal(summaryQueueSize(), q, "nothing consumed while the brain is down");
    const t = await runSummaryBatch({ llm: async () => { throw new Error("down"); }, ready: () => true, max: 3 });
    assert.equal(t.stored, 0);
    let now = 1_000_000;
    __resetSummarizerForTests({ now: () => now });
    await warmedWithQueue(); // re-queue
    let attempts = 0;
    for (let i = 0; i < 40; i++) {
      const o = await runSummaryBatch({ llm: async () => { attempts++; return "x"; }, ready: () => true, max: 3 });
      if (!o.ran) break;
    }
    assert.ok(attempts <= SUMMARY_BUDGET, `attempts ${attempts} within the ${SUMMARY_BUDGET}/10min budget`);
    now += 11 * 60 * 1000;
    assert.equal(typeof summaryFor("nope"), "object"); // null
  });
});

// ── feed-manager / DTU builder ──────────────────────────────────────────────

describe("feed-manager DTUs from restricted outlets", () => {
  it("isRestrictedFeedItem: article feeds follow the host tier, data feeds are untouched", () => {
    assert.equal(isRestrictedFeedItem({ type: "rss", url: "https://feeds.bbci.co.uk/news/rss.xml" }, {}), true);
    assert.equal(isRestrictedFeedItem({ type: "rss", url: "https://unknown.example/feed" }, {}), true);
    assert.equal(isRestrictedFeedItem({ type: "rss", url: "https://www.sciencedaily.com/rss/top.xml" }, {}), false);
    assert.equal(isRestrictedFeedItem({ type: "json", url: "https://earthquake.usgs.gov/x.geojson" }, {}), false);
    assert.equal(isRestrictedFeedItem({ type: "json", url: "https://api.coingecko.com/x" }, {}), false);
  });

  it("parseRSS strictDates leaves a missing date null (default behaviour unchanged)", () => {
    const xml = `<rss><channel><item><title>T</title><link>https://a.example/x</link><description>d</description></item></channel></rss>`;
    assert.equal(parseRSS(xml, {}, { strictDates: true })[0].publishedAt, null);
    assert.ok(parseRSS(xml, {})[0].publishedAt, "legacy callers still get a timestamp");
  });

  it("the headline-only quality gate admits a title+link record; the default gate still demands a body", () => {
    const dtu = {
      title: "A sufficiently long headline for the gate to accept it", tags: [],
      content: "headline only", meta: { externalUrl: "https://feeds.bbci.co.uk/a" },
    };
    assert.equal(checkQualityGate(dtu).ok, false);
    assert.equal(checkQualityGate(dtu, { headlineOnly: true }).ok, true);
  });

  it("a restricted-outlet DTU holds headline/link/date/source only (no description, no excerpt)", async () => {
    const dtus = new Map();
    forceActive(); // tickFeed has an idle gate (no users => no polling); this test is the "users present" case
    initFeedManager({ STATE: { dtus }, db: null, io: null, logger: console });
    process.env.CONCORD_FEED_ROBOTS_CHECK = "0";
    const xml = `<rss><channel><item><title>Regional council approves a brand new transit plan today</title><link>https://feeds.bbci.co.uk/news/x-1</link><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate><description>${DESC_SENTINEL} ${"long outlet article text ".repeat(30)}</description></item></channel></rss>`;
    globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => "application/xml" }, text: async () => xml, json: async () => ({}) });
    registerFeed({ id: "t_bbc_restricted", name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", type: "rss", domain: "news", enabled: false });
    await forceTick("t_bbc_restricted");
    const made = [...dtus.values()].filter((d) => d.meta?.feedId === "t_bbc_restricted");
    assert.equal(made.length, 1, "restricted headline-only DTU is created");
    const d = made[0];
    assert.equal(JSON.stringify(d).includes(DESC_SENTINEL), false, "no outlet text anywhere in the DTU");
    assert.equal(d.contentPolicy, "summary-only");
    assert.equal(d.meta.externalUrl, "https://feeds.bbci.co.uk/news/x-1");
    assert.ok(d.content.length < 300, "headline-sized body only");
    assert.equal(countRestrictedFullTextDtus([d]).count, 0);
  });
});

// ── countRestrictedFullTextDtus ─────────────────────────────────────────────

describe("countRestrictedFullTextDtus (read-only audit helper)", () => {
  const longText = "word ".repeat(120);
  it("counts restricted/excluded-host DTUs that hold article text; ignores full-tier and headline-only ones", () => {
    const dtus = [
      { id: "a", title: "T", content: longText, meta: { sourceUrl: "https://feeds.bbci.co.uk/x" } },                 // restricted + text -> count
      { id: "b", title: "T", creti: longText, meta: { externalUrl: "https://www.theguardian.com/y" } },             // restricted + text -> count
      { id: "c", title: "T", content: longText, meta: { sourceUrl: "https://www.sciencedaily.com/z" } },            // full tier -> no
      { id: "d", title: "T", content: "short", meta: { sourceUrl: "https://feeds.bbci.co.uk/x" } },                 // headline only -> no
      { id: "e", title: "T", core: { definitions: [longText], evidence: [{ type: "url", value: "https://www.aljazeera.com/q" }] } }, // excluded + text -> count
      { id: "f", title: "T", content: longText },                                                                   // no url -> unattributable
      { id: "g", title: "T", data: { description: longText }, source: { url: "https://unknown.example/a" } },       // unknown host + text -> count
    ];
    const snapshot = JSON.stringify(dtus);
    const r = countRestrictedFullTextDtus(dtus);
    assert.equal(r.count, 4);
    assert.deepEqual(r.ids.sort(), ["a", "b", "e", "g"]);
    assert.equal(r.examined, 7);
    assert.equal(JSON.stringify(dtus), snapshot, "pure: input untouched");
  });
  it("accepts any iterable (e.g. Map#values) and empty input", () => {
    assert.equal(countRestrictedFullTextDtus(new Map().values()).count, 0);
    assert.equal(countRestrictedFullTextDtus(null).count, 0);
  });
});

// ── GDELT timeout / user wait / warm gate ───────────────────────────────────

describe("GDELT 20 s upstream timeout and 8 s user wait", () => {
  it("source timeout is 20 s", () => { assert.equal(GDELT_TIMEOUT_MS, 20_000); });

  it("a cold miss answers { unavailable, reason:'warming' } after the user wait while the SAME fetch fills the cache", async () => {
    __configureGdeltForTests({ userWaitMs: 40, timeoutMs: 5000 });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 200));
      return gdeltOk([gdeltArticle("Slow GDELT answer arrives late", "https://slow.example.com/a", "20261026T120000Z", "slow.example.com")]);
    };
    const t0 = Date.now();
    const cold = await call("headlines", { category: "world" });
    assert.ok(Date.now() - t0 < 180, "user did not wait for the full upstream answer");
    assert.equal(cold.result.status, "unavailable");
    assert.equal(cold.result.reason, "warming");
    assert.deepEqual(cold.result.headlines, []);
    await new Promise((r) => setTimeout(r, 350));
    const warm = await call("headlines", { category: "world" });
    assert.equal(warm.result.headlines[0].title, "Slow GDELT answer arrives late");
    assert.equal(calls, 1, "no duplicate upstream request");
  });

  it("daily-briefing reports 'warming' for sections that miss the wait", async () => {
    __configureGdeltForTests({ briefingBudgetMs: 30, userWaitMs: 5000, timeoutMs: 5000 });
    globalThis.fetch = async () => { await new Promise((r) => setTimeout(r, 150)); return gdeltOk([]); };
    const r = await call("daily-briefing", {});
    assert.equal(r.result.topStories.unavailableReason, "warming");
  });
});

describe("feed-cache default warm gate", () => {
  it("does not depend on lowMemory/idleness: runs by default, yields only to an overloaded loop", async () => {
    const hits = [];
    registerSource("gate-test", {
      ttlMs: 60_000, license: "public", warm: { keys: ["k"], everyTicks: 1 },
      fetcher: async (k) => { hits.push(k); return [{ title: "x" }]; },
    });
    // no shouldRun passed => defaultShouldRun (presence-idle.shouldRunHeavyMaintenance is NOT consulted)
    const ran = await warmTick(0);
    assert.equal(ran.ran, true);
    assert.deepEqual(hits, ["k"]);
    configureFeedCache({ loadCheck: () => true });
    hits.length = 0;
    const gated = await warmTick(1);
    assert.equal(gated.ran, false);
    assert.equal(gated.reason, "gated");
    assert.deepEqual(hits, []);
    configureFeedCache({ loadCheck: undefined });
    const r = await get("gate-test", "k");
    assert.equal(r.status, "fresh");
  });
});
