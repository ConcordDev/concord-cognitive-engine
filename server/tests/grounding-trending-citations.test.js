// FIX-grounding-011 — trending items carry citations, not invented claims.
//
// grounding.trendingClaims used to mint `Recent reporting about
// "<title>" is accurate.` as the suggestedClaim of every most-read
// topic — a truth claim the Wikimedia featured-content API does not
// make (it reports readership), attached in the lens whose whole job
// is checking claims, with no item-level citation anywhere. Now:
//   - news items keep their story-derived claim and gain the item's
//     own page URL from the payload's links;
//   - topic items carry NO suggestedClaim — they carry their article
//     URL (content_urls, else the canonical wiki URL built from the
//     article's own title), their view count, and an honest note that
//     the source reports views, not a claim.
//
// Run: cd server && NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs tests/grounding-trending-citations.test.js

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGroundingActions from "../domains/grounding.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`grounding.${name}`);
  if (!fn) throw new Error(`grounding.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerGroundingActions(register); });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

const FEATURED = {
  news: [{
    story: "A major scientific breakthrough was announced today. Details followed.",
    links: [{ title: "Breakthrough_coverage", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Breakthrough_coverage" } } }],
  }],
  mostread: {
    articles: [
      { title: "Stacy_Keach", titles: { normalized: "Stacy Keach" }, views: 45210, content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Stacy_Keach" } } },
      { titles: { normalized: "No Urls Here" }, views: 900 },
    ],
  },
};

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => ({ ok: true, json: async () => FEATURED });
});

describe("grounding.trendingClaims citations (FIX-grounding-011)", () => {
  it("no item anywhere carries the fabricated 'reporting … is accurate' claim", async () => {
    const r = await call("trendingClaims", ctxA, { limit: 10 });
    assert.equal(r.ok, true, JSON.stringify(r));
    for (const c of r.result.claims) {
      assert.ok(!/is accurate/.test(c.suggestedClaim || ""), `fabricated claim on ${c.headline}`);
    }
  });

  it("topic items carry their citation and an honest note instead of a claim", async () => {
    const r = await call("trendingClaims", ctxA, { limit: 10 });
    const topics = r.result.claims.filter((c) => c.kind === "topic");
    assert.equal(topics.length, 2);
    const keach = topics.find((c) => c.headline === "Stacy Keach");
    assert.equal(keach.suggestedClaim, undefined);
    assert.equal(keach.sourceUrl, "https://en.wikipedia.org/wiki/Stacy_Keach");
    assert.equal(keach.sourceName, "Wikipedia — Most read");
    assert.equal(keach.views, 45210);
    assert.match(keach.note, /reports views, not a claim/);
    const bare = topics.find((c) => c.headline === "No Urls Here");
    assert.equal(bare.sourceUrl, "https://en.wikipedia.org/wiki/No_Urls_Here");
  });

  it("news items keep the story-derived claim and gain the story's own link", async () => {
    const r = await call("trendingClaims", ctxA, { limit: 10 });
    const news = r.result.claims.find((c) => c.kind === "news");
    assert.equal(news.suggestedClaim, "A major scientific breakthrough was announced today");
    assert.equal(news.checkability, "high");
    assert.equal(news.sourceUrl, "https://en.wikipedia.org/wiki/Breakthrough_coverage");
    assert.equal(news.sourceName, "Wikipedia — In the news");
  });
});
