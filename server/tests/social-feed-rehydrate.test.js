// social.feed 500 after a process restart.
//
// Moderation buckets are `{ muted: Set, blocked: Set }` stored inside the
// socialLens Map. The snapshot walker used to leave those Sets as live
// instances on a plain object, and JSON.stringify(Set) is "{}". The next
// boot then executed `new Set({})`, which throws
// "object is not iterable (cannot read property Symbol(Symbol.iterator))"
// for every viewer who had ever opened the feed (opening the feed creates
// a bucket). Reactions that are nested Maps and reposts that are Map values
// already round-tripped; this file pins both the repaired snapshot and the
// already-persisted "{}" shape.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSocialActions from "../domains/social.js";
import { serializeLensState, hydrateLensState } from "../lib/lens-state-persistence.js";
import { aggregateTopicCounts } from "../lib/trending-topics.js";
import logger from "../logger.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`social.${name}`);
  assert.ok(fn, `social.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSocialActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxC = { actor: { userId: "user_c" }, userId: "user_c" };
const ctxV = { actor: { userId: "user_v" }, userId: "user_v" };
const ctxFresh = { actor: { userId: "user_fresh" }, userId: "user_fresh" };
const ctxNew = { actor: { userId: "user_new" }, userId: "user_new" };

function jsonRoundTrip() {
  const persisted = JSON.parse(JSON.stringify(serializeLensState(globalThis._concordSTATE)));
  const next = { dtus: new Map() };
  hydrateLensState(next, persisted);
  globalThis._concordSTATE = next;
  return persisted;
}

describe("social.feed after a JSON snapshot reload", () => {
  it("returns posts for viewers with and without moderation, and keeps reactions, reposts, and mutes", () => {
    const postA = call("createPost", ctxA, { body: "from a #alpha" });
    const postB = call("createPost", ctxB, { body: "from b #beta" });
    assert.equal(postA.ok, true);
    assert.equal(postB.ok, true);
    assert.equal(call("react", ctxC, { postId: postB.result.post.id, reaction: "love" }).ok, true);
    assert.equal(call("repost", ctxC, { postId: postB.result.post.id }).ok, true);
    assert.equal(call("mute", ctxV, { userId: "user_a", muted: true }).ok, true);
    // Opening the feed writes an empty muted/blocked Set. That empty Set is
    // what used to become {} and throw for every later viewer.
    assert.equal(call("feed", ctxFresh, { limit: 10 }).ok, true);

    const persisted = jsonRoundTrip();
    const muted = persisted.socialLens.moderation.entries.find((e) => e[0] === "user_v");
    assert.equal(muted[1].muted.__type, "Set");
    assert.deepEqual(muted[1].muted.values, ["user_a"]);

    for (const limit of [1, 5, 50]) {
      const seen = call("feed", ctxV, { limit });
      assert.equal(seen.ok, true, `limit ${limit}: ${seen.error || ""}`);
      assert.ok(Array.isArray(seen.result.posts));
      assert.ok(seen.result.posts.length <= limit);
      assert.equal(seen.result.posts.some((p) => p.userId === "user_a"), false);
    }
    const full = call("feed", ctxV, { limit: 50 });
    assert.equal(full.result.count, 1);
    assert.equal(full.result.posts[0].userId, "user_b");
    assert.equal(full.result.posts[0].reactionTotal, 1);
    assert.equal(full.result.posts[0].reactionCounts.love, 1);
    assert.equal(full.result.posts[0].repostCount, 1);
    assert.equal(full.result.posts[0].viewerReposted, false);

    const fresh = call("feed", ctxFresh, { limit: 50 });
    assert.equal(fresh.ok, true);
    assert.equal(fresh.result.count, 2);

    const noBucket = call("feed", ctxNew, { limit: 50 });
    assert.equal(noBucket.ok, true);
    assert.equal(noBucket.result.count, 2);
    const loved = noBucket.result.posts.find((p) => p.userId === "user_b");
    assert.equal(loved.viewerReaction, null);
    assert.equal(loved.repostCount, 1);
  });

  it("loads the already-persisted {} moderation shape, plain-object reactions, and repost sets without throwing", () => {
    const legacy = {
      socialLens: {
        posts: {
          __type: "Map",
          entries: [
            ["p1", {
              id: "p1", userId: "user_a", username: "user_a", body: "one",
              hashtags: ["alpha"], media: [], poll: null, quoteOf: null,
              createdAt: "2026-01-02T00:00:00.000Z",
            }],
            ["p2", {
              id: "p2", userId: "user_b", username: "user_b", body: "two",
              hashtags: ["beta", { name: "kept" }, "[object Object]"],
              media: [], poll: null, quoteOf: null,
              createdAt: "2026-01-03T00:00:00.000Z",
            }],
          ],
        },
        reactions: {
          __type: "Map",
          entries: [
            ["p1", { user_c: "like" }],
            ["p2", { __type: "Map", entries: [["user_d", "love"]] }],
          ],
        },
        reposts: {
          __type: "Map",
          entries: [
            ["p1", {}],
            ["p2", ["user_d"]],
            ["p1b", { __type: "Set", values: ["user_c"] }],
          ],
        },
        replies: { __type: "Map", entries: [["p2", [{ id: "r1", body: "hi" }]]] },
        moderation: {
          __type: "Map",
          entries: [["user_v", { muted: {}, blocked: {} }]],
        },
      },
    };
    // p1b is a repost key with no post; feed only walks posts.
    globalThis._concordSTATE = { dtus: new Map() };
    hydrateLensState(globalThis._concordSTATE, legacy);

    for (const limit of [1, 5, 50]) {
      const withMod = call("feed", ctxV, { limit });
      assert.equal(withMod.ok, true, withMod.error || "");
      assert.ok(withMod.result.count >= 1);
      assert.ok(withMod.result.count <= 2);
    }
    const withMod = call("feed", ctxV, { limit: 50 });
    assert.equal(withMod.result.count, 2);
    const p1 = withMod.result.posts.find((p) => p.id === "p1");
    const p2 = withMod.result.posts.find((p) => p.id === "p2");
    assert.equal(p1.reactionTotal, 1);
    assert.equal(p1.reactionCounts.like, 1);
    assert.equal(p1.repostCount, 0);
    assert.equal(p2.reactionTotal, 1);
    assert.equal(p2.reactionCounts.love, 1);
    assert.equal(p2.repostCount, 1);
    assert.equal(p2.replyCount, 1);
    assert.equal(p2.viewerReposted, false);

    const noMod = call("feed", ctxNew, { limit: 50 });
    assert.equal(noMod.ok, true);
    assert.equal(noMod.result.count, 2);
    assert.equal(noMod.result.posts.find((p) => p.id === "p2").repostCount, 1);

    const tags = call("trendingHashtags", ctxV, { limit: 10 });
    assert.equal(tags.ok, true);
    const labels = tags.result.trending.map((t) => t.tag);
    assert.ok(labels.includes("beta"));
    assert.ok(labels.includes("kept"));
    assert.equal(labels.some((t) => /object object/i.test(t)), false);
  });

  it("logs a feed failure and returns it instead of throwing", () => {
    const post = {
      id: "p_boom",
      createdAt: "2026-01-01T00:00:00.000Z",
      body: "x",
      hashtags: [],
    };
    Object.defineProperty(post, "userId", {
      get() { throw new Error("boom-userid"); },
    });
    globalThis._concordSTATE = {
      dtus: new Map(),
      socialLens: { posts: new Map([[post.id, post]]) },
    };
    const calls = [];
    const orig = logger.error;
    logger.error = (...args) => { calls.push(args); };
    try {
      const r = call("feed", ctxV, { limit: 5 });
      assert.equal(r.ok, false);
      assert.match(r.error, /boom-userid/);
      assert.ok(calls.some((c) => c[0] === "social" && String(c[1]).includes("social.feed")));
      assert.match(String(calls.find((c) => c[0] === "social")[2].error), /boom-userid/);
    } finally {
      logger.error = orig;
    }
  });
});

describe("trending topic labels", () => {
  it("does not surface a non-string tag as [object Object], including a 90-post bucket", () => {
    const lists = Array.from({ length: 90 }, () => ["[object Object]", { unexpected: true }]);
    lists.push(["concord", { name: "kept-topic" }, { tag: "[object Object]" }]);
    const topics = aggregateTopicCounts(lists, 20);
    assert.equal(topics.find((t) => t.tag === "concord").count, 1);
    assert.equal(topics.find((t) => t.tag === "kept-topic").count, 1);
    assert.equal(topics.some((t) => /object object/i.test(t.tag)), false);
    assert.ok(topics.every((t) => typeof t.tag === "string"));

    const real = aggregateTopicCounts(
      Array.from({ length: 90 }, () => ["real-topic", "[object Object]"]),
      20,
    );
    assert.deepEqual(real, [{ tag: "real-topic", count: 90 }]);
  });

  it("drops the lowercase [object object] coercion string as well as the original casing", () => {
    const lower = aggregateTopicCounts(
      Array.from({ length: 84 }, () => ["[object object]", "concord"]),
      20,
    );
    assert.deepEqual(lower, [{ tag: "concord", count: 84 }]);

    const mixed = aggregateTopicCounts(
      [["[object Object]"], ["[OBJECT OBJECT]"], ["  [object object]  "], ["kept"]],
      20,
    );
    assert.deepEqual(mixed, [{ tag: "kept", count: 1 }]);
    assert.equal(mixed.some((t) => /object object/i.test(t.tag)), false);
  });
});
