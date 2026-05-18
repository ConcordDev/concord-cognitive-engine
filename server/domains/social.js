// server/domains/social.js
//
// Social lens Sprint A — NEW domain. Smoking-gun fix #10/10: the
// social lens was the ONE lens with no register()-pattern domain.
// It bypassed the macro registry entirely and called REST routes
// directly. That meant: no macro billing, no Gate-2 publicReadDomain
// surface, no consistency with the other 5 rebuilt lenses.
//
// ~30 macros covering: posts CRUD (with edit history + quotes +
// multi-image), reactions, reposts, bookmarks, follow graph,
// following activity (the route the page calls + the server never
// implemented), notifications, DMs, block/mute, feeds (following +
// public), and edit history read.

import {
  createPost, getPost, updatePost, deletePost, listEdits, getUserPosts,
  follow, unfollow, getFollowers, getFollowing, isFollowing,
  react, unreact, listReactions, bookmark, unbookmark, listBookmarks,
  repost, unrepost, followingActivity,
  pushNotification, listNotifications, markNotificationRead, markAllNotificationsRead, unreadCount,
  sendDm, listMessages, markMessagesRead,
  block, unblock, listBlocks, muteKeyword,
  followingFeed, publicFeed,
} from "../lib/social/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _emit(event, payload) {
  try { globalThis._concordREALTIME?.io?.emit(event, payload); } catch { /* best */ }
}

export default function registerSocialMacros(register) {

  // ─── Posts ───────────────────────────────────────────────────────

  register("social", "post_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = createPost(db, {
      authorId: userId,
      content: input.content,
      kind: input.kind,
      parentPostId: input.parentPostId,
      quotedPostId: input.quotedPostId,
      title: input.title,
      contentFormat: input.contentFormat,
      visibility: input.visibility,
      sensitive: !!input.sensitive,
      contentWarning: input.contentWarning,
      scheduledAt: input.scheduledAt,
      media: input.media,
    });
    if (r.ok) {
      _emit("timeline:post", { postId: r.id, authorId: userId });
      // Notify reply / quote targets
      if (input.parentPostId) {
        const parent = getPost(db, input.parentPostId);
        if (parent && parent.author_id !== userId) {
          pushNotification(db, { userId: parent.author_id, actorId: userId, kind: "reply", subjectId: r.id, preview: input.content?.slice(0, 200) });
        }
      }
      if (input.quotedPostId) {
        const quoted = getPost(db, input.quotedPostId);
        if (quoted && quoted.author_id !== userId) {
          pushNotification(db, { userId: quoted.author_id, actorId: userId, kind: "quote", subjectId: r.id, preview: input.content?.slice(0, 200) });
        }
      }
    }
    return r;
  }, { destructive: true, note: "Create a post / reply / quote / article (with multi-image + character-limit + markdown)" });

  register("social", "post_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const post = getPost(db, String(input.id || ""));
    if (!post) return { ok: false, reason: "not_found" };
    return { ok: true, post };
  }, { note: "Get a post by id (public reads OK; visibility gate applies)" });

  register("social", "post_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return updatePost(db, String(input.id || ""), userId, input);
  }, { destructive: true, note: "Edit a post (autosaves edit history; X/Bluesky/Threads parity)" });

  register("social", "post_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return deletePost(db, String(input.id || ""), userId);
  }, { destructive: true, note: "Soft-delete a post" });

  register("social", "post_edits", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, edits: listEdits(db, String(input.id || ""), { limit: input.limit }) };
  }, { note: "List edit history for a post" });

  register("social", "user_posts", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, posts: getUserPosts(db, String(input.userId || _actor(ctx)), { limit: input.limit, includeReplies: !!input.includeReplies }) };
  }, { note: "List posts by a user" });

  // ─── Reactions / reposts / bookmarks ────────────────────────────

  register("social", "react", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = react(db, { postId: String(input.postId || ""), userId, kind: input.kind });
    if (r.ok) {
      const post = getPost(db, input.postId);
      if (post && post.author_id !== userId) {
        pushNotification(db, { userId: post.author_id, actorId: userId, kind: "reaction", subjectId: post.id, preview: input.kind });
      }
    }
    return r;
  }, { destructive: true, note: "React to a post (like/heart/laugh/wow/sad/angry/celebrate/insightful)" });

  register("social", "unreact", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return unreact(db, { postId: String(input.postId || ""), userId, kind: input.kind });
  }, { destructive: true, note: "Remove my reaction" });

  register("social", "reactions_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, reactions: listReactions(db, String(input.postId || "")) };
  }, { note: "Reaction tally for a post (grouped by kind)" });

  register("social", "bookmark", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return bookmark(db, userId, String(input.postId || ""));
  }, { destructive: true, note: "Bookmark a post" });

  register("social", "unbookmark", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return unbookmark(db, userId, String(input.postId || ""));
  }, { destructive: true, note: "Remove a bookmark" });

  register("social", "bookmarks", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, bookmarks: listBookmarks(db, userId, { limit: input.limit }) };
  }, { note: "My bookmarked posts" });

  register("social", "repost", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = repost(db, userId, String(input.postId || ""));
    if (r.ok) {
      const post = getPost(db, input.postId);
      if (post && post.author_id !== userId) {
        pushNotification(db, { userId: post.author_id, actorId: userId, kind: "repost", subjectId: post.id });
      }
    }
    return r;
  }, { destructive: true, note: "Repost / boost a post" });

  register("social", "unrepost", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return unrepost(db, userId, String(input.postId || ""));
  }, { destructive: true, note: "Undo a repost" });

  // ─── Follow graph ────────────────────────────────────────────────

  register("social", "follow", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const target = String(input.userId || input.targetId || "");
    const r = follow(db, userId, target);
    if (r.ok) pushNotification(db, { userId: target, actorId: userId, kind: "follow" });
    return r;
  }, { destructive: true, note: "Follow a user" });

  register("social", "unfollow", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return unfollow(db, userId, String(input.userId || input.targetId || ""));
  }, { destructive: true, note: "Unfollow a user" });

  register("social", "followers", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, followers: getFollowers(db, String(input.userId || _actor(ctx)), { limit: input.limit }) };
  }, { note: "Followers of a user" });

  register("social", "following", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, following: getFollowing(db, String(input.userId || _actor(ctx)), { limit: input.limit }) };
  }, { note: "Users a user is following" });

  register("social", "is_following", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, isFollowing: isFollowing(db, String(input.followerId || _actor(ctx)), String(input.followeeId || "")) };
  }, { note: "Quick predicate: does A follow B?" });

  // ─── Following activity (the missing endpoint!) ─────────────────

  register("social", "following_activity", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, activity: followingActivity(db, userId, { limit: input.limit, since: input.since }) };
  }, { note: "The lens page calls this; pre-Sprint-A the route was a 404. Now it returns posts/reactions/reposts/quotes from people I follow, in reverse chronological order." });

  // ─── Notifications ──────────────────────────────────────────────

  register("social", "notifications", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, notifications: listNotifications(db, userId, { unreadOnly: !!input.unreadOnly, limit: input.limit }) };
  }, { note: "List my notifications" });

  register("social", "notifications_unread_count", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, count: unreadCount(db, userId) };
  }, { note: "Quick unread count for the notification badge" });

  register("social", "notification_read", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return markNotificationRead(db, Number(input.id), userId);
  }, { destructive: true, note: "Mark one notification read" });

  register("social", "notifications_read_all", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return markAllNotificationsRead(db, userId);
  }, { destructive: true, note: "Mark all my notifications read" });

  // ─── DMs (durable replacement for STATE._social.messages) ───────

  register("social", "dm_send", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = sendDm(db, { senderId: userId, recipientId: String(input.recipientId || ""), content: input.content, mediaJson: input.media ? JSON.stringify(input.media) : null, replyToId: input.replyToId });
    if (r.ok) {
      pushNotification(db, { userId: input.recipientId, actorId: userId, kind: "dm", subjectId: r.conversationId, preview: input.content?.slice(0, 200) });
    }
    return r;
  }, { destructive: true, note: "Send a direct message" });

  register("social", "dm_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, messages: listMessages(db, String(input.conversationId || ""), { limit: input.limit }) };
  }, { note: "List messages in a conversation" });

  register("social", "dm_read", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return markMessagesRead(db, String(input.conversationId || ""), userId);
  }, { destructive: true, note: "Mark a conversation's messages read" });

  // ─── Block / mute ───────────────────────────────────────────────

  register("social", "block", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return block(db, userId, String(input.targetId || input.userId || ""), input.kind || "block");
  }, { destructive: true, note: "Block or mute a user" });

  register("social", "unblock", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return unblock(db, userId, String(input.targetId || input.userId || ""), input.kind || "block");
  }, { destructive: true, note: "Unblock / unmute" });

  register("social", "blocks", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, blocks: listBlocks(db, userId, input.kind || null) };
  }, { note: "List blocks / mutes / keyword mutes" });

  register("social", "mute_keyword", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return muteKeyword(db, userId, String(input.keyword || ""));
  }, { destructive: true, note: "Mute a keyword / phrase from feeds" });

  // ─── Feeds (durable replacements for in-memory feeds) ──────────

  register("social", "feed_following", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, posts: followingFeed(db, userId, { limit: input.limit }) };
  }, { note: "My following feed (chronological)" });

  register("social", "feed_public", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, posts: publicFeed(db, { limit: input.limit }) };
  }, { note: "Global public + federated feed (chronological)" });
}
