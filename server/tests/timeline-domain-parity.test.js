// Contract tests for server/domains/timeline.js — personal-feed macros.
// Exercises every Facebook-style timeline feature: posts + privacy,
// comments + nested replies, reactions + breakdown, share/repost,
// media albums, profile, memories, and notifications.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerTimelineActions from "../domains/timeline.js";
import { up as upFriendships } from "../migrations/214_friendships.js";
import { sendFriendRequest, acceptFriendRequest } from "../lib/friendships.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`timeline.${name}`);
  if (!fn) throw new Error(`timeline.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerTimelineActions(register); });

beforeEach(() => {
  // Fresh per-user state for every test.
  globalThis._concordSTATE = {};
});

// Real, migrated friendships table backing every ctx's `db` field — the
// same friend-graph checkPostAccess()/areFriends() reads in
// server/domains/timeline.js. Shared across the whole file (like the
// in-memory _concordSTATE) rather than one per test; individual tests use
// dedicated userIds where friendship status matters so rows from one test
// can never leak into another test's assertions.
const friendshipsDb = new Database(":memory:");
upFriendships(friendshipsDb);

const ctxA = { actor: { userId: "user_a" }, userId: "user_a", db: friendshipsDb };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b", db: friendshipsDb };

describe("timeline.post-create + privacy", () => {
  it("rejects an empty post", () => {
    const r = call("post-create", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("creates a post and defaults privacy to private", () => {
    const r = call("post-create", ctxA, { content: "hello world" });
    assert.equal(r.ok, true);
    assert.equal(r.result.post.privacy, "private");
    assert.equal(r.result.post.authorId, "user_a");
  });

  it("honours explicit privacy + media", () => {
    const r = call("post-create", ctxA, {
      content: "trip pics", privacy: "public",
      media: [{ kind: "photo", url: "http://x/1.jpg" }, { kind: "bogus", url: "y" }],
    });
    assert.equal(r.result.post.privacy, "public");
    assert.equal(r.result.post.media.length, 1);
  });
});

describe("timeline.feed-list (privacy-aware)", () => {
  it("hides another user's private post but shows their public post", () => {
    call("post-create", ctxB, { content: "secret", privacy: "private" });
    call("post-create", ctxB, { content: "public note", privacy: "public" });
    const r = call("feed-list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.posts.length, 1);
    assert.equal(r.result.posts[0].content, "public note");
  });

  it("shows friends-only posts to friends", () => {
    call("post-create", ctxB, { content: "for friends", privacy: "friends" });
    const stranger = call("feed-list", ctxA, {});
    assert.equal(stranger.result.posts.length, 0);
    const friend = call("feed-list", ctxA, { friendIds: ["user_b"] });
    assert.equal(friend.result.posts.length, 1);
  });

  it("author always sees own private posts", () => {
    call("post-create", ctxA, { content: "mine", privacy: "private" });
    const r = call("feed-list", ctxA, {});
    assert.equal(r.result.posts.length, 1);
  });
});

describe("timeline comments + nested replies", () => {
  it("adds a comment and a nested reply, returns a thread tree", () => {
    const post = call("post-create", ctxA, { content: "p", privacy: "public" }).result.post;
    const c = call("comment-add", ctxB, { postId: post.id, text: "nice" });
    assert.equal(c.ok, true);
    const reply = call("comment-add", ctxA, { postId: post.id, text: "thanks", parentId: c.result.comment.id });
    assert.equal(reply.ok, true);
    const list = call("comment-list", ctxA, { postId: post.id });
    assert.equal(list.ok, true);
    assert.equal(list.result.thread.length, 1);
    assert.equal(list.result.thread[0].replies.length, 1);
    assert.equal(list.result.total, 2);
  });

  it("rejects a reply to a missing parent", () => {
    // privacy: "public" — the post must be visible to ctxB, or comment-add's
    // privacy gate (checkPostAccess) would reject it before ever reaching the
    // "missing parent" check this test is actually exercising.
    const post = call("post-create", ctxA, { content: "p", privacy: "public" }).result.post;
    const r = call("comment-add", ctxB, { postId: post.id, text: "x", parentId: "nope" });
    assert.equal(r.ok, false);
  });

  it("comment-delete removes the comment and its replies", () => {
    const post = call("post-create", ctxA, { content: "p", privacy: "public" }).result.post;
    const c = call("comment-add", ctxA, { postId: post.id, text: "root" });
    call("comment-add", ctxB, { postId: post.id, text: "child", parentId: c.result.comment.id });
    const del = call("comment-delete", ctxA, { postId: post.id, commentId: c.result.comment.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.total, 0);
  });
});

describe("timeline reactions + breakdown", () => {
  it("adds, changes, and toggles a reaction", () => {
    // privacy: "public" — a private post (the post-create default) is only
    // reactable by its own author; ctxB reacting to it is the cross-user
    // path this test means to cover.
    const post = call("post-create", ctxA, { content: "p", privacy: "public" }).result.post;
    const add = call("react", ctxB, { postId: post.id, kind: "like" });
    assert.equal(add.result.action, "added");
    const change = call("react", ctxB, { postId: post.id, kind: "love" });
    assert.equal(change.result.action, "changed");
    const off = call("react", ctxB, { postId: post.id, kind: "love" });
    assert.equal(off.result.action, "removed");
    assert.equal(off.result.total, 0);
  });

  it("reactions-breakdown reports who reacted per kind", () => {
    const post = call("post-create", ctxA, { content: "p", privacy: "public" }).result.post;
    call("react", ctxA, { postId: post.id, kind: "haha" });
    call("react", ctxB, { postId: post.id, kind: "haha" });
    const r = call("reactions-breakdown", ctxA, { postId: post.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.equal(r.result.counts.haha, 2);
    assert.equal(r.result.byKind.haha.length, 2);
  });
});

describe("timeline private-post access gate (id-addressed, not just feed-list)", () => {
  // feed-list's privacy filter only gates *listing* a post — a caller who
  // already has a private post's id (e.g. from a stale share, a leaked
  // notification payload, or a guessed base36 id) must still be blocked by
  // every macro that reads/writes that post directly by id. share-post
  // already enforced this; react / comment-add / comment-list /
  // reactions-breakdown did not until this fix.
  it("react is refused on someone else's private post", () => {
    const post = call("post-create", ctxA, { content: "diary", privacy: "private" }).result.post;
    const r = call("react", ctxB, { postId: post.id, kind: "like" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "Post not found.");
  });

  it("the post owner can still react to their own private post", () => {
    const post = call("post-create", ctxA, { content: "diary", privacy: "private" }).result.post;
    const r = call("react", ctxA, { postId: post.id, kind: "like" });
    assert.equal(r.ok, true);
  });

  it("comment-add is refused on someone else's private post", () => {
    const post = call("post-create", ctxA, { content: "diary", privacy: "private" }).result.post;
    const r = call("comment-add", ctxB, { postId: post.id, text: "peeking" });
    assert.equal(r.ok, false);
  });

  it("comment-list returns 'not found' for someone else's private post", () => {
    const post = call("post-create", ctxA, { content: "diary", privacy: "private" }).result.post;
    call("comment-add", ctxA, { postId: post.id, text: "only I can see this" });
    const asOwner = call("comment-list", ctxA, { postId: post.id });
    assert.equal(asOwner.result.total, 1);
    const asStranger = call("comment-list", ctxB, { postId: post.id });
    assert.equal(asStranger.ok, false);
  });

  it("reactions-breakdown is refused on someone else's private post", () => {
    const post = call("post-create", ctxA, { content: "diary", privacy: "private" }).result.post;
    call("react", ctxA, { postId: post.id, kind: "love" });
    const r = call("reactions-breakdown", ctxB, { postId: post.id });
    assert.equal(r.ok, false);
  });

  it("public posts are unaffected — anyone can react/comment/list/breakdown", () => {
    const pub = call("post-create", ctxA, { content: "town crier", privacy: "public" }).result.post;
    assert.equal(call("react", ctxB, { postId: pub.id, kind: "like" }).ok, true);
    assert.equal(call("comment-add", ctxB, { postId: pub.id, text: "hi" }).ok, true);
    assert.equal(call("comment-list", ctxB, { postId: pub.id }).ok, true);
    assert.equal(call("reactions-breakdown", ctxB, { postId: pub.id }).ok, true);
  });
});

describe("timeline friends-tier access gate (id-addressed, not just feed-list)", () => {
  // Companion to the private-tier gate above: a "friends" post must be
  // reachable only by its owner and their *confirmed* friends, verified
  // against the real friend-graph (server/lib/friendships.js, migration
  // 214's `friendships` table) — never by an unverified client claim.
  // Dedicated userIds per test so friendship rows established here can
  // never leak into (or be assumed by) an unrelated test.
  const owner = { actor: { userId: "tl_owner" }, userId: "tl_owner", db: friendshipsDb };
  const friend = { actor: { userId: "tl_friend" }, userId: "tl_friend", db: friendshipsDb };
  const stranger = { actor: { userId: "tl_stranger" }, userId: "tl_stranger", db: friendshipsDb };

  function makeFriends(aId, bId) {
    const req = sendFriendRequest(friendshipsDb, aId, bId);
    assert.equal(req.ok, true);
    if (req.status !== "accepted") {
      const acc = acceptFriendRequest(friendshipsDb, req.id, bId);
      assert.equal(acc.ok, true);
    }
  }

  it("react is refused on a friends-only post for a non-friend, non-author caller", () => {
    const post = call("post-create", owner, { content: "friends only", privacy: "friends" }).result.post;
    const r = call("react", stranger, { postId: post.id, kind: "like" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "Post not found.");
  });

  it("react succeeds for a confirmed friend of the author", () => {
    makeFriends("tl_owner", "tl_friend");
    const post = call("post-create", owner, { content: "friends only", privacy: "friends" }).result.post;
    const r = call("react", friend, { postId: post.id, kind: "like" });
    assert.equal(r.ok, true);
  });

  it("the author can always react to their own friends-only post", () => {
    const post = call("post-create", owner, { content: "friends only", privacy: "friends" }).result.post;
    const r = call("react", owner, { postId: post.id, kind: "like" });
    assert.equal(r.ok, true);
  });

  it("comment-add is refused on a friends-only post for a non-friend caller, and succeeds for a friend", () => {
    makeFriends("tl_owner", "tl_friend");
    const post = call("post-create", owner, { content: "friends only", privacy: "friends" }).result.post;
    const blocked = call("comment-add", stranger, { postId: post.id, text: "peeking" });
    assert.equal(blocked.ok, false);
    const allowed = call("comment-add", friend, { postId: post.id, text: "nice one" });
    assert.equal(allowed.ok, true);
  });

  it("comment-list returns 'not found' for a non-friend but the real thread for a friend and the owner", () => {
    makeFriends("tl_owner", "tl_friend");
    const post = call("post-create", owner, { content: "friends only", privacy: "friends" }).result.post;
    call("comment-add", owner, { postId: post.id, text: "only friends can see this" });
    const asOwner = call("comment-list", owner, { postId: post.id });
    assert.equal(asOwner.result.total, 1);
    const asFriend = call("comment-list", friend, { postId: post.id });
    assert.equal(asFriend.ok, true);
    assert.equal(asFriend.result.total, 1);
    const asStranger = call("comment-list", stranger, { postId: post.id });
    assert.equal(asStranger.ok, false);
  });

  it("reactions-breakdown is refused for a non-friend but allowed for a friend", () => {
    makeFriends("tl_owner", "tl_friend");
    const post = call("post-create", owner, { content: "friends only", privacy: "friends" }).result.post;
    call("react", owner, { postId: post.id, kind: "love" });
    const blocked = call("reactions-breakdown", stranger, { postId: post.id });
    assert.equal(blocked.ok, false);
    const allowed = call("reactions-breakdown", friend, { postId: post.id });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.result.total, 1);
  });

  it("fails closed when no db handle is available to verify friendship", () => {
    const noDbOwner = { actor: { userId: "tl_nodb_owner" }, userId: "tl_nodb_owner" };
    const noDbOther = { actor: { userId: "tl_nodb_other" }, userId: "tl_nodb_other" };
    const post = call("post-create", noDbOwner, { content: "friends only", privacy: "friends" }).result.post;
    const r = call("react", noDbOther, { postId: post.id, kind: "like" });
    assert.equal(r.ok, false);
  });
});

describe("timeline.share-post", () => {
  it("reposts a public post to the sharer's timeline", () => {
    const post = call("post-create", ctxA, { content: "original", privacy: "public" }).result.post;
    const r = call("share-post", ctxB, { postId: post.id, comment: "look at this" });
    assert.equal(r.ok, true);
    assert.equal(r.result.post.sharedFrom.postId, post.id);
    assert.equal(r.result.post.authorId, "user_b");
  });

  it("refuses to share another user's private post", () => {
    const post = call("post-create", ctxA, { content: "hush", privacy: "private" }).result.post;
    const r = call("share-post", ctxB, { postId: post.id });
    assert.equal(r.ok, false);
  });

  // share-post has its own inline privacy check (not routed through
  // checkPostAccess), so it needed the friends-tier fix applied separately
  // — same gap class as react/comment-add/comment-list/reactions-breakdown,
  // verified against the real friend-graph.
  it("refuses to share another user's friends-only post when the sharer is not a confirmed friend", () => {
    const owner = { actor: { userId: "tl_share_owner" }, userId: "tl_share_owner", db: friendshipsDb };
    const stranger = { actor: { userId: "tl_share_stranger" }, userId: "tl_share_stranger", db: friendshipsDb };
    const post = call("post-create", owner, { content: "friends only", privacy: "friends" }).result.post;
    const r = call("share-post", stranger, { postId: post.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "Cannot share a friends-only post.");
  });

  it("allows a confirmed friend to share a friends-only post", () => {
    const owner = { actor: { userId: "tl_share_owner2" }, userId: "tl_share_owner2", db: friendshipsDb };
    const friend = { actor: { userId: "tl_share_friend2" }, userId: "tl_share_friend2", db: friendshipsDb };
    const req = sendFriendRequest(friendshipsDb, "tl_share_owner2", "tl_share_friend2");
    if (req.status !== "accepted") acceptFriendRequest(friendshipsDb, req.id, "tl_share_friend2");
    const post = call("post-create", owner, { content: "friends only", privacy: "friends" }).result.post;
    const r = call("share-post", friend, { postId: post.id });
    assert.equal(r.ok, true);
  });
});

describe("timeline media albums", () => {
  it("creates an album, adds media, and lists it", () => {
    const album = call("album-create", ctxA, { name: "Summer" }).result.album;
    const add = call("album-add-media", ctxA, {
      albumId: album.id,
      media: [{ kind: "photo", url: "http://x/a.jpg" }, { kind: "video", url: "http://x/b.mp4" }],
    });
    assert.equal(add.ok, true);
    assert.equal(add.result.mediaCount, 2);
    const list = call("album-list", ctxA, {});
    assert.equal(list.result.totalAlbums, 1);
    assert.equal(list.result.totalMedia, 2);
  });

  it("rejects media with no valid items", () => {
    const album = call("album-create", ctxA, { name: "X" }).result.album;
    const r = call("album-add-media", ctxA, { albumId: album.id, media: [{ kind: "bad", url: "" }] });
    assert.equal(r.ok, false);
  });
});

describe("timeline profile", () => {
  it("returns a default profile then persists an update", () => {
    const blank = call("profile-get", ctxA, {});
    assert.equal(blank.ok, true);
    assert.equal(blank.result.profile.bio, "");
    const up = call("profile-update", ctxA, {
      bio: "builder", coverUrl: "http://x/cover.jpg",
      about: { location: "Lisbon", work: "Concord" },
    });
    assert.equal(up.ok, true);
    assert.equal(up.result.profile.bio, "builder");
    assert.equal(up.result.profile.about.location, "Lisbon");
    const after = call("profile-get", ctxA, {});
    assert.equal(after.result.profile.coverUrl, "http://x/cover.jpg");
  });
});

describe("timeline.memories (on this day)", () => {
  it("surfaces a post from a prior year on the same month+day", () => {
    const s = (globalThis._concordSTATE.timelineLens ||= {});
    // post-create initialises state Maps; create one first.
    call("post-create", ctxA, { content: "anchor" });
    const today = new Date();
    const lastYear = new Date(today);
    lastYear.setFullYear(today.getFullYear() - 1);
    s.posts.get("user_a")[0].createdAt = lastYear.toISOString();
    const r = call("memories", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.memories[0].yearsAgo, 1);
  });

  it("returns nothing when no past posts match", () => {
    call("post-create", ctxA, { content: "today only" });
    const r = call("memories", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });
});

describe("timeline notifications", () => {
  it("a reaction on your post generates a notification", () => {
    const post = call("post-create", ctxA, { content: "p", privacy: "public" }).result.post;
    call("react", ctxB, { postId: post.id, kind: "like" });
    const n = call("notifications-list", ctxA, {});
    assert.equal(n.ok, true);
    assert.equal(n.result.unread, 1);
    assert.equal(n.result.notifications[0].type, "reaction");
  });

  it("a comment generates a notification, and mark-read clears it", () => {
    const post = call("post-create", ctxA, { content: "p", privacy: "public" }).result.post;
    call("comment-add", ctxB, { postId: post.id, text: "hi" });
    let n = call("notifications-list", ctxA, {});
    assert.equal(n.result.unread, 1);
    const mark = call("notifications-mark-read", ctxA, {});
    assert.equal(mark.result.unread, 0);
    n = call("notifications-list", ctxA, { unreadOnly: true });
    assert.equal(n.result.notifications.length, 0);
  });

  it("tagging a user generates a tag notification", () => {
    call("post-create", ctxA, { content: "with friends", taggedUserIds: ["user_b"] });
    const n = call("notifications-list", ctxB, {});
    assert.equal(n.result.unread, 1);
    assert.equal(n.result.notifications[0].type, "tag");
  });
});

describe("timeline.post-delete cascade", () => {
  it("deletes a post and its comments + reactions", () => {
    const post = call("post-create", ctxA, { content: "p", privacy: "public" }).result.post;
    call("comment-add", ctxB, { postId: post.id, text: "c" });
    call("react", ctxB, { postId: post.id, kind: "like" });
    const del = call("post-delete", ctxA, { postId: post.id });
    assert.equal(del.ok, true);
    const feed = call("feed-list", ctxA, {});
    assert.equal(feed.result.total, 0);
  });

  it("refuses to delete another user's post", () => {
    const post = call("post-create", ctxA, { content: "p" }).result.post;
    const r = call("post-delete", ctxB, { postId: post.id });
    assert.equal(r.ok, false);
  });
});

describe("timeline.feed-list pagination + counts", () => {
  it("honours limit/offset and reports post counts", () => {
    for (let i = 0; i < 5; i += 1) {
      call("post-create", ctxA, { content: `p${i}`, privacy: "public" });
    }
    const page1 = call("feed-list", ctxA, { limit: 2, offset: 0 });
    assert.equal(page1.ok, true);
    assert.equal(page1.result.posts.length, 2);
    assert.equal(page1.result.total, 5);
    const page2 = call("feed-list", ctxA, { limit: 2, offset: 2 });
    assert.equal(page2.result.posts.length, 2);
    assert.notEqual(page1.result.posts[0].id, page2.result.posts[0].id);
  });

  it("surfaces reaction + comment counts inline on each feed post", () => {
    const post = call("post-create", ctxA, { content: "engage", privacy: "public" }).result.post;
    call("react", ctxB, { postId: post.id, kind: "love" });
    call("comment-add", ctxB, { postId: post.id, text: "yo" });
    const feed = call("feed-list", ctxA, {});
    const row = feed.result.posts.find((p) => p.id === post.id);
    assert.equal(row.reactionTotal, 1);
    assert.equal(row.reactionCounts.love, 1);
    assert.equal(row.commentCount, 1);
  });
});

describe("timeline.share-post appears in the sharer's feed", () => {
  it("a shared post is listed in the sharer's own feed-list", () => {
    const post = call("post-create", ctxA, { content: "viral", privacy: "public" }).result.post;
    const share = call("share-post", ctxB, { postId: post.id, comment: "wow", privacy: "public" });
    assert.equal(share.ok, true);
    const feed = call("feed-list", ctxB, {});
    const shared = feed.result.posts.find((p) => p.id === share.result.post.id);
    assert.ok(shared);
    assert.equal(shared.sharedFrom.postId, post.id);
  });
});

describe("timeline.album-list by ownerId", () => {
  it("returns another user's albums when ownerId is supplied", () => {
    call("album-create", ctxA, { name: "A's album" });
    const asB = call("album-list", ctxB, { ownerId: "user_a" });
    assert.equal(asB.ok, true);
    assert.equal(asB.result.totalAlbums, 1);
    const ownB = call("album-list", ctxB, {});
    assert.equal(ownB.result.totalAlbums, 0);
  });
});

describe("timeline analytics macros (project-management)", () => {
  function analytic(name, data, params = {}) {
    const fn = ACTIONS.get(`timeline.${name}`);
    return fn(ctxA, { id: null, data, meta: {} }, params);
  }

  it("criticalPath computes a project duration", () => {
    const r = analytic("criticalPath", {
      tasks: [
        { id: "a", name: "A", duration: 3 },
        { id: "b", name: "B", duration: 2, dependencies: ["a"] },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.projectDuration, 5);
  });

  it("temporalClustering groups events by time gaps", () => {
    const base = Date.parse("2026-01-01T00:00:00Z");
    const r = analytic("temporalClustering", {
      events: [
        { timestamp: new Date(base).toISOString() },
        { timestamp: new Date(base + 1000).toISOString() },
        { timestamp: new Date(base + 86400000).toISOString() },
      ],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.totalClusters >= 1);
  });
});
