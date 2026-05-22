import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerNewsActions from "../domains/news.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) { return ACTIONS.get(`news.${name}`)(ctx, { id: null, data: {}, meta: {} }, params); }
before(() => { registerNewsActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };

describe("news parity macros (real GDELT)", () => {
  it("headlines returns error when network is disabled (hermetic test)", async () => {
    const r = await call("headlines", ctxA, { category: "tech", limit: 10 });
    assert.equal(r.ok, false);
    assert.match(r.error, /failed|network/);
  });

  it("headlines parses GDELT response shape", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /api\.gdeltproject\.org\/api\/v2\/doc\/doc/);
      assert.match(url, /technology/);
      return {
        ok: true,
        json: async () => ({
          articles: [
            {
              title: "AI breakthrough announced",
              url: "https://example.com/ai",
              domain: "techcrunch.com",
              language: "English",
              sourcecountry: "US",
              seendate: "20260516T103045Z",
              socialimage: "https://example.com/img.jpg",
            },
          ],
        }),
      };
    };
    const r = await call("headlines", ctxA, { category: "tech", limit: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "GDELT Project (real-time global news, no key required)");
    assert.equal(r.result.headlines.length, 1);
    assert.equal(r.result.headlines[0].title, "AI breakthrough announced");
    assert.equal(r.result.headlines[0].source, "techcrunch.com");
    assert.equal(r.result.headlines[0].category, "tech");
  });

  it("unknown category falls back to top", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ articles: [] }) };
    };
    await call("headlines", ctxA, { category: "fake_category" });
    assert.match(capturedUrl, /world|breaking/);
  });

  it("daily-briefing makes 4 parallel GDELT calls", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({ articles: [{ title: `Story ${calls}`, url: "https://x.com", domain: "x.com" }] }),
      };
    };
    const r = await call("daily-briefing", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(calls, 4);
    assert.ok(r.result.topStories.bullets.length >= 1);
    assert.ok(r.result.closing);
  });
});

// ── Parity backlog macros (Ground News + Apple News surface) ──────────
function addArt(over = {}) {
  return call("article-add", ctxA, {
    title: "Markets rally", source: "Reuters", topic: "business",
    summary: "Stocks up sharply", publishedAt: "2026-05-19T10:00:00Z", ...over,
  }).result.article;
}

describe("news.bias-spectrum", () => {
  it("places articles into left/center/right columns with coverage", () => {
    addArt({ title: "Progressive equity reform passes", summary: "marginalized rights expanded" });
    addArt({ title: "Patriot liberty border enforcement bill", summary: "taxpayer freedom values" });
    addArt({ title: "Quarterly earnings report released", summary: "company posted figures" });
    const r = call("bias-spectrum", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);
    assert.equal(r.result.columns.left.length, 1);
    assert.equal(r.result.columns.right.length, 1);
    assert.equal(r.result.columns.center.length, 1);
    const totalCoverage = r.result.coverage.left + r.result.coverage.center + r.result.coverage.right;
    assert.ok(totalCoverage >= 99 && totalCoverage <= 100, "coverage should sum to ~100% (allowing integer rounding)");
  });

  it("flags a blindspot when one lean has no coverage", () => {
    addArt({ title: "Patriot liberty enforcement", summary: "border taxpayer freedom" });
    const r = call("bias-spectrum", ctxA, {});
    assert.equal(r.result.blindspot, "left");
  });

  it("returns empty columns when no articles exist", () => {
    const r = call("bias-spectrum", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.columns.count, 0);
  });
});

describe("news.story-clusters", () => {
  it("groups articles covering the same event into one story", () => {
    addArt({ title: "Central bank raises interest rates sharply", summary: "policy tightening across markets" });
    addArt({ title: "Markets react as central bank raises interest rates", summary: "tightening policy markets" });
    addArt({ title: "Olympic swimming finals dazzle viewers", summary: "athletes break records tonight" });
    const r = call("story-clusters", ctxA, {});
    assert.equal(r.ok, true);
    const big = r.result.clusters.find((c) => c.articleCount > 1);
    assert.ok(big, "expected a multi-article cluster");
    assert.ok(big.spread);
    assert.ok(Array.isArray(big.articles));
  });

  it("singleton articles each form their own story", () => {
    addArt({ title: "Unique alpha story xyzzy" });
    addArt({ title: "Totally different beta plugh report" });
    const r = call("story-clusters", ctxA, {});
    assert.equal(r.result.storyCount, 2);
  });
});

describe("news.article-audio", () => {
  it("returns a sentence-segmented script with duration estimate", () => {
    const a = addArt({ title: "Breaking news today", summary: "First sentence here. Second sentence follows. Third closes it." });
    const r = call("article-audio", ctxA, { id: a.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.segments.length >= 2);
    assert.ok(r.result.wordCount > 0);
    assert.ok(r.result.estimatedSeconds >= 3);
  });

  it("errors on a missing article", () => {
    const r = call("article-audio", ctxA, { id: "nope" });
    assert.equal(r.ok, false);
  });
});

describe("news.alerts", () => {
  it("subscribe toggles and lists subscriptions", () => {
    const sub = call("alert-subscribe", ctxA, { kind: "topic", target: "business" });
    assert.equal(sub.result.subscribed, true);
    assert.equal(call("alert-list", ctxA, {}).result.count, 1);
    const off = call("alert-subscribe", ctxA, { kind: "topic", target: "business" });
    assert.equal(off.result.subscribed, false);
    assert.equal(call("alert-list", ctxA, {}).result.count, 0);
  });

  it("rejects an invalid alert kind", () => {
    assert.equal(call("alert-subscribe", ctxA, { kind: "bogus" }).ok, false);
  });

  it("alert-feed delivers matched articles and marks them read", () => {
    call("alert-subscribe", ctxA, { kind: "topic", target: "business" });
    addArt({ topic: "business" });
    addArt({ topic: "sports" });
    const feed = call("alert-feed", ctxA, {});
    assert.equal(feed.ok, true);
    assert.equal(feed.result.count, 1);
    assert.equal(feed.result.unread, 1);
    const read = call("alert-feed", ctxA, { markRead: true });
    assert.equal(read.result.unread, 0);
  });
});

describe("news.offline-sync", () => {
  it("syncs an article snapshot for offline reading and toggles off", () => {
    const a = addArt();
    const on = call("offline-sync", ctxA, { id: a.id });
    assert.equal(on.result.synced, true);
    const list = call("offline-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.articles[0].title, "Markets rally");
    const off = call("offline-sync", ctxA, { id: a.id });
    assert.equal(off.result.synced, false);
    assert.equal(call("offline-list", ctxA, {}).result.count, 0);
  });

  it("errors syncing a missing article", () => {
    assert.equal(call("offline-sync", ctxA, { id: "missing" }).ok, false);
  });
});

describe("news.source-profile", () => {
  it("computes bias lean, factuality and topic spread for a source", () => {
    addArt({ source: "Reuters", topic: "business", summary: "A detailed factual summary of market movements today." });
    addArt({ source: "Reuters", topic: "politics", summary: "Another thorough summary of the legislative session." });
    const r = call("source-profile", ctxA, { source: "Reuters" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "Reuters");
    assert.equal(r.result.articleCount, 2);
    assert.ok(["left", "center", "right"].includes(r.result.biasLean));
    assert.ok(r.result.factualityRating >= 0 && r.result.factualityRating <= 100);
    assert.equal(r.result.topicSpread.length, 2);
  });

  it("errors when no articles exist for the source", () => {
    assert.equal(call("source-profile", ctxA, { source: "Ghost News" }).ok, false);
  });
});

describe("news.digest-schedule", () => {
  it("set and get persist cadence, hour and next delivery", () => {
    const set = call("digest-schedule-set", ctxA, { cadence: "weekdays", hour: 7, topicsOnly: true });
    assert.equal(set.ok, true);
    assert.equal(set.result.schedule.cadence, "weekdays");
    const get = call("digest-schedule-get", ctxA, {});
    assert.equal(get.result.schedule.hour, 7);
    assert.equal(get.result.schedule.topicsOnly, true);
    assert.ok(get.result.nextDelivery, "expected a computed next delivery");
  });

  it("rejects an invalid cadence", () => {
    assert.equal(call("digest-schedule-set", ctxA, { cadence: "hourly", hour: 5 }).ok, false);
  });

  it("off cadence has no next delivery", () => {
    call("digest-schedule-set", ctxA, { cadence: "off", hour: 9 });
    const get = call("digest-schedule-get", ctxA, {});
    assert.equal(get.result.nextDelivery, null);
  });
});
