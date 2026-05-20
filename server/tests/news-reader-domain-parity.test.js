// Contract tests for the news Apple News 2026-parity reader macros
// (articles, channels, topics, feed, saved, reading history, reactions).
// Bias/event/headline macros are covered in news-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerNewsActions from "../domains/news.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`news.${name}`);
  assert.ok(fn, `news.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerNewsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function addArticle(ctx = ctxA, over = {}) {
  return call("article-add", ctx, {
    title: "Markets rally", source: "Reuters", topic: "business",
    summary: "Stocks up", publishedAt: "2026-05-19T10:00:00Z", ...over,
  }).result.article;
}

describe("news.article-* directory", () => {
  it("add requires a title; directory is shared", () => {
    assert.equal(call("article-add", ctxA, {}).ok, false);
    addArticle();
    assert.equal(call("article-list", ctxB, {}).result.count, 1);
  });

  it("search matches title, source and topic", () => {
    addArticle(ctxA, { title: "Election results", topic: "politics" });
    addArticle(ctxA, { title: "Tech earnings", source: "Bloomberg", topic: "technology" });
    assert.equal(call("article-search", ctxA, { query: "election" }).result.count, 1);
    assert.equal(call("article-search", ctxA, { query: "bloomberg" }).result.count, 1);
  });

  it("only the contributor can delete", () => {
    const a = addArticle(ctxA);
    assert.equal(call("article-delete", ctxB, { id: a.id }).ok, false);
    assert.equal(call("article-delete", ctxA, { id: a.id }).ok, true);
  });
});

describe("news.channels + topics", () => {
  it("channel-list derives sources with counts and follow state", () => {
    addArticle(ctxA, { source: "Reuters" });
    addArticle(ctxA, { source: "Reuters" });
    addArticle(ctxA, { source: "AP" });
    call("channel-follow", ctxA, { source: "Reuters" });
    const ch = call("channel-list", ctxA, {});
    assert.equal(ch.result.channels[0].source, "Reuters");
    assert.equal(ch.result.channels[0].articleCount, 2);
    assert.equal(ch.result.channels[0].followed, true);
    assert.equal(ch.result.following, 1);
  });

  it("topic-follow toggles and lists", () => {
    addArticle(ctxA, { topic: "science" });
    assert.equal(call("topic-follow", ctxA, { topic: "science" }).result.following, true);
    assert.equal(call("topic-list", ctxA, {}).result.following, 1);
    assert.equal(call("topic-follow", ctxA, { topic: "science" }).result.following, false);
  });
});

describe("news.feed personalization", () => {
  it("feed filters to followed channels/topics, unread first", () => {
    addArticle(ctxA, { title: "Biz", source: "Reuters", topic: "business" });
    addArticle(ctxA, { title: "Sports", source: "ESPN", topic: "sports" });
    call("channel-follow", ctxA, { source: "Reuters" });
    const feed = call("feed", ctxA, {});
    assert.equal(feed.result.personalized, true);
    assert.equal(feed.result.count, 1);
    assert.equal(feed.result.articles[0].title, "Biz");
  });

  it("feed returns all when nothing followed", () => {
    addArticle(ctxA);
    addArticle(ctxA);
    const feed = call("feed", ctxA, {});
    assert.equal(feed.result.personalized, false);
    assert.equal(feed.result.count, 2);
  });

  it("today-digest groups by topic", () => {
    addArticle(ctxA, { topic: "business" });
    addArticle(ctxA, { topic: "business" });
    addArticle(ctxA, { topic: "sports" });
    const digest = call("today-digest", ctxA, {});
    assert.equal(digest.result.sections[0].topic, "business");
    assert.equal(digest.result.sections[0].count, 2);
  });
});

describe("news.saved + reading history", () => {
  it("save toggles per user", () => {
    const a = addArticle();
    assert.equal(call("article-save", ctxA, { id: a.id }).result.saved, true);
    assert.equal(call("saved-list", ctxA, {}).result.count, 1);
    assert.equal(call("saved-list", ctxB, {}).result.count, 0);
    assert.equal(call("article-save", ctxA, { id: a.id }).result.saved, false);
  });

  it("mark-read records history and stats", () => {
    const a1 = addArticle(ctxA, { topic: "business" });
    const a2 = addArticle(ctxA, { topic: "business" });
    call("article-mark-read", ctxA, { id: a1.id });
    call("article-mark-read", ctxA, { id: a2.id });
    assert.equal(call("reading-history", ctxA, {}).result.count, 2);
    const stats = call("reading-stats", ctxA, {});
    assert.equal(stats.result.totalRead, 2);
    assert.equal(stats.result.topTopics[0].topic, "business");
    call("article-mark-read", ctxA, { id: a1.id, unread: true });
    assert.equal(call("reading-stats", ctxA, {}).result.totalRead, 1);
  });
});

describe("news.reactions + recommendations", () => {
  it("react 'more' raises interest and surfaces recommendations", () => {
    const a1 = addArticle(ctxA, { title: "Liked topic", topic: "space" });
    addArticle(ctxA, { title: "Another space story", topic: "space" });
    call("article-react", ctxA, { id: a1.id, kind: "more" });
    const interests = call("interests", ctxA, {});
    assert.ok(interests.result.topics.find((t) => t.name === "space").weight > 0);
    const rec = call("recommended", ctxA, {});
    assert.ok(rec.result.count >= 1);
    assert.equal(call("article-react", ctxA, { id: a1.id, kind: "bogus" }).ok, false);
  });

  it("trending ranks by reads + reactions", () => {
    const a1 = addArticle(ctxA);
    const a2 = addArticle(ctxA);
    call("article-mark-read", ctxA, { id: a1.id });
    call("article-mark-read", ctxB, { id: a1.id });
    call("article-react", ctxA, { id: a2.id, kind: "more" });
    const t = call("trending", ctxA, {});
    assert.equal(t.result.articles[0].id, a1.id); // 2 reads beats 1 reaction(=2)... tie broken; a1 readCount 2
  });
});

describe("news.news-dashboard", () => {
  it("aggregates follows, feed unread and reads", () => {
    addArticle(ctxA, { source: "Reuters" });
    addArticle(ctxA, { source: "Reuters" });
    call("channel-follow", ctxA, { source: "Reuters" });
    const d = call("news-dashboard", ctxA, {});
    assert.equal(d.result.articles, 2);
    assert.equal(d.result.followedChannels, 1);
    assert.equal(d.result.feedUnread, 2);
  });
});
