// Contract tests for server/domains/timeline.js — personal-feed macros.
// Exercises every Facebook-style timeline feature: posts + privacy,
// comments + nested replies, reactions + breakdown, share/repost,
// media albums, profile, memories, and notifications.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTimelineActions from "../domains/timeline.js";

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

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

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
    const post = call("post-create", ctxA, { content: "p" }).result.post;
    const r = call("comment-add", ctxB, { postId: post.id, text: "x", parentId: "nope" });
    assert.equal(r.ok, false);
  });

  it("comment-delete removes the comment and its replies", () => {
    const post = call("post-create", ctxA, { content: "p" }).result.post;
    const c = call("comment-add", ctxA, { postId: post.id, text: "root" });
    call("comment-add", ctxB, { postId: post.id, text: "child", parentId: c.result.comment.id });
    const del = call("comment-delete", ctxA, { postId: post.id, commentId: c.result.comment.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.total, 0);
  });
});

describe("timeline reactions + breakdown", () => {
  it("adds, changes, and toggles a reaction", () => {
    const post = call("post-create", ctxA, { content: "p" }).result.post;
    const add = call("react", ctxB, { postId: post.id, kind: "like" });
    assert.equal(add.result.action, "added");
    const change = call("react", ctxB, { postId: post.id, kind: "love" });
    assert.equal(change.result.action, "changed");
    const off = call("react", ctxB, { postId: post.id, kind: "love" });
    assert.equal(off.result.action, "removed");
    assert.equal(off.result.total, 0);
  });

  it("reactions-breakdown reports who reacted per kind", () => {
    const post = call("post-create", ctxA, { content: "p" }).result.post;
    call("react", ctxA, { postId: post.id, kind: "haha" });
    call("react", ctxB, { postId: post.id, kind: "haha" });
    const r = call("reactions-breakdown", ctxA, { postId: post.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.equal(r.result.counts.haha, 2);
    assert.equal(r.result.byKind.haha.length, 2);
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
    const post = call("post-create", ctxA, { content: "p" }).result.post;
    call("react", ctxB, { postId: post.id, kind: "like" });
    const n = call("notifications-list", ctxA, {});
    assert.equal(n.ok, true);
    assert.equal(n.result.unread, 1);
    assert.equal(n.result.notifications[0].type, "reaction");
  });

  it("a comment generates a notification, and mark-read clears it", () => {
    const post = call("post-create", ctxA, { content: "p" }).result.post;
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
    const post = call("post-create", ctxA, { content: "p" }).result.post;
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
