// Behavioral macro tests for the forum (Discourse + Reddit) lens — the
// PATH-3 registerLensAction surface in server/domains/forum.js the
// /lenses/forum page + its Fm* panels drive through lensRun(...) and the
// inline "Community Analytics" buttons (handleForumAction).
//
// TWO surfaces under test:
//
//  1. The analytical calculators (threadAnalysis · moderationQueue ·
//     communityHealth · topicClustering). THE DEAD-SURFACE CLASS this gate
//     targets: the persisted forum-post artifact's .data is a SINGLE post
//     (no posts/reports/threads arrays), so the inline buttons used to render
//     only "Add thread posts…" in production while shape-only tests passed.
//     FIX (verified here): the page DERIVES the forum-wide arrays/metrics from
//     live posts/comments and passes them as run-action `params`; each handler
//     reads `params.X ?? artifact.data?.X`. The ForumActionPanel single-wrap
//     `{artifact:{data:{posts}}}` (dispatch-peeled to the plain object) lands
//     the same fields on artifact.data. We drive BOTH shapes.
//
//  2. The STATE-backed community substrate (categories / topics / posts /
//     voting / flags / subforums / subscriptions / notifications / awards /
//     saves / reputation / search / trending) the Fm* panels reach via flat
//     lensRun params. We assert EXACT computed values + round-trips, not shape.
//
// Dispatch shapes mirrored exactly:
//   • /api/lens/run        → handler(ctx, {data: peeled}, peeled)   [flat params]
//   • /api/lens/:id/run    → handler(ctx, persistedArtifact, params) [3-ARG]
//
// NOT shape-only: every test feeds KNOWN inputs and asserts EXACT outputs plus
// validation-rejection, degrade-graceful, and fail-CLOSED poison (non-finite
// inputs collapse to FINITE output / guidance — never NaN/Infinity, never throw).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerForumActions from "../domains/forum.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "forum", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Drive a calculator via the persisted-artifact /:id/run path: a single-post
// artifact (.data has no forum-wide arrays) + the page-derived params (3rd arg).
function callAction(name, ctx, params = {}, artifactData = { title: "t", content: "c", author: { username: "you" } }) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`forum.${name} not registered`);
  const artifact = { id: "art_post_1", domain: "forum", type: "post", data: artifactData, meta: {} };
  return fn(ctx, artifact, params);
}

// Drive a macro via the /api/lens/run path: lensRun peels a sole-key
// {artifact:{data}} wrapper, then the dispatch sets artifact.data = peeled and
// passes peeled as 3rd arg. Mirror that exactly so the test goes through the
// SAME normalization the frontend hits.
function callMacro(name, ctx, body = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`forum.${name} not registered`);
  const peeled = peelRedundantArtifactWrapper(body);
  const artifact = { id: null, domain: "forum", type: "domain_action", data: peeled, meta: {} };
  return fn(ctx, artifact, peeled);
}

before(() => { registerForumActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const CALCULATORS = ["threadAnalysis", "moderationQueue", "communityHealth", "topicClustering"];
const STATE_MACROS = [
  "category-create", "category-list", "category-delete",
  "topic-create", "topic-list", "topic-get", "topic-delete", "topic-pin", "topic-lock",
  "post-reply", "post-delete", "vote", "tag-list",
  "flag-create", "flag-queue", "flag-resolve",
  "user-reputation", "forum-search", "forum-dashboard",
  "subforum-create", "subforum-list", "subforum-update-rules", "subforum-add-mod", "subforum-delete",
  "thread-subscribe", "subscription-list", "notification-list", "notification-read",
  "award-catalog", "award-give", "save-toggle", "saved-list",
  "post-history", "user-profile", "trending",
];

// ─────────────────────────────────────────────────────────────────────────────
describe("forum — registration", () => {
  it("registers every analytical calculator the inline buttons reach", () => {
    for (const m of CALCULATORS) assert.ok(ACTIONS.has(m), `forum.${m} not registered`);
  });
  it("registers every STATE macro the Fm* panels reach", () => {
    for (const m of STATE_MACROS) assert.ok(ACTIONS.has(m), `forum.${m} not registered`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forum.threadAnalysis — derived-params + single-wrap, exact values", () => {
  const posts = [
    { author: "alice", content: "hello world" },          // 11 chars
    { author: "bob", content: "this is a longer reply!!" }, // 24 chars
    { author: "alice", content: "again" },                  // 5 chars
  ];

  it("computes totals / authors / avg length / top contributors from params (derived path)", () => {
    const r = callAction("threadAnalysis", ctxA, { posts });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPosts, 3);
    assert.equal(r.result.uniqueAuthors, 2);
    // (11 + 24 + 5) / 3 = 40 / 3 = 13.33 → round 13
    assert.equal(r.result.avgPostLength, 13);
    assert.deepEqual(r.result.topContributors[0], { name: "alice", posts: 2 });
    assert.equal(r.result.health, "needs-engagement");
    assert.ok(Number.isFinite(r.result.avgPostLength));
  });

  it("reaches the SAME fields via the ForumActionPanel single-wrap {artifact:{data:{posts}}}", () => {
    const r = callMacro("threadAnalysis", ctxA, { artifact: { data: { posts } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPosts, 3);
    assert.equal(r.result.avgPostLength, 13);
  });

  it("active-discussion health when >5 posts and >2 authors", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ author: `u${i % 3}`, content: "x" }));
    const r = callAction("threadAnalysis", ctxA, { posts: many });
    assert.equal(r.result.health, "active-discussion");
  });

  it("degrades to guidance (not a crash) on empty / non-array posts", () => {
    assert.equal(callAction("threadAnalysis", ctxA, { posts: [] }).result.message, "Add thread posts to analyze discussion.");
    assert.equal(callAction("threadAnalysis", ctxA, { posts: "nope" }).result.message, "Add thread posts to analyze discussion.");
    assert.equal(callAction("threadAnalysis", ctxA, {}).result.message, "Add thread posts to analyze discussion.");
  });

  it("fail-CLOSED: malformed post rows never throw and avg stays FINITE", () => {
    const r = callAction("threadAnalysis", ctxA, { posts: [{ author: null, content: null }, {}, { content: 123 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPosts, 3);
    assert.ok(Number.isFinite(r.result.avgPostLength));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forum.moderationQueue — exact counts + urgency tiers", () => {
  it("counts pending / resolved + buckets reasons + picks oldest pending", () => {
    const reports = [
      { status: "pending", reason: "spam", date: "2026-06-02T00:00:00Z" },
      { status: "pending", reason: "spam", date: "2026-06-01T00:00:00Z" },
      { status: "resolved", reason: "off_topic", date: "2026-05-30T00:00:00Z" },
      { reason: "harassment", date: "2026-06-03T00:00:00Z" }, // no status → pending
    ];
    const r = callAction("moderationQueue", ctxA, { reports });
    assert.equal(r.result.totalReports, 4);
    assert.equal(r.result.pending, 3);
    assert.equal(r.result.resolved, 1);
    assert.deepEqual(r.result.byReason, { spam: 2, harassment: 1 });
    assert.equal(r.result.oldestPending, "2026-06-01T00:00:00Z");
    assert.equal(r.result.urgency, "low");
  });

  it("urgency escalates with pending volume", () => {
    const mk = (n) => Array.from({ length: n }, () => ({ status: "pending", reason: "spam" }));
    assert.equal(callAction("moderationQueue", ctxA, { reports: mk(4) }).result.urgency, "medium");
    assert.equal(callAction("moderationQueue", ctxA, { reports: mk(11) }).result.urgency, "high");
  });

  it("fail-CLOSED: corrupt dates never throw; empty degrades to zero-counts", () => {
    const r = callAction("moderationQueue", ctxA, { reports: [{ status: "pending", date: "garbage" }, { status: "pending", date: NaN }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.pending, 2);
    const empty = callAction("moderationQueue", ctxA, { reports: [] });
    assert.equal(empty.result.totalReports, 0);
    assert.equal(empty.result.urgency, "low");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forum.communityHealth — exact rates + fail-closed numerics", () => {
  it("computes activity rate + growth + health band from params", () => {
    const r = callAction("communityHealth", ctxA, { activeUsers: 40, totalUsers: 100, postsThisWeek: 60, postsLastWeek: 50 });
    assert.equal(r.result.activityRate, 40);  // 40/100
    assert.equal(r.result.growthRate, 20);    // (60-50)/50*100
    assert.equal(r.result.health, "thriving"); // >30
    assert.ok(Number.isFinite(r.result.activityRate) && Number.isFinite(r.result.growthRate));
  });

  it("health bands: healthy / declining / dormant", () => {
    assert.equal(callAction("communityHealth", ctxA, { activeUsers: 20, totalUsers: 100, postsThisWeek: 1, postsLastWeek: 1 }).result.health, "healthy");
    assert.equal(callAction("communityHealth", ctxA, { activeUsers: 5, totalUsers: 100, postsThisWeek: 1, postsLastWeek: 1 }).result.health, "declining");
    assert.equal(callAction("communityHealth", ctxA, { activeUsers: 1, totalUsers: 100, postsThisWeek: 1, postsLastWeek: 1 }).result.health, "dormant");
  });

  it("fail-CLOSED: Infinity / NaN / 1e999 / 'Infinity' never leak non-finite", () => {
    for (const poison of [Infinity, -Infinity, NaN, "Infinity", "1e999", "not-a-number"]) {
      const r = callAction("communityHealth", ctxA, { activeUsers: poison, totalUsers: poison, postsThisWeek: poison, postsLastWeek: poison });
      assert.equal(r.ok, true, `poison ${String(poison)} should not error`);
      for (const k of ["activeUsers", "totalUsers", "activityRate", "postsThisWeek", "growthRate"]) {
        assert.ok(Number.isFinite(r.result[k]), `${k} non-finite under poison ${String(poison)}: ${r.result[k]}`);
      }
    }
  });

  it("fail-CLOSED: zero/negative denominators never divide by zero", () => {
    const r = callAction("communityHealth", ctxA, { activeUsers: 10, totalUsers: 0, postsThisWeek: 5, postsLastWeek: 0 });
    assert.ok(Number.isFinite(r.result.activityRate));
    assert.ok(Number.isFinite(r.result.growthRate));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forum.topicClustering — exact clusters + shares", () => {
  it("buckets tags into clusters with correct share % and top topic", () => {
    const threads = [
      { tags: ["mixing", "tutorial"] },
      { tags: ["mixing"] },
      { tags: [] },
      { tags: ["news"] },
    ];
    const r = callAction("topicClustering", ctxA, { threads });
    assert.equal(r.result.totalThreads, 4);
    assert.equal(r.result.topTopic, "mixing");
    assert.equal(r.result.uncategorized, 1);
    const mixing = r.result.clusters.find((c) => c.topic === "mixing");
    assert.equal(mixing.threads, 2);
    assert.equal(mixing.share, 50); // 2/4
  });

  it("degrades to guidance on empty / non-array threads", () => {
    assert.equal(callAction("topicClustering", ctxA, { threads: [] }).result.message, "Add threads to cluster by topic.");
    assert.equal(callAction("topicClustering", ctxA, { threads: "x" }).result.message, "Add threads to cluster by topic.");
  });

  it("fail-CLOSED: malformed thread rows never throw; shares stay FINITE", () => {
    const r = callAction("topicClustering", ctxA, { threads: [{}, { tags: null }, { tags: ["a"] }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.uncategorized, 2);
    for (const c of r.result.clusters) assert.ok(Number.isFinite(c.share));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("forum STATE substrate — round-trips + isolation", () => {
  it("category create → list (with topicCount) → delete orphans topics", () => {
    const cat = callMacro("category-create", ctxA, { name: "Production", description: "DAW talk" });
    assert.equal(cat.ok, true);
    const catId = cat.result.category.id;
    const top = callMacro("topic-create", ctxA, { title: "Sidechain tips", categoryId: catId });
    assert.equal(top.result.topic.categoryId, catId);
    const list = callMacro("category-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.categories[0].topicCount, 1);
    const del = callMacro("category-delete", ctxA, { id: catId });
    assert.equal(del.ok, true);
    // topic survives but its category link is orphaned to null
    const tg = callMacro("topic-get", ctxA, { id: top.result.topic.id });
    assert.equal(tg.result.topic.categoryId, null);
  });

  it("rejects an empty topic title", () => {
    const r = callMacro("topic-create", ctxA, { title: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /title required/);
  });

  it("topic → reply (nested tree) → vote → score is exact + lock blocks replies", () => {
    const top = callMacro("topic-create", ctxA, { title: "Root" }).result.topic;
    const r1 = callMacro("post-reply", ctxA, { topicId: top.id, body: "first" });
    assert.equal(r1.ok, true);
    const r2 = callMacro("post-reply", ctxA, { topicId: top.id, parentId: r1.result.post.id, body: "nested" });
    assert.equal(r2.ok, true);
    const got = callMacro("topic-get", ctxA, { id: top.id });
    assert.equal(got.result.replyCount, 2);
    assert.equal(got.result.tree.length, 1);                 // one root post
    assert.equal(got.result.tree[0].replies.length, 1);      // with one nested reply
    // vote on the topic: +1 then 0 (toggle off) is exact
    assert.equal(callMacro("vote", ctxA, { targetType: "topic", targetId: top.id, direction: 1 }).result.score, 1);
    assert.equal(callMacro("vote", ctxA, { targetType: "topic", targetId: top.id, direction: 0 }).result.score, 0);
    // lock the topic → further replies rejected
    callMacro("topic-lock", ctxA, { id: top.id, locked: true });
    const blocked = callMacro("post-reply", ctxA, { topicId: top.id, body: "late" });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /locked/);
  });

  it("fail-CLOSED: vote with non-finite direction never throws + stays integer", () => {
    const top = callMacro("topic-create", ctxA, { title: "V" }).result.topic;
    for (const poison of [Infinity, NaN, "Infinity", "x"]) {
      const r = callMacro("vote", ctxA, { targetType: "topic", targetId: top.id, direction: poison });
      assert.equal(r.ok, true);
      assert.ok(Number.isFinite(r.result.score), `score non-finite under ${String(poison)}`);
    }
  });

  it("flag create → queue → resolve removes it from pending", () => {
    const top = callMacro("topic-create", ctxA, { title: "Reported" }).result.topic;
    const flag = callMacro("flag-create", ctxA, { targetType: "topic", targetId: top.id, reason: "spam" });
    assert.equal(flag.ok, true);
    const q = callMacro("flag-queue", ctxA, {});
    assert.equal(q.result.pendingCount, 1);
    assert.deepEqual(q.result.byReason, { spam: 1 });
    callMacro("flag-resolve", ctxA, { id: flag.result.flag.id, action: "content_removed" });
    const q2 = callMacro("flag-queue", ctxA, {});
    assert.equal(q2.result.pendingCount, 0);
    assert.equal(q2.result.resolvedCount, 1);
  });

  it("reputation tiers up with contributions + karma", () => {
    const base = callMacro("user-reputation", ctxA, {});
    assert.equal(base.result.tier, "new");
    for (let i = 0; i < 5; i++) callMacro("topic-create", ctxA, { title: `T${i}` });
    assert.equal(callMacro("user-reputation", ctxA, {}).result.tier, "basic"); // >=5 contributions
  });

  it("search matches title / body / tag and surfaces reply hits", () => {
    callMacro("topic-create", ctxA, { title: "Reverb chain", body: "long tail plate", tags: ["mixing"] });
    const t2 = callMacro("topic-create", ctxA, { title: "Other" }).result.topic;
    callMacro("post-reply", ctxA, { topicId: t2.id, body: "use reverb sparingly" });
    const r = callMacro("forum-search", ctxA, { query: "reverb" });
    assert.equal(r.ok, true);
    assert.ok(r.result.topicHits >= 2);
    assert.equal(r.result.matchingReplies, 1);
  });

  it("rejects an empty search query", () => {
    const r = callMacro("forum-search", ctxA, { query: "  " });
    assert.equal(r.ok, false);
    assert.match(r.error, /query required/);
  });

  it("trending returns a finite hotScore for every topic and never NaN", () => {
    callMacro("topic-create", ctxA, { title: "Hot", tags: ["x"] });
    callMacro("topic-create", ctxA, { title: "Cold", tags: ["y"] });
    const r = callMacro("trending", ctxA, { limit: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    for (const t of r.result.trending) {
      assert.ok(Number.isFinite(t.hotScore), `hotScore non-finite: ${t.hotScore}`);
      assert.ok(Number.isFinite(t.personalBoost));
    }
  });

  it("fail-CLOSED: trending with a corrupt createdAt keeps hotScore FINITE", () => {
    const top = callMacro("topic-create", ctxA, { title: "Corrupt" }).result.topic;
    // corrupt the stored timestamp the way a bad import could
    globalThis._concordSTATE.forumLens.topics.get("user_a")[0].createdAt = "not-a-date";
    const r = callMacro("trending", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.trending[0].hotScore));
    assert.equal(r.result.trending[0].id, top.id);
  });

  it("award catalog + give attaches a real award to a topic", () => {
    const cat = callMacro("award-catalog", ctxA, {});
    assert.ok(cat.result.awards.length > 0);
    const top = callMacro("topic-create", ctxA, { title: "Award me" }).result.topic;
    const g = callMacro("award-give", ctxA, { kind: "gold", targetType: "topic", targetId: top.id });
    assert.equal(g.ok, true);
    assert.equal(g.result.awards[0].kind, "gold");
    assert.equal(callMacro("award-give", ctxA, { kind: "bogus", targetType: "topic", targetId: top.id }).ok, false);
  });

  it("dashboard reflects real counts", () => {
    callMacro("category-create", ctxA, { name: "C" });
    const top = callMacro("topic-create", ctxA, { title: "D" }).result.topic;
    callMacro("post-reply", ctxA, { topicId: top.id, body: "r" });
    const d = callMacro("forum-dashboard", ctxA, {});
    assert.equal(d.result.categories, 1);
    assert.equal(d.result.topics, 1);
    assert.equal(d.result.replies, 1);
  });

  it("per-user isolation — user_b never sees user_a's topics", () => {
    callMacro("topic-create", ctxA, { title: "Private to A" });
    assert.equal(callMacro("topic-list", ctxA, {}).result.count, 1);
    assert.equal(callMacro("topic-list", ctxB, {}).result.count, 0);
  });
});
