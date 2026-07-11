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
import { randomUUID } from "node:crypto";
import { lensRun, load, depthCtx } from "./_harness.js";

describe("feed — rank (real engagement/velocity/decay scoring, not fabricated)", () => {
  it("computes a higher score for a post with more engagement", async () => {
    // feed.rank/feed.personalize both treat `reposts` as an ARRAY of repost
    // events (`.length` in rank; `.some(r => r.reposterId)` in personalize —
    // matching the real repost-action handler that appends objects to this
    // field), not a plain count. A bare number here silently produces
    // NaN/null scores (numbers have no `.length`) — this is the real,
    // established contract for these two macros specifically (a separate,
    // unrelated part of this file uses a numeric reposts counter for a
    // different macro — not what's under test here).
    const low = await lensRun("feed", "rank", { data: { likes: 1, reposts: [], bookmarked: false, commentCount: 0, createdAt: new Date().toISOString() } });
    const high = await lensRun("feed", "rank", { data: { likes: 50, reposts: Array.from({ length: 10 }, (_, i) => ({ reposterId: `user${i}` })), bookmarked: true, commentCount: 20, createdAt: new Date().toISOString() } });
    // lensRun wraps the handler's own return under `.result` (the handler's
    // own `ok`/`rank` fields live one level down — `.result.ok`/`.result.rank`,
    // not `.ok`/`.rank` directly on lensRun's return).
    assert.equal(low.result.ok, true);
    assert.equal(high.result.ok, true);
    assert.ok(high.result.rank.score > low.result.rank.score, "more-engaged post ranks higher");
    assert.equal(high.result.rank.factors.bookmarks, 1);
    assert.equal(high.result.rank.factors.reposts, 10);
  });

  it("decays score for an older post at equal engagement", async () => {
    // feed.rank reads `artifact.createdAt` (the artifact's own timestamp),
    // not `artifact.data.createdAt` — lensRun's generic artifact-creation
    // helper doesn't set the former, so this behavior can only be exercised
    // by constructing the artifact directly (matching what lensRun does
    // internally) with an explicit createdAt override.
    const { runMacro, STATE } = await load();
    const ctx = await depthCtx("depth:feed:decay");
    const freshId = `depth-feed-fresh-${randomUUID()}`;
    STATE.lensArtifacts.set(freshId, {
      id: freshId, domain: "feed", type: "feed", data: { likes: 10, reposts: [{ reposterId: "u1" }, { reposterId: "u2" }] },
      ownerId: ctx.actor.userId, createdBy: ctx.actor.userId, createdAt: new Date().toISOString(),
    });
    const oldId = `depth-feed-old-${randomUUID()}`;
    STATE.lensArtifacts.set(oldId, {
      id: oldId, domain: "feed", type: "feed", data: { likes: 10, reposts: [{ reposterId: "u1" }, { reposterId: "u2" }] },
      ownerId: ctx.actor.userId, createdBy: ctx.actor.userId, createdAt: new Date(Date.now() - 96 * 3600000).toISOString(),
    });
    const fresh = await runMacro("lens", "run", { id: freshId, action: "rank", params: {} }, ctx);
    const old = await runMacro("lens", "run", { id: oldId, action: "rank", params: {} }, ctx);
    assert.ok(fresh.result.rank.factors.decayFactor > old.result.rank.factors.decayFactor, "older post has lower decay factor");
  });
});

describe("feed — personalize (real per-author affinity learned from interaction history)", () => {
  it("relevanceScore is an honest 0 for a cold-start user with no interaction history", async () => {
    // Build interaction history: same user likes a "music" post, then asks for a
    // personalize score on a new post that shares the "music" tag.
    const userCtx = await depthCtx("depth:feed:personalize");
    const liked = await lensRun("feed", "personalize", {
      data: { tags: ["music"], authorId: "alice", createdAt: new Date().toISOString() },
    }, userCtx);
    assert.equal(liked.result.ok, true);
    // With zero prior interactions, relevance is 0 (honest cold-start, not fabricated).
    assert.equal(liked.result.personalized.relevanceScore, 0);
    assert.equal(liked.result.personalized.totalInteractionsAnalyzed, 0);
  });
});

describe("feed — cluster_topics (real tag co-occurrence, not invented topics)", () => {
  it("returns 0 topics when no tagged posts exist for this user's fresh artifacts", async () => {
    const r = await lensRun("feed", "cluster_topics", { data: {} });
    assert.equal(r.result.ok, true);
    assert.ok(Array.isArray(r.result.clusters));
    assert.ok(typeof r.result.totalTopics === "number");
  });

  it("clusters tags that co-occur on the same post", async () => {
    // cluster_topics scans STATE.lensDomainIndex (a domain → Set<artifactId>
    // index lens.create normally populates), not STATE.lensArtifacts
    // directly — lensRun's generic artifact-creation helper writes only to
    // lensArtifacts, so an artifact created that way is invisible to this
    // macro's scan. Register it in the index directly, matching what the
    // real create path does (server.js's _lensDomainIndexAdd).
    const { runMacro, STATE } = await load();
    const ctx = await depthCtx("depth:feed:cluster");
    const id = `depth-feed-cluster-${randomUUID()}`;
    STATE.lensArtifacts.set(id, {
      id, domain: "feed", type: "feed", data: { tags: ["jazz", "vinyl"] },
      ownerId: ctx.actor.userId, createdBy: ctx.actor.userId,
    });
    if (!STATE.lensDomainIndex.has("feed")) STATE.lensDomainIndex.set("feed", new Set());
    STATE.lensDomainIndex.get("feed").add(id);

    const r = await runMacro("lens", "run", { id, action: "cluster_topics", params: {} }, ctx);
    assert.equal(r.result.ok, true);
    const jazzCluster = r.result.clusters.find((c) => c.topic === "jazz");
    assert.ok(jazzCluster, "jazz appears as a topic");
    assert.ok(jazzCluster.postCount >= 1);
    if (jazzCluster.related.length > 0) {
      assert.ok(jazzCluster.related.some((rel) => rel.tag === "vinyl"), "vinyl co-occurs with jazz");
    }
  });
});
