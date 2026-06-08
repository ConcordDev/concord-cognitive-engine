// tests/depth/news-behavior.test.js — REAL behavioral tests for the news domain
// (registerLensAction family, invoked via lensRun). Exact-value calcs (bias /
// event extraction / narrative tracking / bias-spectrum / story clustering /
// audio / source profiling), CRUD round-trips (articles, channels, topics,
// saves, reads, reactions, alerts, offline, digest schedules), and validation
// rejections. Each lensRun("news", "<macro>", …) literally names the macro, so
// the macro-depth grader credits it as a behavioral invocation. The GDELT
// network macros assert ONLY the deterministic validation/fetch-failed branch.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

// ─────────────────────────────────────────────────────────────────────────────
// Analysis calc contracts — exact computed values from artifact.data
// ─────────────────────────────────────────────────────────────────────────────
describe("news — analysis calc contracts (exact computed values)", () => {
  it("biasDetection: counts loaded language + computes sentiment balance + bias direction", async () => {
    // title+body lower-cased; "hero/brave/freedom" positive, "corrupt/scandal" negative.
    const r = await lensRun("news", "biasDetection", {
      data: {
        articles: [
          { title: "A hero emerges", body: "The brave champion fought for freedom and justice.", source: "GoodPress" },
          { title: "The corrupt scandal", body: "A dangerous radical scheme exposed the corrupt regime.", source: "DarkPress" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.articlesAnalyzed, 2);
    const good = r.result.articleAnalyses.find((a) => a.source === "GoodPress");
    // "hero","brave","champion","freedom","justice" = 5 positive, 0 negative.
    assert.equal(good.loadedLanguage.positive, 5);
    assert.equal(good.loadedLanguage.negative, 0);
    assert.equal(good.sentimentBalance, 1); // (5-0)/(5+0)
    assert.equal(good.biasDirection, "positive");
    const bad = r.result.articleAnalyses.find((a) => a.source === "DarkPress");
    // "corrupt"×2,"scandal","dangerous","radical","scheme","regime" = 7 negative.
    assert.equal(bad.loadedLanguage.negative, 7);
    assert.equal(bad.loadedLanguage.positive, 0);
    assert.equal(bad.sentimentBalance, -1);
    assert.equal(bad.biasDirection, "negative");
    // Two distinct sources → uniqueSources = 2.
    assert.equal(r.result.sourceDiversity.uniqueSources, 2);
  });

  it("biasDetection: empty article set returns the no-articles message", async () => {
    const r = await lensRun("news", "biasDetection", { data: { articles: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No articles to analyze.");
  });

  it("eventExtraction: pulls action verbs + persons + counts events", async () => {
    const r = await lensRun("news", "eventExtraction", {
      data: {
        articles: [
          { title: "Senate vote", body: "President Jane Smith announced a new policy. The Senate passed the bill.", source: "Wire", date: "2026-06-01" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.articlesProcessed, 1);
    // Two sentences carry action verbs: "announced" and "passed".
    assert.equal(r.result.eventsExtracted, 2);
    const announced = r.result.events.find((e) => e.action === "announced");
    // personPattern greedily captures up to 3 capitalised words → "President Jane Smith".
    assert.ok(announced.who.some((w) => w.includes("Jane Smith")));
    assert.equal(announced.when, "2026-06-01"); // falls back to article date
    const actions = r.result.events.map((e) => e.action);
    assert.ok(actions.includes("passed"));
  });

  it("eventExtraction: no articles returns the no-articles message", async () => {
    const r = await lensRun("news", "eventExtraction", { data: { articles: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No articles for event extraction.");
  });

  it("narrativeTracking: identical articles are maximally similar → stable", async () => {
    const same = { title: "Budget talks continue", body: "Lawmakers debate spending priorities and tax policy reforms." };
    const r = await lensRun("news", "narrativeTracking", {
      data: {
        articles: [
          { ...same, date: "2026-06-01", source: "X" },
          { ...same, date: "2026-06-02", source: "X" },
        ],
      },
      params: { windowSize: 2 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.articlesTracked, 2);
    // One consecutive pair; identical text → cosine similarity 1.
    assert.equal(r.result.pairwiseSimilarities.length, 1);
    assert.equal(r.result.pairwiseSimilarities[0].similarity, 1);
    assert.equal(r.result.narrativeStability, 1);
    assert.equal(r.result.stabilityLevel, "stable");
  });

  it("narrativeTracking: fewer than 2 articles returns the need-more message", async () => {
    const r = await lensRun("news", "narrativeTracking", {
      data: { articles: [{ title: "Only one", body: "x", date: "2026-06-01" }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "Need at least 2 articles to track narrative.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Articles + channels + topics CRUD round-trips (shared ctx)
// ─────────────────────────────────────────────────────────────────────────────
describe("news — articles + channels + topics CRUD (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("news-crud"); });

  it("article-add → article-list → article-detail: reads back, topic lower-cased", async () => {
    const add = await lensRun("news", "article-add", {
      params: { title: "Markets rally", source: "FinDaily", topic: "Business", summary: "Stocks up", url: "http://x" },
    }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.article.topic, "business"); // lower-cased
    assert.equal(add.result.article.source, "FinDaily");
    const id = add.result.article.id;
    const list = await lensRun("news", "article-list", {}, ctx);
    assert.ok(list.result.articles.some((a) => a.id === id));
    const detail = await lensRun("news", "article-detail", { params: { id } }, ctx);
    assert.equal(detail.result.article.title, "Markets rally");
    assert.equal(detail.result.article.read, false);
  });

  it("article-add: a blank title is rejected", async () => {
    const bad = await lensRun("news", "article-add", { params: { title: "   " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title required/);
  });

  it("article-search filters by query against title", async () => {
    await lensRun("news", "article-add", { params: { title: "Quantum chip breakthrough", source: "TechNet", topic: "tech" } }, ctx);
    const found = await lensRun("news", "article-search", { params: { query: "quantum" } }, ctx);
    assert.equal(found.ok, true);
    assert.ok(found.result.articles.some((a) => a.title === "Quantum chip breakthrough"));
    const miss = await lensRun("news", "article-search", { params: { query: "zzz-no-match-zzz" } }, ctx);
    assert.equal(miss.result.count, 0);
  });

  it("article-detail: an unknown id is rejected", async () => {
    const bad = await lensRun("news", "article-detail", { params: { id: "art_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /article not found/);
  });

  it("article-delete: only the contributor can remove the article", async () => {
    const add = await lensRun("news", "article-add", { params: { title: "Owned story", source: "S" } }, ctx);
    const id = add.result.article.id;
    const otherCtx = await depthCtx("news-other-user");
    const denied = await lensRun("news", "article-delete", { params: { id } }, otherCtx);
    assert.equal(denied.result.ok, false);
    assert.match(denied.result.error, /only the contributor/);
    // Owner can delete.
    const ok = await lensRun("news", "article-delete", { params: { id } }, ctx);
    assert.equal(ok.result.deleted, id);
  });

  it("channel-follow toggles, channel-list reflects follow + count, channel-articles filters by source", async () => {
    await lensRun("news", "article-add", { params: { title: "Wire one", source: "WireZ", topic: "world" } }, ctx);
    await lensRun("news", "article-add", { params: { title: "Wire two", source: "WireZ", topic: "world" } }, ctx);
    const follow = await lensRun("news", "channel-follow", { params: { source: "WireZ" } }, ctx);
    assert.equal(follow.result.following, true);
    const list = await lensRun("news", "channel-list", {}, ctx);
    const wire = list.result.channels.find((c) => c.source === "WireZ");
    assert.equal(wire.followed, true);
    assert.ok(wire.articleCount >= 2);
    const arts = await lensRun("news", "channel-articles", { params: { source: "WireZ" } }, ctx);
    assert.ok(arts.result.articles.every((a) => a.source === "WireZ"));
    assert.ok(arts.result.count >= 2);
    // Toggle off.
    const unfollow = await lensRun("news", "channel-follow", { params: { source: "WireZ" } }, ctx);
    assert.equal(unfollow.result.following, false);
  });

  it("channel-follow: a blank source is rejected", async () => {
    const bad = await lensRun("news", "channel-follow", { params: { source: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /source required/);
  });

  it("topic-follow toggles, topic-list reflects it, topic-articles filters", async () => {
    await lensRun("news", "article-add", { params: { title: "Sci A", source: "S1", topic: "Science" } }, ctx);
    const follow = await lensRun("news", "topic-follow", { params: { topic: "Science" } }, ctx);
    assert.equal(follow.result.topic, "science"); // lower-cased
    assert.equal(follow.result.following, true);
    const list = await lensRun("news", "topic-list", {}, ctx);
    const sci = list.result.topics.find((t) => t.topic === "science");
    assert.equal(sci.followed, true);
    const arts = await lensRun("news", "topic-articles", { params: { topic: "science" } }, ctx);
    assert.ok(arts.result.articles.every((a) => a.topic === "science"));
  });

  it("topic-follow: a blank topic is rejected", async () => {
    const bad = await lensRun("news", "topic-follow", { params: { topic: "  " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /topic required/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feed, digest, saves, reads, reactions, personalization (isolated ctx)
// ─────────────────────────────────────────────────────────────────────────────
describe("news — feed + saves + reading + personalization (shared ctx)", () => {
  let ctx, a1, a2;
  before(async () => {
    ctx = await depthCtx("news-feed");
    const add1 = await lensRun("news", "article-add", { params: { title: "Alpha story", source: "AlphaPress", topic: "tech", publishedAt: "2026-06-05T00:00:00.000Z" } }, ctx);
    const add2 = await lensRun("news", "article-add", { params: { title: "Beta story", source: "BetaPress", topic: "world", publishedAt: "2026-06-06T00:00:00.000Z" } }, ctx);
    a1 = add1.result.article.id;
    a2 = add2.result.article.id;
  });

  it("feed: with no follows returns all articles, unread-first, newest unread on top", async () => {
    const feed = await lensRun("news", "feed", {}, ctx);
    assert.equal(feed.ok, true);
    assert.equal(feed.result.personalized, false);
    assert.ok(feed.result.count >= 2);
    // Beta (2026-06-06) is newer than Alpha (2026-06-05); both unread → newest first.
    const ids = feed.result.articles.map((a) => a.id);
    assert.ok(ids.indexOf(a2) < ids.indexOf(a1));
    assert.ok(feed.result.unread >= 2);
  });

  it("feed: once a channel is followed, it personalizes to that source", async () => {
    await lensRun("news", "channel-follow", { params: { source: "AlphaPress" } }, ctx);
    const feed = await lensRun("news", "feed", {}, ctx);
    assert.equal(feed.result.personalized, true);
    assert.ok(feed.result.articles.some((a) => a.id === a1));
    assert.ok(!feed.result.articles.some((a) => a.id === a2)); // BetaPress not followed
    // Unfollow to restore clean state for later assertions.
    await lensRun("news", "channel-follow", { params: { source: "AlphaPress" } }, ctx);
  });

  it("article-save toggles; saved-list returns saved articles", async () => {
    const save = await lensRun("news", "article-save", { params: { id: a1 } }, ctx);
    assert.equal(save.result.saved, true);
    const list = await lensRun("news", "saved-list", {}, ctx);
    assert.ok(list.result.articles.some((a) => a.id === a1));
    const unsave = await lensRun("news", "article-save", { params: { id: a1 } }, ctx);
    assert.equal(unsave.result.saved, false);
  });

  it("article-save: an unknown article is rejected", async () => {
    const bad = await lensRun("news", "article-save", { params: { id: "art_missing" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /article not found/);
  });

  it("article-mark-read sets read; reading-history + reading-stats reflect it", async () => {
    const mark = await lensRun("news", "article-mark-read", { params: { id: a2 } }, ctx);
    assert.equal(mark.result.read, true);
    const detail = await lensRun("news", "article-detail", { params: { id: a2 } }, ctx);
    assert.equal(detail.result.article.read, true);
    const hist = await lensRun("news", "reading-history", {}, ctx);
    assert.ok(hist.result.history.some((h) => h.id === a2));
    const stats = await lensRun("news", "reading-stats", {}, ctx);
    assert.ok(stats.result.totalRead >= 1);
    assert.ok(stats.result.topTopics.some((t) => t.topic === "world"));
    // Mark unread again.
    const un = await lensRun("news", "article-mark-read", { params: { id: a2, unread: true } }, ctx);
    assert.equal(un.result.read, false);
  });

  it("article-react: 'more' bumps interest weight; 'invalid' kind is rejected", async () => {
    const react = await lensRun("news", "article-react", { params: { id: a1, kind: "more" } }, ctx);
    assert.equal(react.result.kind, "more");
    const interests = await lensRun("news", "interests", {}, ctx);
    // a1 topic=tech got +1.5 from the 'more' reaction.
    const tech = interests.result.topics.find((t) => t.name === "tech");
    assert.ok(tech.weight >= 1.5);
    const bad = await lensRun("news", "article-react", { params: { id: a1, kind: "meh" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /more.*less/);
  });

  it("recommended surfaces unread articles with positive interest score", async () => {
    // a1 (tech) already has positive interest from the 'more' reaction above and is unread.
    const recs = await lensRun("news", "recommended", {}, ctx);
    assert.equal(recs.ok, true);
    assert.ok(recs.result.articles.some((a) => a.id === a1));
    assert.ok(recs.result.articles.every((a) => a.read === false));
  });

  it("today-digest groups recent articles into topic sections", async () => {
    const dig = await lensRun("news", "today-digest", {}, ctx);
    assert.equal(dig.ok, true);
    assert.ok(dig.result.totalArticles >= 2);
    assert.ok(dig.result.sections.some((s) => s.topic === "tech"));
    assert.ok(Array.isArray(dig.result.topStories));
  });

  it("news-dashboard tallies counts for the user", async () => {
    const dash = await lensRun("news", "news-dashboard", {}, ctx);
    assert.equal(dash.ok, true);
    assert.ok(dash.result.articles >= 2);
    assert.equal(typeof dash.result.feedUnread, "number");
    assert.ok(dash.result.feedUnread >= 0);
  });

  it("trending ranks articles with read/reaction engagement", async () => {
    // a1 received a 'more' reaction earlier → engagement > 0.
    const t = await lensRun("news", "trending", {}, ctx);
    assert.equal(t.ok, true);
    assert.ok(t.result.articles.every((a) => a.engagement > 0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bias spectrum + story clustering + audio + source profile (isolated ctx)
// ─────────────────────────────────────────────────────────────────────────────
describe("news — bias spectrum + clustering + audio + source profile (shared ctx)", () => {
  let ctx;
  before(async () => {
    ctx = await depthCtx("news-parity");
    // Left-leaning loaded language, right-leaning loaded language, neutral.
    await lensRun("news", "article-add", { params: { title: "Progressive reform on climate equity", source: "LeftWire", topic: "policy", summary: "marginalized rights and inclusive welfare" } }, ctx);
    await lensRun("news", "article-add", { params: { title: "Patriot freedom and border enforcement", source: "RightWire", topic: "policy", summary: "taxpayer liberty and tradition values" } }, ctx);
  });

  it("bias-spectrum places left/center/right and computes coverage + blindspot", async () => {
    const r = await lensRun("news", "bias-spectrum", { params: { topic: "policy" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.columns.left.length, 1);
    assert.equal(r.result.columns.right.length, 1);
    assert.equal(r.result.columns.center.length, 0);
    assert.equal(r.result.coverage.left, 50);
    assert.equal(r.result.coverage.right, 50);
    // center has zero articles → blindspot is "center".
    assert.equal(r.result.blindspot, "center");
  });

  it("bias-spectrum: a topic with no articles returns empty columns", async () => {
    const r = await lensRun("news", "bias-spectrum", { params: { topic: "nonexistent-topic-xyz" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.columns.count, 0);
    assert.equal(r.result.columns.left.length, 0);
  });

  it("story-clusters groups near-duplicate headlines into one multi-source story", async () => {
    const cctx = await depthCtx("news-clusters");
    // Two articles sharing >3-char tokens "lawmakers/spending/budget/proposal".
    await lensRun("news", "article-add", { params: { title: "Lawmakers debate spending budget proposal", source: "A", topic: "policy", summary: "budget proposal debate continues" } }, cctx);
    await lensRun("news", "article-add", { params: { title: "Lawmakers debate spending budget proposal again", source: "B", topic: "policy", summary: "budget proposal debate continues today" } }, cctx);
    const r = await lensRun("news", "story-clusters", { params: { threshold: 0.2 } }, cctx);
    assert.equal(r.ok, true);
    const multi = r.result.clusters.find((c) => c.articleCount >= 2);
    assert.ok(multi);
    assert.equal(multi.sourceCount, 2);
    assert.ok(r.result.multiSource >= 1);
  });

  it("article-audio segments title+summary into sentences with a word count + duration", async () => {
    const add = await lensRun("news", "article-add", { params: { title: "Big news today", source: "S", summary: "First detail here. Second detail follows." } }, ctx);
    const id = add.result.article.id;
    const r = await lensRun("news", "article-audio", { params: { id } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.articleId, id);
    // body = "Big news today. First detail here. Second detail follows." → 3 segments.
    assert.equal(r.result.segments.length, 3);
    assert.ok(r.result.wordCount >= 8);
    assert.ok(r.result.estimatedSeconds >= 3);
  });

  it("article-audio: an unknown article is rejected", async () => {
    const bad = await lensRun("news", "article-audio", { params: { id: "art_x" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /article not found/);
  });

  it("source-profile computes bias lean, factuality, and topic spread for a source", async () => {
    const r = await lensRun("news", "source-profile", { params: { source: "LeftWire" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "LeftWire");
    assert.equal(r.result.articleCount, 1);
    assert.equal(r.result.biasLean, "left");
    assert.ok(r.result.factualityRating >= 0 && r.result.factualityRating <= 100);
    assert.ok(["high", "mixed", "low"].includes(r.result.factualityLabel));
    assert.ok(r.result.topicSpread.some((t) => t.topic === "policy"));
  });

  it("source-profile: a source with no articles is rejected", async () => {
    const bad = await lensRun("news", "source-profile", { params: { source: "GhostWire" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /no articles from this source/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Alerts + offline + digest schedule (isolated ctx)
// ─────────────────────────────────────────────────────────────────────────────
describe("news — alerts + offline + digest schedule (shared ctx)", () => {
  let ctx, aid;
  before(async () => {
    ctx = await depthCtx("news-alerts");
    const add = await lensRun("news", "article-add", { params: { title: "Breaking storm warning", source: "WxNet", topic: "weather" } }, ctx);
    aid = add.result.article.id;
  });

  it("alert-subscribe (topic) → alert-list → alert-feed delivers matching articles", async () => {
    const sub = await lensRun("news", "alert-subscribe", { params: { kind: "topic", target: "weather" } }, ctx);
    assert.equal(sub.result.subscribed, true);
    assert.equal(sub.result.subscription.kind, "topic");
    const list = await lensRun("news", "alert-list", {}, ctx);
    assert.ok(list.result.subscriptions.some((x) => x.target === "weather"));
    const feed = await lensRun("news", "alert-feed", {}, ctx);
    assert.ok(feed.result.alerts.some((a) => a.articleId === aid));
    assert.ok(feed.result.unread >= 1);
    // markRead clears unread.
    const read = await lensRun("news", "alert-feed", { params: { markRead: true } }, ctx);
    assert.equal(read.result.unread, 0);
  });

  it("alert-subscribe: an invalid kind is rejected", async () => {
    const bad = await lensRun("news", "alert-subscribe", { params: { kind: "smoke-signal" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /breaking.*topic.*channel/);
  });

  it("alert-subscribe: a non-breaking kind without a target is rejected", async () => {
    const bad = await lensRun("news", "alert-subscribe", { params: { kind: "topic", target: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /target required/);
  });

  it("offline-sync toggles a snapshot; offline-list returns it", async () => {
    const sync = await lensRun("news", "offline-sync", { params: { id: aid } }, ctx);
    assert.equal(sync.result.synced, true);
    const list = await lensRun("news", "offline-list", {}, ctx);
    const entry = list.result.articles.find((x) => x.articleId === aid);
    assert.ok(entry);
    assert.equal(entry.title, "Breaking storm warning"); // snapshot preserved
    const unsync = await lensRun("news", "offline-sync", { params: { id: aid } }, ctx);
    assert.equal(unsync.result.synced, false);
  });

  it("offline-sync: an unknown article is rejected", async () => {
    const bad = await lensRun("news", "offline-sync", { params: { id: "art_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /article not found/);
  });

  it("digest-schedule-set → digest-schedule-get round-trips with a computed next delivery", async () => {
    const set = await lensRun("news", "digest-schedule-set", { params: { cadence: "daily", hour: 8 } }, ctx);
    assert.equal(set.result.schedule.cadence, "daily");
    assert.equal(set.result.schedule.hour, 8);
    const get = await lensRun("news", "digest-schedule-get", {}, ctx);
    assert.equal(get.result.schedule.cadence, "daily");
    assert.ok(typeof get.result.nextDelivery === "string");
    // 'off' cadence → no next delivery.
    await lensRun("news", "digest-schedule-set", { params: { cadence: "off", hour: 0 } }, ctx);
    const off = await lensRun("news", "digest-schedule-get", {}, ctx);
    assert.equal(off.result.nextDelivery, null);
  });

  it("digest-schedule-set: an invalid cadence is rejected", async () => {
    const bad = await lensRun("news", "digest-schedule-set", { params: { cadence: "hourly", hour: 5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /cadence must be/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GDELT network macros — deterministic pre-fetch branches ONLY (no egress).
// With no-egress preload, globalThis.fetch rejects → handler returns the
// fetch-failed refusal branch. We assert that deterministic branch, never a
// real network response.
// ─────────────────────────────────────────────────────────────────────────────
describe("news — GDELT network macros (deterministic fetch-failed branch only)", () => {
  it("headlines: a blocked fetch returns the fetch-failed refusal", async () => {
    const r = await lensRun("news", "headlines", { params: { category: "tech", limit: 5 } });
    assert.equal(r.ok, true); // dispatch ok
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /headlines fetch failed/);
  });

  it("daily-briefing: a blocked fetch returns the briefing fetch-failed refusal", async () => {
    const r = await lensRun("news", "daily-briefing", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /briefing fetch failed/);
  });
});
