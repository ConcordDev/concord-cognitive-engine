// server/lib/social/persistence.js
//
// Social Sprint A — DB persistence on top of migration 226. Replaces
// the STATE._social Map storage with durable rows. Maintains the
// same function signatures the existing /api/social/* routes already
// call so the swap can be incremental.

import { randomUUID } from "node:crypto";

const POST_KINDS = new Set(["post","reply","quote","article","reel","story","dtu_share"]);
const VISIBILITY = new Set(["public","followers","workspace","private","federated"]);
const CONTENT_FORMATS = new Set(["plain","markdown","html"]);
const REACTION_KINDS = new Set(["like","heart","laugh","wow","sad","angry","celebrate","insightful"]);

const POST_MAX = 8000;
const TITLE_MAX = 200;

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }
function _convId(a, b) { const [x, y] = [a, b].sort(); return `${x}|${y}`; }

// ─── Posts ────────────────────────────────────────────────────────

export function createPost(db, { authorId, content, kind = "post", parentPostId = null, quotedPostId = null, title = null, contentFormat = "plain", visibility = "public", sensitive = false, contentWarning = null, scheduledAt = null, media = null }) {
  if (!db || !authorId || !content) return { ok: false, reason: "missing_args" };
  const k = POST_KINDS.has(kind) ? kind : "post";
  const v = VISIBILITY.has(visibility) ? visibility : "public";
  const cf = CONTENT_FORMATS.has(contentFormat) ? contentFormat : "plain";
  const id = `post:${randomUUID()}`;
  const publishedAt = scheduledAt ? 0 : _now();
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO social_posts (id, author_id, kind, parent_post_id, quoted_post_id, title, content, content_format, visibility, sensitive, content_warning, scheduled_at, published_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, authorId, k, parentPostId, quotedPostId,
        title ? String(title).slice(0, TITLE_MAX) : null,
        String(content).slice(0, POST_MAX),
        cf, v, sensitive ? 1 : 0,
        contentWarning ? String(contentWarning).slice(0, 200) : null,
        scheduledAt ? Number(scheduledAt) : null,
        publishedAt, _now(), _now());
      if (parentPostId) {
        db.prepare(`UPDATE social_posts SET reply_count = reply_count + 1 WHERE id = ?`).run(parentPostId);
      }
      if (quotedPostId) {
        db.prepare(`UPDATE social_posts SET quote_count = quote_count + 1 WHERE id = ?`).run(quotedPostId);
      }
      if (Array.isArray(media)) {
        for (let i = 0; i < media.length; i++) {
          const m = media[i];
          if (!m || !["image","video","audio","gif","link","poll"].includes(m.kind)) continue;
          db.prepare(`
            INSERT INTO social_post_media (post_id, position, kind, url, alt_text, mime_type, byte_size, width, height, duration_ms, meta_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, i, m.kind,
            m.url ? String(m.url).slice(0, 2000) : null,
            m.altText ? String(m.altText).slice(0, 1000) : null,
            m.mimeType ? String(m.mimeType).slice(0, 120) : null,
            m.byteSize != null ? Number(m.byteSize) : null,
            m.width != null ? Number(m.width) : null,
            m.height != null ? Number(m.height) : null,
            m.durationMs != null ? Number(m.durationMs) : null,
            m.meta ? JSON.stringify(m.meta) : null,
            _now());
        }
      }
    });
    tx();
    // Following-activity fan-out (Sprint A: synchronous; can move to heartbeat later)
    if (publishedAt > 0 && (v === "public" || v === "followers" || v === "federated")) {
      try {
        const followers = db.prepare(`SELECT follower_id FROM social_follows WHERE followee_id = ?`).all(authorId);
        const stmt = db.prepare(`
          INSERT INTO social_following_activity (user_id, actor_id, kind, subject_id, preview, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const previewKind = parentPostId ? "reply" : quotedPostId ? "quote" : "post";
        const preview = String(content).slice(0, 200);
        for (const f of followers) {
          stmt.run(f.follower_id, authorId, previewKind, id, preview, _now());
        }
      } catch { /* best effort */ }
    }
    return { ok: true, id, publishedAt };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getPost(db, id) {
  if (!db || !id) return null;
  const row = db.prepare(`SELECT * FROM social_posts WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!row) return null;
  const media = db.prepare(`SELECT * FROM social_post_media WHERE post_id = ? ORDER BY position`).all(id);
  return { ...row, media };
}

export function updatePost(db, id, actorId, { content, contentFormat, sensitive, contentWarning, visibility }) {
  if (!db || !id || !actorId) return { ok: false, reason: "missing_args" };
  const cur = db.prepare(`SELECT * FROM social_posts WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!cur) return { ok: false, reason: "not_found" };
  if (cur.author_id !== actorId) return { ok: false, reason: "forbidden" };
  const updates = [];
  const args = [];
  let editRecorded = false;
  if (content !== undefined && content !== cur.content) {
    // Record edit history
    const nextRev = (cur.edit_count || 0) + 1;
    db.prepare(`
      INSERT INTO social_post_edits (post_id, revision, content_before, content_after, editor_id, edited_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, nextRev, cur.content, String(content).slice(0, POST_MAX), actorId, _now());
    updates.push("content = ?"); args.push(String(content).slice(0, POST_MAX));
    updates.push("edit_count = ?"); args.push(nextRev);
    editRecorded = true;
  }
  if (contentFormat && CONTENT_FORMATS.has(contentFormat)) { updates.push("content_format = ?"); args.push(contentFormat); }
  if (sensitive !== undefined) { updates.push("sensitive = ?"); args.push(sensitive ? 1 : 0); }
  if (contentWarning !== undefined) { updates.push("content_warning = ?"); args.push(contentWarning ? String(contentWarning).slice(0, 200) : null); }
  if (visibility && VISIBILITY.has(visibility)) { updates.push("visibility = ?"); args.push(visibility); }
  if (updates.length === 0) return { ok: false, reason: "nothing_to_update" };
  updates.push("updated_at = ?"); args.push(_now());
  args.push(id);
  db.prepare(`UPDATE social_posts SET ${updates.join(", ")} WHERE id = ?`).run(...args);
  return { ok: true, edited: editRecorded };
}

export function deletePost(db, id, actorId) {
  if (!db || !id || !actorId) return { ok: false, reason: "missing_args" };
  const cur = db.prepare(`SELECT author_id FROM social_posts WHERE id = ?`).get(id);
  if (!cur) return { ok: false, reason: "not_found" };
  if (cur.author_id !== actorId) return { ok: false, reason: "forbidden" };
  const r = db.prepare(`UPDATE social_posts SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(_now(), _now(), id);
  return { ok: r.changes > 0 };
}

export function listEdits(db, postId, { limit = 50 } = {}) {
  if (!db || !postId) return [];
  return db.prepare(`SELECT * FROM social_post_edits WHERE post_id = ? ORDER BY revision DESC LIMIT ?`).all(postId, Math.min(Number(limit) || 50, 500));
}

export function getUserPosts(db, userId, { limit = 50, includeReplies = false } = {}) {
  if (!db || !userId) return [];
  const sql = includeReplies
    ? `SELECT * FROM social_posts WHERE author_id = ? AND deleted_at IS NULL AND published_at > 0 ORDER BY published_at DESC LIMIT ?`
    : `SELECT * FROM social_posts WHERE author_id = ? AND deleted_at IS NULL AND published_at > 0 AND parent_post_id IS NULL ORDER BY published_at DESC LIMIT ?`;
  return db.prepare(sql).all(userId, Math.min(Number(limit) || 50, 500));
}

// ─── Follows ──────────────────────────────────────────────────────

export function follow(db, followerId, followeeId) {
  if (!db || !followerId || !followeeId) return { ok: false, reason: "missing_args" };
  if (followerId === followeeId) return { ok: false, reason: "self_follow_not_allowed" };
  db.prepare(`INSERT OR IGNORE INTO social_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)`).run(followerId, followeeId, _now());
  return { ok: true };
}

export function unfollow(db, followerId, followeeId) {
  if (!db) return { ok: false, reason: "missing_args" };
  const r = db.prepare(`DELETE FROM social_follows WHERE follower_id = ? AND followee_id = ?`).run(followerId, followeeId);
  return { ok: r.changes > 0 };
}

export function getFollowers(db, userId, { limit = 200 } = {}) {
  if (!db || !userId) return [];
  return db.prepare(`SELECT follower_id, created_at FROM social_follows WHERE followee_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, Math.min(Number(limit), 1000));
}

export function getFollowing(db, userId, { limit = 200 } = {}) {
  if (!db || !userId) return [];
  return db.prepare(`SELECT followee_id, created_at FROM social_follows WHERE follower_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, Math.min(Number(limit), 1000));
}

export function isFollowing(db, followerId, followeeId) {
  if (!db || !followerId || !followeeId) return false;
  const r = db.prepare(`SELECT 1 FROM social_follows WHERE follower_id = ? AND followee_id = ?`).get(followerId, followeeId);
  return !!r;
}

// ─── Reactions / Reposts / Bookmarks ─────────────────────────────

export function react(db, { postId, userId, kind = "like" }) {
  if (!db || !postId || !userId) return { ok: false, reason: "missing_args" };
  const k = REACTION_KINDS.has(kind) ? kind : "like";
  const tx = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO social_reactions (post_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)`).run(postId, userId, k, _now());
    db.prepare(`UPDATE social_posts SET reaction_count = (SELECT COUNT(*) FROM social_reactions WHERE post_id = ?) WHERE id = ?`).run(postId, postId);
  });
  tx();
  return { ok: true };
}

export function unreact(db, { postId, userId, kind = "like" }) {
  if (!db || !postId || !userId) return { ok: false, reason: "missing_args" };
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM social_reactions WHERE post_id = ? AND user_id = ? AND kind = ?`).run(postId, userId, kind);
    db.prepare(`UPDATE social_posts SET reaction_count = (SELECT COUNT(*) FROM social_reactions WHERE post_id = ?) WHERE id = ?`).run(postId, postId);
  });
  tx();
  return { ok: true };
}

export function listReactions(db, postId) {
  if (!db || !postId) return [];
  return db.prepare(`SELECT kind, COUNT(*) AS n FROM social_reactions WHERE post_id = ? GROUP BY kind`).all(postId);
}

export function bookmark(db, userId, postId) {
  if (!db || !userId || !postId) return { ok: false, reason: "missing_args" };
  const tx = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO social_bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)`).run(userId, postId, _now());
    db.prepare(`UPDATE social_posts SET bookmark_count = (SELECT COUNT(*) FROM social_bookmarks WHERE post_id = ?) WHERE id = ?`).run(postId, postId);
  });
  tx();
  return { ok: true };
}

export function unbookmark(db, userId, postId) {
  if (!db || !userId || !postId) return { ok: false, reason: "missing_args" };
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM social_bookmarks WHERE user_id = ? AND post_id = ?`).run(userId, postId);
    db.prepare(`UPDATE social_posts SET bookmark_count = (SELECT COUNT(*) FROM social_bookmarks WHERE post_id = ?) WHERE id = ?`).run(postId, postId);
  });
  tx();
  return { ok: true };
}

export function listBookmarks(db, userId, { limit = 100 } = {}) {
  if (!db || !userId) return [];
  return db.prepare(`
    SELECT b.created_at, p.* FROM social_bookmarks b
    INNER JOIN social_posts p ON p.id = b.post_id
    WHERE b.user_id = ? AND p.deleted_at IS NULL
    ORDER BY b.created_at DESC LIMIT ?
  `).all(userId, Math.min(Number(limit), 500));
}

export function repost(db, userId, postId) {
  if (!db || !userId || !postId) return { ok: false, reason: "missing_args" };
  const tx = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO social_reposts (user_id, post_id, created_at) VALUES (?, ?, ?)`).run(userId, postId, _now());
    db.prepare(`UPDATE social_posts SET repost_count = (SELECT COUNT(*) FROM social_reposts WHERE post_id = ?) WHERE id = ?`).run(postId, postId);
  });
  tx();
  return { ok: true };
}

export function unrepost(db, userId, postId) {
  if (!db || !userId || !postId) return { ok: false, reason: "missing_args" };
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM social_reposts WHERE user_id = ? AND post_id = ?`).run(userId, postId);
    db.prepare(`UPDATE social_posts SET repost_count = (SELECT COUNT(*) FROM social_reposts WHERE post_id = ?) WHERE id = ?`).run(postId, postId);
  });
  tx();
  return { ok: true };
}

// ─── Following activity ──────────────────────────────────────────

export function followingActivity(db, userId, { limit = 100, since = null } = {}) {
  if (!db || !userId) return [];
  if (since) {
    return db.prepare(`SELECT * FROM social_following_activity WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?`).all(userId, Number(since), Math.min(Number(limit), 500));
  }
  return db.prepare(`SELECT * FROM social_following_activity WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, Math.min(Number(limit), 500));
}

// ─── Notifications ───────────────────────────────────────────────

export function pushNotification(db, { userId, actorId = null, kind, subjectId = null, preview = null }) {
  if (!db || !userId || !kind) return { ok: false, reason: "missing_args" };
  const r = db.prepare(`
    INSERT INTO social_notifications (user_id, actor_id, kind, subject_id, preview, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, actorId, kind, subjectId, preview ? String(preview).slice(0, 400) : null, _now());
  return { ok: true, id: r.lastInsertRowid };
}

export function listNotifications(db, userId, { unreadOnly = false, limit = 100 } = {}) {
  if (!db || !userId) return [];
  const sql = unreadOnly
    ? `SELECT * FROM social_notifications WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM social_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`;
  return db.prepare(sql).all(userId, Math.min(Number(limit), 500));
}

export function markNotificationRead(db, id, userId) {
  if (!db || !id || !userId) return { ok: false, reason: "missing_args" };
  const r = db.prepare(`UPDATE social_notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`).run(_now(), id, userId);
  return { ok: r.changes > 0 };
}

export function markAllNotificationsRead(db, userId) {
  if (!db || !userId) return { ok: false, reason: "missing_args" };
  const r = db.prepare(`UPDATE social_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`).run(_now(), userId);
  return { ok: true, count: r.changes };
}

export function unreadCount(db, userId) {
  if (!db || !userId) return 0;
  const r = db.prepare(`SELECT COUNT(*) AS n FROM social_notifications WHERE user_id = ? AND read_at IS NULL`).get(userId);
  return r?.n || 0;
}

// ─── DMs ──────────────────────────────────────────────────────────

export function sendDm(db, { senderId, recipientId, content, mediaJson = null, replyToId = null }) {
  if (!db || !senderId || !recipientId || !content) return { ok: false, reason: "missing_args" };
  const convId = _convId(senderId, recipientId);
  const r = db.prepare(`
    INSERT INTO social_messages (conversation_id, sender_id, content, media_json, reply_to_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(convId, senderId, String(content).slice(0, 8000), mediaJson, replyToId, _now());
  return { ok: true, id: r.lastInsertRowid, conversationId: convId };
}

export function listMessages(db, conversationId, { limit = 100 } = {}) {
  if (!db || !conversationId) return [];
  return db.prepare(`SELECT * FROM social_messages WHERE conversation_id = ? AND recalled_at IS NULL ORDER BY created_at ASC, id ASC LIMIT ?`).all(conversationId, Math.min(Number(limit), 500));
}

export function markMessagesRead(db, conversationId, userId) {
  if (!db || !conversationId || !userId) return { ok: false, reason: "missing_args" };
  const r = db.prepare(`UPDATE social_messages SET read_at = ? WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL`).run(_now(), conversationId, userId);
  return { ok: true, count: r.changes };
}

// ─── Block / mute ────────────────────────────────────────────────

export function block(db, userId, blockedId, kind = "block") {
  if (!db || !userId || !blockedId) return { ok: false, reason: "missing_args" };
  if (userId === blockedId) return { ok: false, reason: "self_block_not_allowed" };
  db.prepare(`INSERT OR IGNORE INTO social_blocks (user_id, blocked_id, kind, keyword, created_at) VALUES (?, ?, ?, '', ?)`).run(userId, blockedId, kind, _now());
  return { ok: true };
}

export function unblock(db, userId, blockedId, kind = "block") {
  if (!db || !userId || !blockedId) return { ok: false, reason: "missing_args" };
  const r = db.prepare(`DELETE FROM social_blocks WHERE user_id = ? AND blocked_id = ? AND kind = ?`).run(userId, blockedId, kind);
  return { ok: r.changes > 0 };
}

export function listBlocks(db, userId, kind = null) {
  if (!db || !userId) return [];
  const sql = kind
    ? `SELECT * FROM social_blocks WHERE user_id = ? AND kind = ? ORDER BY created_at DESC`
    : `SELECT * FROM social_blocks WHERE user_id = ? ORDER BY created_at DESC`;
  const args = kind ? [userId, kind] : [userId];
  return db.prepare(sql).all(...args);
}

export function muteKeyword(db, userId, keyword) {
  if (!db || !userId || !keyword) return { ok: false, reason: "missing_args" };
  db.prepare(`INSERT OR IGNORE INTO social_blocks (user_id, blocked_id, kind, keyword, created_at) VALUES (?, '', 'keyword_mute', ?, ?)`).run(userId, String(keyword).slice(0, 120), _now());
  return { ok: true };
}

// ─── Feed reads ──────────────────────────────────────────────────

export function followingFeed(db, userId, { limit = 50 } = {}) {
  if (!db || !userId) return [];
  return db.prepare(`
    SELECT p.* FROM social_posts p
    INNER JOIN social_follows f ON f.followee_id = p.author_id
    WHERE f.follower_id = ?
      AND p.deleted_at IS NULL
      AND p.published_at > 0
      AND p.visibility IN ('public','followers','federated')
    ORDER BY p.published_at DESC LIMIT ?
  `).all(userId, Math.min(Number(limit), 200));
}

export function publicFeed(db, { limit = 50 } = {}) {
  if (!db) return [];
  return db.prepare(`
    SELECT * FROM social_posts
    WHERE deleted_at IS NULL AND published_at > 0
      AND visibility IN ('public','federated')
    ORDER BY published_at DESC LIMIT ?
  `).all(Math.min(Number(limit), 200));
}
