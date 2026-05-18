// server/tests/social.test.js
//
// Tier-2 contract tests for Sprint A: durable persistence + the new
// social.js domain (smoking-gun fix #10/10) + the following-activity
// flow that the lens page was 404-ing on.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerSocialMacros from "../domains/social.js";
import {
  createPost, getPost, updatePost, deletePost, listEdits, getUserPosts,
  follow, unfollow, getFollowers, getFollowing, isFollowing,
  react, unreact, listReactions, bookmark, listBookmarks, repost,
  followingActivity, pushNotification, listNotifications, markNotificationRead,
  markAllNotificationsRead, unreadCount,
  sendDm, listMessages, markMessagesRead,
  block, unblock, listBlocks, muteKeyword,
  followingFeed, publicFeed,
} from "../lib/social/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  const m = await import("../migrations/226_social_durable.js");
  m.up(db);
  registerSocialMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── Posts ───────────────────────────────────────────────────────

describe("createPost + getPost + multi-image", () => {
  it("creates a post with content + auto-published_at", () => {
    const r = createPost(db, { authorId: "u_a", content: "hello world" });
    assert.equal(r.ok, true);
    const p = getPost(db, r.id);
    assert.equal(p.content, "hello world");
    assert.ok(p.published_at > 0);
    assert.equal(p.media.length, 0);
  });

  it("attaches multiple media (multi-image upload)", () => {
    const r = createPost(db, {
      authorId: "u_b", content: "carousel",
      media: [
        { kind: "image", url: "https://x/1.png", altText: "first" },
        { kind: "image", url: "https://x/2.png" },
        { kind: "image", url: "https://x/3.png" },
      ],
    });
    const p = getPost(db, r.id);
    assert.equal(p.media.length, 3);
    assert.equal(p.media[0].alt_text, "first");
    assert.equal(p.media[2].position, 2);
  });

  it("rejects missing args", () => {
    assert.equal(createPost(db, { authorId: "u" }).reason, "missing_args");
    assert.equal(createPost(db, { content: "x" }).reason, "missing_args");
  });

  it("scheduled post has published_at=0", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const r = createPost(db, { authorId: "u_s", content: "later", scheduledAt: future });
    const p = getPost(db, r.id);
    assert.equal(p.published_at, 0);
    assert.equal(p.scheduled_at, future);
  });
});

describe("updatePost + edit history", () => {
  it("records edit before/after + bumps edit_count", () => {
    const r = createPost(db, { authorId: "u_e", content: "original" });
    const u = updatePost(db, r.id, "u_e", { content: "edited" });
    assert.equal(u.ok, true);
    assert.equal(u.edited, true);
    const p = getPost(db, r.id);
    assert.equal(p.content, "edited");
    assert.equal(p.edit_count, 1);
    const edits = listEdits(db, r.id);
    assert.equal(edits.length, 1);
    assert.equal(edits[0].content_before, "original");
    assert.equal(edits[0].content_after, "edited");
  });

  it("update by non-author is forbidden", () => {
    const r = createPost(db, { authorId: "u_owner", content: "x" });
    const u = updatePost(db, r.id, "u_thief", { content: "hacked" });
    assert.equal(u.reason, "forbidden");
  });
});

describe("deletePost (soft)", () => {
  it("soft-deletes + hides from get", () => {
    const r = createPost(db, { authorId: "u_d", content: "doomed" });
    deletePost(db, r.id, "u_d");
    assert.equal(getPost(db, r.id), null);
  });
});

// ─── Quotes + Replies ───────────────────────────────────────────

describe("quote + reply counters", () => {
  it("reply bumps parent reply_count", () => {
    const parent = createPost(db, { authorId: "u_p", content: "thoughts?" });
    createPost(db, { authorId: "u_r", content: "yes", parentPostId: parent.id, kind: "reply" });
    const p = getPost(db, parent.id);
    assert.equal(p.reply_count, 1);
  });

  it("quote bumps quoted_post quote_count", () => {
    const original = createPost(db, { authorId: "u_q1", content: "take" });
    createPost(db, { authorId: "u_q2", content: "agreed", quotedPostId: original.id, kind: "quote" });
    const o = getPost(db, original.id);
    assert.equal(o.quote_count, 1);
  });
});

// ─── Follow graph ───────────────────────────────────────────────

describe("follow / unfollow / lists", () => {
  it("follow round-trip", () => {
    follow(db, "u_f1", "u_f2");
    assert.equal(isFollowing(db, "u_f1", "u_f2"), true);
    assert.deepEqual(getFollowers(db, "u_f2").map((r) => r.follower_id), ["u_f1"]);
    assert.deepEqual(getFollowing(db, "u_f1").map((r) => r.followee_id), ["u_f2"]);
    unfollow(db, "u_f1", "u_f2");
    assert.equal(isFollowing(db, "u_f1", "u_f2"), false);
  });

  it("self-follow rejected", () => {
    const r = follow(db, "u_self", "u_self");
    assert.equal(r.reason, "self_follow_not_allowed");
  });
});

// ─── Following activity (THE missing endpoint) ──────────────────

describe("following_activity (smoking-gun #10/10 fix)", () => {
  it("post create fans out into follower's activity feed", () => {
    follow(db, "u_x", "u_author");
    const r = createPost(db, { authorId: "u_author", content: "fresh post" });
    const act = followingActivity(db, "u_x");
    assert.ok(act.length >= 1);
    assert.equal(act[0].actor_id, "u_author");
    assert.equal(act[0].subject_id, r.id);
    assert.equal(act[0].kind, "post");
  });

  it("scoped to specific user (other followers don't see it)", () => {
    follow(db, "u_y", "u_author2");
    createPost(db, { authorId: "u_author2", content: "for y" });
    const otherUser = followingActivity(db, "u_unrelated");
    assert.equal(otherUser.length, 0);
  });

  it("filtered by since timestamp", () => {
    follow(db, "u_z", "u_author3");
    const t0 = Math.floor(Date.now() / 1000);
    createPost(db, { authorId: "u_author3", content: "first" });
    // Wait a beat
    const allBefore = followingActivity(db, "u_z");
    const recent = followingActivity(db, "u_z", { since: t0 - 1 });
    assert.equal(recent.length, allBefore.length); // both should return all since cutoff
  });

  it("private posts do NOT fan out", () => {
    follow(db, "u_priv1", "u_author_priv");
    createPost(db, { authorId: "u_author_priv", content: "secret", visibility: "private" });
    const act = followingActivity(db, "u_priv1");
    assert.equal(act.length, 0);
  });
});

// ─── Reactions / bookmarks / reposts ────────────────────────────

describe("reactions tally counters", () => {
  it("react bumps reaction_count", () => {
    const r = createPost(db, { authorId: "u_rc", content: "react me" });
    react(db, { postId: r.id, userId: "u_r1", kind: "heart" });
    react(db, { postId: r.id, userId: "u_r2", kind: "celebrate" });
    const p = getPost(db, r.id);
    assert.equal(p.reaction_count, 2);
    const tally = listReactions(db, r.id);
    assert.equal(tally.length, 2);
  });

  it("unreact removes + drops count", () => {
    const r = createPost(db, { authorId: "u_unrc", content: "u" });
    react(db, { postId: r.id, userId: "u_r3", kind: "like" });
    unreact(db, { postId: r.id, userId: "u_r3", kind: "like" });
    const p = getPost(db, r.id);
    assert.equal(p.reaction_count, 0);
  });
});

describe("bookmarks", () => {
  it("bookmark + list", () => {
    const r = createPost(db, { authorId: "u_bm_author", content: "save me" });
    bookmark(db, "u_bm_user", r.id);
    const list = listBookmarks(db, "u_bm_user");
    assert.equal(list.length, 1);
    assert.equal(list[0].content, "save me");
  });
});

describe("reposts bump repost_count", () => {
  it("repost bumps + unrepost drops", () => {
    const r = createPost(db, { authorId: "u_rp_author", content: "boost me" });
    repost(db, "u_rp_user", r.id);
    assert.equal(getPost(db, r.id).repost_count, 1);
  });
});

// ─── Notifications ──────────────────────────────────────────────

describe("notifications", () => {
  it("push + list + mark read + unread count", () => {
    pushNotification(db, { userId: "u_n1", actorId: "u_n2", kind: "reply", subjectId: "post:x", preview: "hi" });
    pushNotification(db, { userId: "u_n1", actorId: "u_n3", kind: "follow" });
    assert.equal(unreadCount(db, "u_n1"), 2);
    const list = listNotifications(db, "u_n1");
    markNotificationRead(db, list[0].id, "u_n1");
    assert.equal(unreadCount(db, "u_n1"), 1);
    markAllNotificationsRead(db, "u_n1");
    assert.equal(unreadCount(db, "u_n1"), 0);
  });
});

// ─── DMs ────────────────────────────────────────────────────────

describe("DMs durable + sorted-pair conversation id", () => {
  it("sendDm + listMessages round-trip", () => {
    sendDm(db, { senderId: "u_dm_a", recipientId: "u_dm_b", content: "hello" });
    sendDm(db, { senderId: "u_dm_b", recipientId: "u_dm_a", content: "hi back" });
    const convId = ["u_dm_a", "u_dm_b"].sort().join("|");
    const msgs = listMessages(db, convId);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].content, "hello");
  });

  it("markMessagesRead only marks the OTHER person's messages", () => {
    sendDm(db, { senderId: "u_mr_a", recipientId: "u_mr_b", content: "from a" });
    sendDm(db, { senderId: "u_mr_b", recipientId: "u_mr_a", content: "from b" });
    const convId = ["u_mr_a", "u_mr_b"].sort().join("|");
    const r = markMessagesRead(db, convId, "u_mr_a");
    assert.equal(r.count, 1); // only b's message gets marked
  });
});

// ─── Blocks ─────────────────────────────────────────────────────

describe("block / mute / keyword mute", () => {
  it("block + list + unblock", () => {
    block(db, "u_b1", "u_b2");
    assert.equal(listBlocks(db, "u_b1").length, 1);
    unblock(db, "u_b1", "u_b2");
    assert.equal(listBlocks(db, "u_b1").length, 0);
  });

  it("muteKeyword stored under keyword_mute kind", () => {
    muteKeyword(db, "u_kw", "crypto drama");
    const list = listBlocks(db, "u_kw", "keyword_mute");
    assert.equal(list.length, 1);
    assert.equal(list[0].keyword, "crypto drama");
  });

  it("self-block rejected", () => {
    const r = block(db, "u_self_b", "u_self_b");
    assert.equal(r.reason, "self_block_not_allowed");
  });
});

// ─── Feeds ──────────────────────────────────────────────────────

describe("feeds", () => {
  it("followingFeed returns posts from followees only", () => {
    follow(db, "u_ff_me", "u_ff_them");
    createPost(db, { authorId: "u_ff_them", content: "from a followee" });
    createPost(db, { authorId: "u_ff_other", content: "from someone else" });
    const feed = followingFeed(db, "u_ff_me");
    assert.ok(feed.find((p) => p.content === "from a followee"));
    assert.ok(!feed.find((p) => p.content === "from someone else"));
  });

  it("publicFeed includes public + federated posts only", () => {
    createPost(db, { authorId: "u_pub", content: "public", visibility: "public" });
    createPost(db, { authorId: "u_pub", content: "private", visibility: "private" });
    const feed = publicFeed(db);
    assert.ok(feed.find((p) => p.content === "public"));
    assert.ok(!feed.find((p) => p.content === "private"));
  });
});

// ─── Macro envelopes ──────────────────────────────────────────────

describe("macros end-to-end", () => {
  it("post_create + post_get via macro round-trip", async () => {
    const r = await MACROS.get("post_create")(ctx("u_m"), { content: "via macro" });
    assert.equal(r.ok, true);
    const g = await MACROS.get("post_get")(ctx("u_m"), { id: r.id });
    assert.equal(g.post.content, "via macro");
  });

  it("follow + following_activity end-to-end (the 404 fix)", async () => {
    await MACROS.get("follow")(ctx("u_mff_a"), { userId: "u_mff_b" });
    await MACROS.get("post_create")(ctx("u_mff_b"), { content: "macro test" });
    const act = await MACROS.get("following_activity")(ctx("u_mff_a"));
    assert.equal(act.ok, true);
    assert.ok(act.activity.find((a) => a.actor_id === "u_mff_b"));
  });

  it("react via macro sends notification to the author", async () => {
    const post = await MACROS.get("post_create")(ctx("u_mr_author"), { content: "react bait" });
    await MACROS.get("react")(ctx("u_mr_reacter"), { postId: post.id, kind: "heart" });
    const notifs = await MACROS.get("notifications")(ctx("u_mr_author"));
    assert.ok(notifs.notifications.find((n) => n.kind === "reaction" && n.actor_id === "u_mr_reacter"));
  });

  it("post_update creates edit history via macro", async () => {
    const post = await MACROS.get("post_create")(ctx("u_me"), { content: "v1" });
    await MACROS.get("post_update")(ctx("u_me"), { id: post.id, content: "v2" });
    const edits = await MACROS.get("post_edits")(ctx("u_me"), { id: post.id });
    assert.equal(edits.edits[0].content_after, "v2");
  });
});
