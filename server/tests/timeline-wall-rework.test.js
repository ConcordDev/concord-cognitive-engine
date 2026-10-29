// Behaviour tests for the Timeline wall rework (Review 3's frozen
// timeline.md §7 slices S-TL-1…S-TL-11; built by B5 on
// feat/lens-timeline-redesign). Each slice appends its group here.
//
// The friendships fixture is a pure-JS fake of the exact SQL shapes
// server/lib/friendships.js issues (the same approach as
// friendships.test.js) so this suite runs anywhere — including
// sandboxes without better-sqlite3, which timeline-domain-parity
// requires. Friendship itself is REAL: rows are created through
// sendFriendRequest/acceptFriendRequest and read back through
// areFriends inside checkPostAccess — nothing is stubbed at the
// domain layer.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTimelineActions from "../domains/timeline.js";
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
  globalThis._concordSTATE = {};
});

// ── Fake friendships db (SQL-shape fake, per friendships.test.js) ──────
function makeFriendDb() {
  const rows = new Map();
  const norm = (sql) => sql.replace(/\s+/g, " ").trim();
  function execute(sql, args, mode) {
    if (sql.startsWith("SELECT * FROM friendships WHERE id =")) {
      return mode === "all" ? [] : rows.get(args[0]) || null;
    }
    if (sql.startsWith("SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?)")) {
      const [a, b, c, d] = args;
      for (const r of rows.values()) {
        if ((r.requester_id === a && r.addressee_id === b) || (r.requester_id === c && r.addressee_id === d)) {
          return mode === "all" ? [r] : r;
        }
      }
      return mode === "all" ? [] : null;
    }
    if (sql.startsWith("INSERT INTO friendships")) {
      const [id, requesterId, addresseeId] = args;
      const status = sql.includes("'blocked'") ? "blocked" : "pending";
      rows.set(id, {
        id, requester_id: requesterId, addressee_id: addresseeId, status,
        created_at: 1, responded_at: status === "blocked" ? 1 : null,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE friendships SET status = 'accepted'")) {
      const row = rows.get(args[0]);
      if (row) { row.status = "accepted"; row.responded_at = 2; }
      return { changes: row ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE friendships SET status = 'declined'")) {
      const row = rows.get(args[0]);
      if (row) { row.status = "declined"; row.responded_at = 2; }
      return { changes: row ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE friendships SET status = 'blocked'")) {
      const row = rows.get(args[0]);
      if (row) { row.status = "blocked"; row.responded_at = 2; }
      return { changes: row ? 1 : 0 };
    }
    if (sql.startsWith("DELETE FROM friendships")) {
      return { changes: rows.delete(args[0]) ? 1 : 0 };
    }
    throw new Error(`fake friendships db: unhandled SQL: ${sql}`);
  }
  return {
    prepare(sql) {
      const n = norm(sql);
      return {
        run: (...args) => execute(n, args, "run"),
        get: (...args) => execute(n, args, "get"),
        all: (...args) => execute(n, args, "all"),
      };
    },
    _rows: rows,
  };
}

const friendDb = makeFriendDb();
const asUser = (userId, db = friendDb) => ({ actor: { userId }, userId, db });

function befriend(a, b) {
  const sent = sendFriendRequest(friendDb, a, b);
  assert.equal(sent.ok, true, `friend request ${a}->${b}`);
  const accepted = acceptFriendRequest(friendDb, sent.id, b);
  assert.equal(accepted.ok, true, `friend accept by ${b}`);
}

// ── S-TL-2: post-update ────────────────────────────────────────────────
describe("S-TL-2 timeline.post-update", () => {
  it("edits content, stamps editedAt, and records the prior version", () => {
    const me = asUser("pu_author");
    const created = call("post-create", me, { content: "first draft", privacy: "public" });
    const postId = created.result.post.id;
    const r = call("post-update", me, { postId, content: "second draft" });
    assert.equal(r.ok, true);
    assert.equal(r.result.edited, true);
    assert.equal(r.result.post.content, "second draft");
    assert.ok(r.result.post.editedAt, "editedAt stamped");
    assert.equal(r.result.post.editHistory.length, 1);
    assert.equal(r.result.post.editHistory[0].content, "first draft");
    assert.equal(r.result.post.editHistory[0].privacy, "public");
  });

  it("changes audience independently of content", () => {
    const me = asUser("pu_aud");
    const created = call("post-create", me, { content: "same words", privacy: "public" });
    const postId = created.result.post.id;
    const r = call("post-update", me, { postId, privacy: "friends" });
    assert.equal(r.ok, true);
    assert.equal(r.result.post.privacy, "friends");
    assert.equal(r.result.post.content, "same words");
    assert.equal(r.result.post.editHistory[0].privacy, "public");
  });

  it("REJECTS an unknown privacy instead of silently flipping the audience", () => {
    const me = asUser("pu_bad");
    const created = call("post-create", me, { content: "keep me public", privacy: "public" });
    const postId = created.result.post.id;
    const r = call("post-update", me, { postId, privacy: "everyone" });
    assert.equal(r.ok, false);
    assert.match(r.error, /Unknown privacy/);
    const feed = call("feed-list", me, {});
    const post = feed.result.posts.find((p) => p.id === postId);
    assert.equal(post.privacy, "public");
    assert.equal(post.editedAt, undefined);
  });

  it("enforces the content-or-media invariant on edit", () => {
    const me = asUser("pu_empty");
    const created = call("post-create", me, { content: "words only", privacy: "public" });
    const postId = created.result.post.id;
    const r = call("post-update", me, { postId, content: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /content or media/);
  });

  it("refuses a non-author with the same error as a missing post (no oracle)", () => {
    const author = asUser("pu_owner");
    const other = asUser("pu_other");
    const created = call("post-create", author, { content: "mine", privacy: "public" });
    const postId = created.result.post.id;
    const notYours = call("post-update", other, { postId, content: "hijack" });
    const missing = call("post-update", other, { postId: "pst_missing", content: "hijack" });
    assert.equal(notYours.ok, false);
    assert.equal(missing.ok, false);
    assert.equal(notYours.error, missing.error);
    assert.equal(notYours.error, "Post not found or not yours.");
    const feed = call("feed-list", author, {});
    assert.equal(feed.result.posts.find((p) => p.id === postId).content, "mine");
  });

  it("a no-op edit records no history and reports edited:false", () => {
    const me = asUser("pu_noop");
    const created = call("post-create", me, { content: "unchanged", privacy: "friends" });
    const postId = created.result.post.id;
    const r = call("post-update", me, { postId, content: "unchanged", privacy: "friends" });
    assert.equal(r.ok, true);
    assert.equal(r.result.edited, false);
    assert.equal(r.result.post.editHistory, undefined);
    assert.equal(r.result.post.editedAt, undefined);
  });

  it("edits media with the same kind filter as post-create, and history accumulates newest-last", () => {
    const me = asUser("pu_media");
    const created = call("post-create", me, {
      content: "v1", privacy: "public",
      media: [{ kind: "photo", url: "http://x/1.jpg" }],
    });
    const postId = created.result.post.id;
    const r1 = call("post-update", me, {
      postId,
      media: [{ kind: "photo", url: "http://x/2.jpg" }, { kind: "bogus", url: "y" }],
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.post.media.length, 1);
    assert.equal(r1.result.post.media[0].url, "http://x/2.jpg");
    const r2 = call("post-update", me, { postId, content: "v2" });
    assert.equal(r2.result.post.editHistory.length, 2);
    assert.equal(r2.result.post.editHistory[0].media[0].url, "http://x/1.jpg");
    assert.equal(r2.result.post.editHistory[1].content, "v1");
  });
});

// ── S-TL-2: comment-update ─────────────────────────────────────────────
describe("S-TL-2 timeline.comment-update", () => {
  function seedComment() {
    const author = asUser("cu_author");
    const commenter = asUser("cu_commenter");
    const post = call("post-create", author, { content: "post", privacy: "public" }).result.post;
    const comment = call("comment-add", commenter, { postId: post.id, text: "original words" }).result.comment;
    return { author, commenter, post, comment };
  }

  it("edits the text, stamps editedAt, keeps the prior text in history", () => {
    const { commenter, post, comment } = seedComment();
    const r = call("comment-update", commenter, { postId: post.id, commentId: comment.id, text: "better words" });
    assert.equal(r.ok, true);
    assert.equal(r.result.edited, true);
    const thread = call("comment-list", commenter, { postId: post.id });
    const shown = thread.result.thread.find((c) => c.id === comment.id);
    assert.equal(shown.text, "better words");
    assert.ok(shown.editedAt);
    assert.equal(shown.editHistory.length, 1);
    assert.equal(shown.editHistory[0].text, "original words");
  });

  it("refuses a non-author with comment-delete's own line", () => {
    const { author, post, comment } = seedComment();
    const r = call("comment-update", author, { postId: post.id, commentId: comment.id, text: "moderated" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "Not your comment.");
  });

  it("refuses empty text and unknown comments", () => {
    const { commenter, post, comment } = seedComment();
    const empty = call("comment-update", commenter, { postId: post.id, commentId: comment.id, text: "  " });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /text required/i);
    const missing = call("comment-update", commenter, { postId: post.id, commentId: "cmt_missing", text: "x" });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "Comment not found.");
  });
});

// ── S-TL-3: media URL honesty (F14) ────────────────────────────────────
// Uploaded media arrives as an artifact stream path; linked media as
// an absolute http(s) URL. Anything else is refused at attach time
// with a stated reason — no silent broken-image publishes.
describe("S-TL-3 timeline media URL honesty (F14)", () => {
  it("accepts an artifact stream path and an https URL", () => {
    const me = asUser("mu_ok");
    const a = call("post-create", me, {
      content: "uploaded", privacy: "public",
      media: [{ kind: "photo", url: "/api/artifact/artifact_abc123/stream" }],
    });
    assert.equal(a.ok, true);
    const b = call("post-create", me, {
      content: "linked", privacy: "public",
      media: [{ kind: "video", url: "https://cdn.example.com/clip.mp4" }],
    });
    assert.equal(b.ok, true);
  });

  it("refuses a bare word, a javascript: URL, and a data: URL at post-create — nothing is published", () => {
    const me = asUser("mu_bad");
    for (const url of ["notaurl", "javascript:alert(1)", "data:image/png;base64,AAAA"]) {
      const r = call("post-create", me, {
        content: "x", privacy: "public", media: [{ kind: "photo", url }],
      });
      assert.equal(r.ok, false, url);
      assert.match(r.error, /Media URL can't be used/);
    }
    const feed = call("feed-list", me, {});
    assert.equal(feed.result.total, 0);
  });

  it("refuses an unusable URL on post-update and album-add-media too", () => {
    const me = asUser("mu_more");
    const post = call("post-create", me, { content: "clean", privacy: "public" }).result.post;
    const upd = call("post-update", me, {
      postId: post.id, media: [{ kind: "photo", url: "htp:/broken" }],
    });
    assert.equal(upd.ok, false);
    assert.match(upd.error, /Media URL can't be used/);
    const album = call("album-create", me, { name: "Pics" }).result.album;
    const add = call("album-add-media", me, {
      albumId: album.id, media: [{ kind: "photo", url: "still not a url" }],
    });
    assert.equal(add.ok, false);
    assert.match(add.error, /Media URL can't be used/);
    const list = call("album-list", me, {});
    assert.equal(list.result.albums[0].media.length, 0);
  });
});

// ── S-TL-4: names, not UUIDs (F5/F7) ───────────────────────────────────
// A db that answers BOTH the friendships SQL and the users-table
// identity SQL lookupUserIdentity issues (PRAGMA + username select).
function makeIdentityDb(users) {
  const inner = makeFriendDb();
  return {
    prepare(sql) {
      const n = sql.replace(/\s+/g, " ").trim();
      if (n.startsWith("PRAGMA")) {
        return { all: () => [{ name: "username" }, { name: "display_name" }] };
      }
      if (n.startsWith("SELECT username")) {
        return {
          get: (id) => {
            const u = users.get(id);
            return u ? { username: u.username, displayName: u.displayName || null } : undefined;
          },
        };
      }
      return inner.prepare(sql);
    },
    _rows: inner._rows,
  };
}

describe("S-TL-4 timeline names (F5/F7)", () => {
  const users = new Map([
    ["nm_ada", { username: "ada", displayName: "Ada Lovelace" }],
    ["nm_grace", { username: "grace", displayName: null }],
  ]);
  const idb = makeIdentityDb(users);
  const ada = asUser("nm_ada", idb);
  const grace = asUser("nm_grace", idb);
  const anon = asUser("nm_nobody", idb);

  it("feed posts carry the author's account name; an unnamed author resolves to null, never the UUID", () => {
    call("post-create", ada, { content: "ada post", privacy: "public" });
    call("post-create", grace, { content: "grace post", privacy: "public" });
    call("post-create", anon, { content: "mystery post", privacy: "public" });
    const feed = call("feed-list", grace, {});
    const byContent = new Map(feed.result.posts.map((p) => [p.content, p]));
    assert.equal(byContent.get("ada post").authorDisplayName, "Ada Lovelace");
    assert.equal(byContent.get("grace post").authorDisplayName, "grace");
    assert.equal(byContent.get("mystery post").authorDisplayName, null);
  });

  it("a name set on the Timeline profile wins over the account name, and clearing restores it", () => {
    call("post-create", ada, { content: "ada post", privacy: "public" });
    const before = call("profile-get", ada, {});
    assert.equal(before.result.profile.displayName, "Ada Lovelace");
    assert.equal(before.result.profile.username, "ada");
    call("profile-update", ada, { displayName: "Ada L." });
    const set = call("profile-get", ada, {});
    assert.equal(set.result.profile.displayName, "Ada L.");
    const feed = call("feed-list", grace, {});
    assert.equal(feed.result.posts.find((p) => p.content === "ada post").authorDisplayName, "Ada L.");
    call("profile-update", ada, { displayName: "" });
    const cleared = call("profile-get", ada, {});
    assert.equal(cleared.result.profile.displayName, "Ada Lovelace");
  });

  it("reactions breakdown and notifications carry names too", () => {
    const post = call("post-create", grace, { content: "react to me", privacy: "public" }).result.post;
    call("react", ada, { postId: post.id, kind: "love" });
    const bd = call("reactions-breakdown", grace, { postId: post.id });
    assert.equal(bd.result.reactors[0].displayName, "Ada Lovelace");
    const notifs = call("notifications-list", grace, {});
    const reaction = notifs.result.notifications.find((n) => n.type === "reaction");
    assert.ok(reaction, "reaction notification exists");
    assert.equal(reaction.actorDisplayName, "Ada Lovelace");
  });

  it("shared posts name the original author, and tags resolve to names", () => {
    const original = call("post-create", ada, {
      content: "tagged", privacy: "public", taggedUserIds: ["nm_grace", "nm_nobody"],
    }).result.post;
    call("share-post", grace, { postId: original.id, privacy: "public" });
    const feed = call("feed-list", grace, {});
    const shared = feed.result.posts.find((p) => p.sharedFrom?.postId === original.id);
    assert.ok(shared, "share present in feed");
    assert.equal(shared.sharedFrom.authorDisplayName, "Ada Lovelace");
    const tagged = feed.result.posts.find((p) => p.id === original.id);
    assert.deepEqual(tagged.taggedDisplayNames, ["grace", "Member"]);
  });
});

// ── S-TL-5: albums finished as objects + per-album audience (F6) ──────
describe("S-TL-5 timeline albums (F6)", () => {
  const ada = asUser("al_ada");
  const friend = asUser("al_friend");
  const stranger = asUser("al_stranger");
  befriend("al_ada", "al_friend");

  const mkAlbum = (ctx, name, privacy) =>
    call("album-create", ctx, { name, privacy }).result.album;
  const addPhoto = (ctx, albumId, url) =>
    call("album-add-media", ctx, { albumId, media: [{ kind: "photo", url }] });

  it("album audiences gate album-list per viewer: owner all, friend public+friends, stranger public only", () => {
    mkAlbum(ada, "Pub", "public");
    mkAlbum(ada, "Fri", "friends");
    mkAlbum(ada, "Pri", "private");
    const invalid = mkAlbum(ada, "Bogus tier", "everyone");
    assert.equal(invalid.privacy, "private", "unknown tier at create falls back to private");
    const names = (r) => r.result.albums.map((a) => a.name).sort();
    assert.deepEqual(names(call("album-list", ada, {})), ["Bogus tier", "Fri", "Pri", "Pub"]);
    assert.deepEqual(names(call("album-list", friend, { ownerId: "al_ada" })), ["Fri", "Pub"]);
    assert.deepEqual(names(call("album-list", stranger, { ownerId: "al_ada" })), ["Pub"]);
  });

  it("album-update renames and re-tiers for the owner only; unknown tier and empty name refused", () => {
    const album = mkAlbum(ada, "Old name", "private");
    const upd = call("album-update", ada, { albumId: album.id, name: "New name", privacy: "friends", description: "d" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.album.name, "New name");
    assert.equal(upd.result.album.privacy, "friends");
    assert.equal(call("album-update", stranger, { albumId: album.id, name: "Hijack" }).ok, false);
    const badTier = call("album-update", ada, { albumId: album.id, privacy: "everyone" });
    assert.equal(badTier.ok, false);
    assert.match(badTier.error, /Unknown privacy/);
    assert.equal(call("album-update", ada, { albumId: album.id, name: "  " }).ok, false);
    const after = call("album-list", ada, {}).result.albums.find((a) => a.id === album.id);
    assert.equal(after.name, "New name", "refused edits changed nothing");
    assert.equal(after.privacy, "friends");
  });

  it("set-cover and remove-media behave: cover falls back when its item is removed", () => {
    const album = mkAlbum(ada, "Pics", "private");
    addPhoto(ada, album.id, "https://x.test/1.jpg");
    addPhoto(ada, album.id, "https://x.test/2.jpg");
    let cur = call("album-list", ada, {}).result.albums.find((a) => a.id === album.id);
    assert.equal(cur.coverUrl, "https://x.test/1.jpg", "first add is the implicit cover");
    const [m1, m2] = cur.media;
    const set = call("album-set-cover", ada, { albumId: album.id, mediaId: m2.id });
    assert.equal(set.result.album.coverUrl, "https://x.test/2.jpg");
    assert.equal(call("album-set-cover", stranger, { albumId: album.id, mediaId: m1.id }).ok, false);
    assert.equal(call("album-set-cover", ada, { albumId: album.id, mediaId: "nope" }).ok, false);
    const rm = call("album-remove-media", ada, { albumId: album.id, mediaId: m2.id });
    assert.equal(rm.result.album.coverUrl, "https://x.test/1.jpg", "cover fell back to the remaining item");
    const rmLast = call("album-remove-media", ada, { albumId: album.id, mediaId: m1.id });
    assert.equal(rmLast.result.album.coverUrl, null);
    assert.equal(rmLast.result.album.media.length, 0);
  });

  it("album-delete removes the album for the owner only and reports what went with it", () => {
    const album = mkAlbum(ada, "Doomed", "public");
    addPhoto(ada, album.id, "https://x.test/d.jpg");
    assert.equal(call("album-delete", stranger, { albumId: album.id }).ok, false);
    const del = call("album-delete", ada, { albumId: album.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.mediaCount, 1);
    assert.equal(call("album-list", ada, {}).result.albums.some((a) => a.id === album.id), false);
  });
});

// ── S-TL-6: comment reactions, share counts, Memories heading ─────────
describe("S-TL-6 timeline small completions (F9/F18)", () => {
  const ada = asUser("sc_ada");
  const bob = asUser("sc_bob");
  const stranger = asUser("sc_stranger");

  it("comment reactions toggle like post reactions and present on the thread", () => {
    const post = call("post-create", ada, { content: "host post", privacy: "public" }).result.post;
    const comment = call("comment-add", bob, { postId: post.id, text: "nice" }).result.comment;
    const added = call("comment-react", ada, { postId: post.id, commentId: comment.id, kind: "love" });
    assert.equal(added.result.action, "added");
    assert.equal(added.result.counts.love, 1);
    // The comment author is notified, mirroring post reactions.
    const notifs = call("notifications-list", bob, {});
    assert.ok(notifs.result.notifications.some((n) => n.type === "reaction" && n.commentId === comment.id));
    const thread = call("comment-list", bob, { postId: post.id });
    assert.equal(thread.result.thread[0].reactionCounts.love, 1);
    assert.equal(thread.result.thread[0].reactionTotal, 1);
    assert.equal(thread.result.thread[0].userReaction, null, "bob has not reacted");
    const mine = call("comment-list", ada, { postId: post.id });
    assert.equal(mine.result.thread[0].userReaction, "love");
    const changed = call("comment-react", ada, { postId: post.id, commentId: comment.id, kind: "haha" });
    assert.equal(changed.result.action, "changed");
    assert.equal(changed.result.counts.love, 0);
    assert.equal(changed.result.counts.haha, 1);
    const removed = call("comment-react", ada, { postId: post.id, commentId: comment.id, kind: "haha" });
    assert.equal(removed.result.action, "removed");
    assert.equal(removed.result.total, 0);
  });

  it("comment-react refuses unknown kinds, missing comments, and viewers without post access", () => {
    const post = call("post-create", ada, { content: "friends only", privacy: "friends" }).result.post;
    const comment = call("comment-add", ada, { postId: post.id, text: "mine" }).result.comment;
    assert.equal(call("comment-react", stranger, { postId: post.id, commentId: comment.id, kind: "like" }).ok, false);
    assert.equal(call("comment-react", ada, { postId: post.id, commentId: comment.id, kind: "wow" }).ok, false);
    const missing = call("comment-react", ada, { postId: post.id, commentId: "cmt_nope", kind: "like" });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /Comment not found/);
  });

  it("shares increment the ORIGINAL post's shareCount; the shared copy starts at zero", () => {
    const post = call("post-create", ada, { content: "traveler", privacy: "public" }).result.post;
    call("share-post", bob, { postId: post.id, privacy: "public" });
    call("share-post", stranger, { postId: post.id, privacy: "public" });
    const feed = call("feed-list", ada, {});
    assert.equal(feed.result.posts.find((p) => p.id === post.id).shareCount, 2);
    const copy = feed.result.posts.find((p) => p.sharedFrom?.postId === post.id && p.authorId === "sc_bob");
    assert.equal(copy.shareCount || 0, 0);
  });

  it("the Memories heading names the picked day exactly (F18), and bad months are refused", () => {
    const r1 = call("memories", ada, { date: "2020-10-29" });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.onThisDay, "October 29");
    const r2 = call("memories", ada, { date: "2026-01-01" });
    assert.equal(r2.result.onThisDay, "January 1");
    const r3 = call("memories", ada, { date: "2026-12-31" });
    assert.equal(r3.result.onThisDay, "December 31");
    assert.equal(call("memories", ada, { date: "2026-13-01" }).ok, false);
  });
});

// ── S-TL-2: friends-tier regression lock ───────────────────────────────
// The prep audit found the friends-tier gate already fixed on main
// (checkPostAccess via areFriends, fail-closed, oracle-safe). This
// group regression-locks that behaviour with a real friendship
// fixture so the wall rework can never silently reopen it.
describe("S-TL-2 friends-tier regression lock", () => {
  it("a confirmed friend can see, comment on, and react to a friends post; a stranger gets 'Post not found.' everywhere", () => {
    const owner = asUser("ft_owner");
    const friend = asUser("ft_friend");
    const stranger = asUser("ft_stranger");
    befriend("ft_owner", "ft_friend");
    const post = call("post-create", owner, { content: "for friends", privacy: "friends" }).result.post;

    const friendFeed = call("feed-list", friend, {});
    assert.ok(friendFeed.result.posts.some((p) => p.id === post.id), "friend feed includes it");
    const strangerFeed = call("feed-list", stranger, {});
    assert.ok(!strangerFeed.result.posts.some((p) => p.id === post.id), "stranger feed excludes it");

    const fc = call("comment-add", friend, { postId: post.id, text: "hi friend" });
    assert.equal(fc.ok, true);
    const sc = call("comment-add", stranger, { postId: post.id, text: "hi stranger" });
    assert.equal(sc.ok, false);
    assert.equal(sc.error, "Post not found.");

    const fr = call("react", friend, { postId: post.id, kind: "like" });
    assert.equal(fr.ok, true);
    const sr = call("react", stranger, { postId: post.id, kind: "like" });
    assert.equal(sr.ok, false);
    assert.equal(sr.error, "Post not found.");

    const sl = call("comment-list", stranger, { postId: post.id });
    assert.equal(sl.ok, false);
    assert.equal(sl.error, "Post not found.");
    const sb = call("reactions-breakdown", stranger, { postId: post.id });
    assert.equal(sb.ok, false);
    assert.equal(sb.error, "Post not found.");
  });

  it("a claimed friendIds list in feed-list grants a stranger nothing", () => {
    const owner = asUser("ft2_owner");
    const stranger = asUser("ft2_stranger");
    const post = call("post-create", owner, { content: "friends only", privacy: "friends" }).result.post;
    const feed = call("feed-list", stranger, { friendIds: ["ft2_owner"] });
    assert.ok(!feed.result.posts.some((p) => p.id === post.id));
  });

  it("fails CLOSED without a db handle: friends posts are invisible and gated macros refuse", () => {
    const ownerNoDb = { actor: { userId: "ft3_owner" }, userId: "ft3_owner" };
    const otherNoDb = { actor: { userId: "ft3_other" }, userId: "ft3_other" };
    const post = call("post-create", ownerNoDb, { content: "no db here", privacy: "friends" }).result.post;
    const feed = call("feed-list", otherNoDb, {});
    assert.ok(!feed.result.posts.some((p) => p.id === post.id));
    const c = call("comment-add", otherNoDb, { postId: post.id, text: "anyone there?" });
    assert.equal(c.ok, false);
    assert.equal(c.error, "Post not found.");
  });
});
