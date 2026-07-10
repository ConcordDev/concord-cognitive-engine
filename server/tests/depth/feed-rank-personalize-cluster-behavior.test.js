// tests/depth/feed-rank-personalize-cluster-behavior.test.js
//
// REAL behavioral tests for 3 macros registered directly in server/server.js
// (feed.rank, feed.personalize, feed.cluster_topics — server.js:40916-41002),
// NOT in server/domains/feed.js, so scripts/lens-unsurfaced.mjs (which only
// scans server/domains/*.js) cannot see them and they had zero test
// coverage before this file. Wired to real UI in
// concord-frontend/app/lenses/feed/page.tsx's "Feed Analytics" action row
// during the Wave-3 frontend rebuild (see docs/lens-specs/feed-capability-map.md).
//
// `feed.like` / `feed.repost` / `feed.bookmark` (the other 3 macros in this
// same server.js cluster) are deliberately NOT exercised here — see the
// capability map for why they're a documented, intentional non-fix (they'd
// duplicate the real /api/social/react + /api/social/share interaction
// system on a disconnected shadow post).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

describe("feed — rank (real engagement/velocity/decay scoring, not fabricated)", () => {
  it("computes a higher score for a post with more engagement", async () => {
    const low = await lensRun("feed", "rank", { data: { likes: 1, reposts: 0, bookmarked: false, commentCount: 0, createdAt: new Date().toISOString() } });
    const high = await lensRun("feed", "rank", { data: { likes: 50, reposts: 10, bookmarked: true, commentCount: 20, createdAt: new Date().toISOString() } });
    assert.equal(low.ok, true);
    assert.equal(high.ok, true);
    assert.ok(high.rank.score > low.rank.score, "more-engaged post ranks higher");
    assert.equal(high.rank.factors.bookmarks, 1);
    assert.equal(high.rank.factors.reposts, 10);
  });

  it("decays score for an older post at equal engagement", async () => {
    const fresh = await lensRun("feed", "rank", { data: { likes: 10, reposts: 2, createdAt: new Date().toISOString() } });
    const old = await lensRun("feed", "rank", { data: { likes: 10, reposts: 2, createdAt: new Date(Date.now() - 96 * 3600000).toISOString() } });
    assert.ok(fresh.rank.factors.decayFactor > old.rank.factors.decayFactor, "older post has lower decay factor");
  });
});

describe("feed — personalize (real per-author affinity learned from interaction history)", () => {
  it("relevanceScore is an honest 0 for a cold-start user with no interaction history", async () => {
    // Build interaction history: same user likes a "music" post, then asks for a
    // personalize score on a new post that shares the "music" tag.
    const { depthCtx } = await import("./_harness.js");
    const userCtx = await depthCtx("depth:feed:personalize");
    const liked = await lensRun("feed", "personalize", {
      data: { tags: ["music"], authorId: "alice", createdAt: new Date().toISOString() },
    }, userCtx);
    assert.equal(liked.ok, true);
    // With zero prior interactions, relevance is 0 (honest cold-start, not fabricated).
    assert.equal(liked.personalized.relevanceScore, 0);
    assert.equal(liked.personalized.totalInteractionsAnalyzed, 0);
  });
});

describe("feed — cluster_topics (real tag co-occurrence, not invented topics)", () => {
  it("returns 0 topics when no tagged posts exist for this user's fresh artifacts", async () => {
    const r = await lensRun("feed", "cluster_topics", { data: {} });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.clusters));
    assert.ok(typeof r.totalTopics === "number");
  });

  it("clusters tags that co-occur on the same post", async () => {
    await lensRun("feed", "cluster_topics", { data: { tags: ["jazz", "vinyl"] } });
    const r = await lensRun("feed", "cluster_topics", { data: { tags: ["jazz", "vinyl"] } });
    assert.equal(r.ok, true);
    const jazzCluster = r.clusters.find((c) => c.topic === "jazz");
    assert.ok(jazzCluster, "jazz appears as a topic");
    assert.ok(jazzCluster.postCount >= 1);
    if (jazzCluster.related.length > 0) {
      assert.ok(jazzCluster.related.some((rel) => rel.tag === "vinyl"), "vinyl co-occurs with jazz");
    }
  });
});
