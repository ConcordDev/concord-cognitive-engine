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
