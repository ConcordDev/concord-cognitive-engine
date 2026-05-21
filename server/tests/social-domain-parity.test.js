// Contract tests for the social lens — Instagram / X 2026-shape
// engagement substrate in server/domains/social.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSocialActions from "../domains/social.js";

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

function newPost(ctx, params = {}) {
  const r = call("createPost", ctx, { body: "hello #concord world", ...params });
  assert.equal(r.ok, true);
  return r.result.post;
}

describe("social.createPost + feed", () => {
  it("creates a post and surfaces it in the feed", () => {
    const post = newPost(ctxA);
    assert.ok(post.id);
    assert.deepEqual(post.hashtags, ["concord"]);
    const feed = call("feed", ctxB, {});
    assert.equal(feed.result.count, 1);
  });
  it("rejects an empty post", () => {
    assert.equal(call("createPost", ctxA, { body: "" }).ok, false);
  });
});

describe("social — threaded replies", () => {
  it("adds nested replies and returns a tree", () => {
    const post = newPost(ctxA);
    const r1 = call("addReply", ctxB, { postId: post.id, body: "first reply" });
    assert.equal(r1.ok, true);
    const r2 = call("addReply", ctxC, { postId: post.id, body: "nested", parentId: r1.result.reply.id });
    assert.equal(r2.ok, true);
    const tree = call("replyTree", ctxA, { postId: post.id });
    assert.equal(tree.result.total, 2);
    assert.equal(tree.result.tree.length, 1);
    assert.equal(tree.result.tree[0].children.length, 1);
  });
  it("rejects an unknown post / parent", () => {
    assert.equal(call("addReply", ctxB, { postId: "nope", body: "x" }).ok, false);
    const post = newPost(ctxA);
    assert.equal(call("addReply", ctxB, { postId: post.id, body: "x", parentId: "nope" }).ok, false);
  });
});

describe("social — reactions + reposts", () => {
  it("toggles a reaction and counts it", () => {
    const post = newPost(ctxA);
    const on = call("react", ctxB, { postId: post.id, reaction: "love" });
    assert.equal(on.result.viewerReaction, "love");
    assert.equal(on.result.reactionTotal, 1);
    const off = call("react", ctxB, { postId: post.id, reaction: "love" });
    assert.equal(off.result.viewerReaction, null);
  });
  it("rejects an unknown reaction kind", () => {
    const post = newPost(ctxA);
    assert.equal(call("react", ctxB, { postId: post.id, reaction: "wtf" }).ok, false);
  });
  it("toggles a repost", () => {
    const post = newPost(ctxA);
    assert.equal(call("repost", ctxB, { postId: post.id }).result.viewerReposted, true);
    assert.equal(call("repost", ctxB, { postId: post.id }).result.viewerReposted, false);
  });
  it("exposes reaction kinds", () => {
    assert.ok(call("reactionKinds", ctxA, {}).result.kinds.includes("like"));
  });
});

describe("social — DM inbox + conversation", () => {
  it("sends a message and lists it in both inboxes", () => {
    const r = call("sendMessage", ctxA, { to: "user_b", body: "hey" });
    assert.equal(r.ok, true);
    const inboxB = call("inbox", ctxB, {});
    assert.equal(inboxB.result.count, 1);
    assert.equal(inboxB.result.totalUnread, 1);
    const conv = call("conversation", ctxB, { with: "user_a" });
    assert.equal(conv.result.count, 1);
    // reading clears unread
    assert.equal(call("inbox", ctxB, {}).result.totalUnread, 0);
  });
  it("rejects self-messages and empty bodies", () => {
    assert.equal(call("sendMessage", ctxA, { to: "user_a", body: "x" }).ok, false);
    assert.equal(call("sendMessage", ctxA, { to: "user_b", body: "" }).ok, false);
  });
  it("blocks delivery to a user who blocked the sender", () => {
    call("block", ctxB, { userId: "user_a", blocked: true });
    assert.equal(call("sendMessage", ctxA, { to: "user_b", body: "hi" }).ok, false);
  });
});

describe("social — hashtag pages", () => {
  it("filters posts by hashtag and reports contributors", () => {
    newPost(ctxA, { body: "ship it #launch" });
    newPost(ctxB, { body: "also #launch here" });
    newPost(ctxC, { body: "unrelated post" });
    const feed = call("hashtagFeed", ctxA, { tag: "launch" });
    assert.equal(feed.result.count, 2);
    assert.equal(feed.result.contributors, 2);
  });
  it("ranks trending hashtags by post count", () => {
    newPost(ctxA, { body: "#alpha #beta" });
    newPost(ctxB, { body: "#alpha" });
    const t = call("trendingHashtags", ctxA, {});
    assert.equal(t.result.trending[0].tag, "alpha");
    assert.equal(t.result.trending[0].posts, 2);
  });
});

describe("social — post detail + share", () => {
  it("returns a permalink and reply tree", () => {
    const post = newPost(ctxA);
    call("addReply", ctxB, { postId: post.id, body: "comment" });
    const d = call("postDetail", ctxC, { postId: post.id });
    assert.equal(d.ok, true);
    assert.match(d.result.permalink, /\/post\//);
    assert.equal(d.result.replyTree.length, 1);
  });
  it("returns share targets", () => {
    const post = newPost(ctxA);
    const sh = call("shareTargets", ctxB, { postId: post.id });
    assert.ok(sh.result.targets.some((t) => t.id === "copy"));
  });
});

describe("social — media attachments", () => {
  it("validates an image attachment", () => {
    const r = call("registerMedia", ctxA, { kind: "image", url: "https://x.test/a.png", alt: "art" });
    assert.equal(r.ok, true);
    assert.equal(r.result.attachment.kind, "image");
  });
  it("rejects a bad url or kind", () => {
    assert.equal(call("registerMedia", ctxA, { kind: "audio", url: "https://x" }).ok, false);
    assert.equal(call("registerMedia", ctxA, { kind: "image", url: "ftp://x" }).ok, false);
  });
  it("attaches media to a post", () => {
    const post = newPost(ctxA, { media: [{ kind: "image", url: "https://x.test/a.png" }] });
    assert.equal(post.media.length, 1);
  });
});

describe("social — moderation", () => {
  it("mutes, blocks and hides those users from the feed", () => {
    newPost(ctxB, { body: "from b" });
    newPost(ctxC, { body: "from c" });
    call("mute", ctxA, { userId: "user_b", muted: true });
    call("block", ctxA, { userId: "user_c", blocked: true });
    const feed = call("feed", ctxA, {});
    assert.equal(feed.result.count, 0);
    const status = call("moderationStatus", ctxA, {});
    assert.ok(status.result.muted.includes("user_b"));
    assert.ok(status.result.blocked.includes("user_c"));
  });
  it("files a report against a post", () => {
    const post = newPost(ctxB);
    const r = call("report", ctxA, { postId: post.id, reason: "spam", detail: "bot" });
    assert.equal(r.ok, true);
    assert.equal(call("moderationStatus", ctxA, {}).result.reportCount, 1);
  });
  it("rejects an unknown report reason", () => {
    const post = newPost(ctxB);
    assert.equal(call("report", ctxA, { postId: post.id, reason: "vibes" }).ok, false);
  });
});

describe("social — live streaming", () => {
  it("starts a stream, joins it, chats and ends it", () => {
    const st = call("startStream", ctxA, { title: "Live build", kind: "screen" });
    assert.equal(st.ok, true);
    const streamId = st.result.stream.id;
    assert.equal(call("liveStreams", ctxB, {}).result.count, 1);
    const join = call("joinStream", ctxB, { streamId });
    assert.equal(join.result.viewers, 1);
    const chat = call("streamChat", ctxB, { streamId, body: "nice" });
    assert.equal(chat.result.chat.length, 1);
    const end = call("endStream", ctxA, { streamId });
    assert.equal(end.result.status, "ended");
    assert.equal(call("liveStreams", ctxB, {}).result.count, 0);
  });
  it("rejects a second concurrent stream and non-host end", () => {
    const st = call("startStream", ctxA, { title: "one" });
    assert.equal(call("startStream", ctxA, { title: "two" }).ok, false);
    assert.equal(call("endStream", ctxB, { streamId: st.result.stream.id }).ok, false);
  });
});

describe("social — polls + quote-posts", () => {
  it("votes on a poll and tallies results", () => {
    const r = call("createPost", ctxA, {
      body: "best?",
      poll: { question: "Pick one", options: ["A", "B"] },
    });
    assert.equal(r.ok, true);
    const postId = r.result.post.id;
    const vote = call("votePoll", ctxB, { postId, optionId: "opt_0" });
    assert.equal(vote.result.totalVotes, 1);
    call("votePoll", ctxC, { postId, optionId: "opt_1" });
    const res = call("pollResults", ctxA, { postId });
    assert.equal(res.result.totalVotes, 2);
    assert.equal(res.result.options[0].pct, 50);
  });
  it("rejects a poll with fewer than 2 options", () => {
    assert.equal(call("createPost", ctxA, { poll: { question: "q", options: ["only"] } }).ok, false);
  });
  it("creates a quote-post referencing another post", () => {
    const base = newPost(ctxA);
    const quote = call("createPost", ctxB, { body: "great take", quoteOf: base.id });
    assert.equal(quote.ok, true);
    assert.equal(quote.result.post.quoteOf, base.id);
    const detail = call("postDetail", ctxC, { postId: quote.result.post.id });
    assert.ok(detail.result.quoted);
  });
  it("rejects double-voting the same option", () => {
    const r = call("createPost", ctxA, { body: "q", poll: { question: "q", options: ["A", "B"] } });
    const postId = r.result.post.id;
    call("votePoll", ctxB, { postId, optionId: "opt_0" });
    assert.equal(call("votePoll", ctxB, { postId, optionId: "opt_0" }).ok, false);
  });
});
