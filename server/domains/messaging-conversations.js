// server/domains/messaging-conversations.js
//
// Message lens Sprint A — group DMs + channels + thread posting +
// reactions + pins + bookmarks + drafts + snooze + presence + read
// receipts. All real DB writes via lib/messaging/persistence.js.
//
// Realtime fanout via existing globalThis._concordREALTIME.io to
// rooms `conversation:${id}` (multi-cursor model from whiteboard
// Sprint A reused as-is).

import {
  createConversation, getConversation, listConversationsForUser,
  listParticipants, addParticipant, removeParticipant, getRole, hasRole,
  postMessage, getMessage, listMessages, editMessage, deleteMessage,
  togglePin, toggleReaction, markRead, listReadReceipts, unreadCountForConversation,
  saveDraft, getDraft, clearDraft,
  addBookmark, removeBookmark, listBookmarks,
  snoozeThread, getThreadSubscription,
  setPresence, getPresenceMany,
} from "../lib/messaging/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

function _emitConvo(conversationId, event, payload) {
  try {
    globalThis._concordREALTIME?.io?.to(`conversation:${conversationId}`).emit(event, { conversationId, ...payload, ts: Date.now() });
  } catch { /* best effort */ }
}

function _emitUser(userId, event, payload) {
  try {
    globalThis._concordREALTIME?.io?.to(`user:${userId}`).emit(event, { userId, ...payload, ts: Date.now() });
  } catch { /* best effort */ }
}

// Parse @user mentions out of a message body. Real regex; matches
// @ followed by [a-zA-Z0-9_-] (3-32 chars). Returns array of unique
// usernames so the inbox can ping them.
function _parseMentions(body) {
  if (!body || typeof body !== "string") return [];
  const out = new Set();
  const re = /(?:^|\s)@([a-zA-Z0-9_\-]{2,32})\b/g;
  let m;
  while ((m = re.exec(body)) !== null) out.add(m[1]);
  return Array.from(out);
}

export default function registerMessagingConversationsMacros(register) {
  // ── Conversations CRUD ──

  register("messaging", "convo_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const kind = String(input.kind || "dm");
    const participants = Array.isArray(input.participants) ? input.participants.map(String) : [];
    return createConversation(db, {
      kind, ownerId: userId, participants,
      title: input.title, topic: input.topic,
      workspaceId: input.workspaceId, externalSource: input.externalSource,
      meta: input.meta,
    });
  }, { destructive: true, note: "Create a dm / group / channel / external conversation. Owner = caller; other participants get role='member'." });

  register("messaging", "convo_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const rows = listConversationsForUser(db, userId, { kind: input.kind, limit: input.limit });
    // Augment each row with unread count
    const augmented = rows.map((r) => ({ ...r, unreadCount: unreadCountForConversation(db, r.id, userId) }));
    return { ok: true, conversations: augmented };
  }, { note: "List conversations the caller participates in (filterable by kind)" });

  register("messaging", "convo_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || input.conversationId || "");
    if (!id) return { ok: false, reason: "id_required" };
    if (!hasRole(db, id, userId, "guest")) return { ok: false, reason: "forbidden" };
    const row = getConversation(db, id);
    if (!row) return { ok: false, reason: "not_found" };
    const participants = listParticipants(db, id);
    return { ok: true, conversation: row, participants, unreadCount: unreadCountForConversation(db, id, userId) };
  }, { note: "Read a single conversation with its participants" });

  register("messaging", "convo_add_participant", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    const targetUserId = String(input.userId || "");
    const role = String(input.role || "member");
    if (!conversationId || !targetUserId) return { ok: false, reason: "conversationId_and_userId_required" };
    if (!hasRole(db, conversationId, userId, "admin")) return { ok: false, reason: "forbidden" };
    const r = addParticipant(db, { conversationId, userId: targetUserId, role });
    if (r.ok) _emitConvo(conversationId, "convo:participant-added", { addedUserId: targetUserId, role });
    return r;
  }, { destructive: true, note: "Add a participant to a group / channel (admin+)" });

  register("messaging", "convo_leave", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    if (!conversationId) return { ok: false, reason: "conversationId_required" };
    const r = removeParticipant(db, { conversationId, userId });
    if (r.ok) _emitConvo(conversationId, "convo:participant-left", { leftUserId: userId });
    return r;
  }, { destructive: true, note: "Leave a conversation (owner cannot leave; use convo_delete)" });

  // ── Messages ──

  register("messaging", "msg_post", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    if (!conversationId) return { ok: false, reason: "conversationId_required" };
    if (!hasRole(db, conversationId, userId, "member")) return { ok: false, reason: "forbidden" };
    const body = String(input.body || "").trim();
    const bodyKind = String(input.bodyKind || "text");
    const mentions = _parseMentions(body);
    const result = postMessage(db, {
      conversationId, authorId: userId, body, bodyKind,
      parentMessageId: input.parentMessageId,
      attachments: input.attachments,
      mentions,
      scheduledFor: input.scheduledFor,
    });
    if (!result.ok) return result;
    // Fanout (skip if scheduled-for-future — flushed by the scheduler heartbeat in Sprint B)
    if (!input.scheduledFor) {
      _emitConvo(conversationId, "msg:new", { message: result.message });
      // Clear the caller's draft for this convo/parent automatically
      clearDraft(db, { userId, conversationId, parentMessageId: input.parentMessageId || null });
      // Ping each mentioned user's per-user room so their @-inbox lights up
      for (const username of mentions) {
        _emitUser(username, "msg:mention", { conversationId, messageId: result.id, body });
      }
    }
    return result;
  }, { destructive: true, note: "Post a new message (text / voice / file / dtu_embed). Auto-parses @mentions, auto-clears caller's draft." });

  register("messaging", "msg_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    if (!conversationId) return { ok: false, reason: "conversationId_required" };
    if (!hasRole(db, conversationId, userId, "guest")) return { ok: false, reason: "forbidden" };
    const msgs = listMessages(db, conversationId, {
      limit: input.limit,
      beforeTs: input.beforeTs,
      parentMessageId: input.parentMessageId,
    });
    return { ok: true, messages: msgs, count: msgs.length };
  }, { note: "List messages (chronological). Pass parentMessageId for a thread; omit for root-level." });

  register("messaging", "msg_edit", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = editMessage(db, { id: String(input.id || ""), userId, body: String(input.body || "") });
    if (r.ok) {
      const m = getMessage(db, r.id);
      if (m) _emitConvo(m.conversation_id, "msg:edited", { id: r.id, body: input.body, editedAt: r.editedAt });
    }
    return r;
  }, { destructive: true, note: "Edit a message body (author-only)" });

  register("messaging", "msg_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = deleteMessage(db, { id: String(input.id || ""), userId });
    if (r.ok) {
      const m = getMessage(db, r.id);
      if (m) _emitConvo(m.conversation_id, "msg:deleted", { id: r.id });
    }
    return r;
  }, { destructive: true, note: "Soft-delete (tombstone) a message (author-only)" });

  register("messaging", "msg_pin", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = togglePin(db, { id: String(input.id || ""), userId, pin: !!input.pin });
    if (r.ok) {
      const m = getMessage(db, r.id);
      if (m) _emitConvo(m.conversation_id, "msg:pinned", { id: r.id, pinned: r.pinned });
    }
    return r;
  }, { destructive: true, note: "Pin / unpin a message (member+)" });

  register("messaging", "msg_react", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = toggleReaction(db, { id: String(input.id || ""), userId, emoji: String(input.emoji || "") });
    if (r.ok) {
      const m = getMessage(db, r.id);
      if (m) _emitConvo(m.conversation_id, "msg:reaction", { id: r.id, emoji: r.emoji, action: r.action, totalForEmoji: r.totalForEmoji, userId });
    }
    return r;
  }, { destructive: true, note: "Toggle an emoji reaction on a message" });

  register("messaging", "msg_mark_read", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const messageId = String(input.messageId || "");
    if (!messageId) return { ok: false, reason: "messageId_required" };
    const r = markRead(db, { messageId, userId });
    if (r.ok) {
      const m = getMessage(db, messageId);
      if (m) _emitConvo(m.conversation_id, "msg:read", { messageId, userId });
    }
    return r;
  }, { destructive: true, note: "Mark a message as read for the caller" });

  register("messaging", "msg_read_receipts", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const messageId = String(input.messageId || "");
    if (!messageId) return { ok: false, reason: "messageId_required" };
    const m = getMessage(db, messageId);
    if (!m) return { ok: false, reason: "not_found" };
    if (!hasRole(db, m.conversation_id, userId, "guest")) return { ok: false, reason: "forbidden" };
    return { ok: true, receipts: listReadReceipts(db, messageId) };
  }, { note: "List read receipts for a message" });

  // ── Drafts / bookmarks / snooze ──

  register("messaging", "draft_save", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return saveDraft(db, {
      userId,
      conversationId: String(input.conversationId || ""),
      parentMessageId: input.parentMessageId || null,
      body: String(input.body || ""),
      attachments: input.attachments,
    });
  }, { destructive: true, note: "Auto-save a draft (call from the composer onChange, debounced)" });

  register("messaging", "draft_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const draft = getDraft(db, {
      userId,
      conversationId: String(input.conversationId || ""),
      parentMessageId: input.parentMessageId || null,
    });
    return { ok: true, draft };
  }, { note: "Read the caller's stored draft for a conversation / thread" });

  register("messaging", "draft_clear", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return clearDraft(db, {
      userId,
      conversationId: String(input.conversationId || ""),
      parentMessageId: input.parentMessageId || null,
    });
  }, { destructive: true, note: "Clear the caller's draft (auto-cleared on msg_post too)" });

  register("messaging", "bookmark_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return addBookmark(db, { userId, messageId: String(input.messageId || ""), note: input.note });
  }, { destructive: true, note: "Bookmark a message for later" });

  register("messaging", "bookmark_remove", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return removeBookmark(db, { userId, messageId: String(input.messageId || "") });
  }, { destructive: true, note: "Remove a bookmark" });

  register("messaging", "bookmark_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, bookmarks: listBookmarks(db, userId, { limit: input.limit }) };
  }, { note: "List the caller's bookmarks" });

  register("messaging", "thread_snooze", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return snoozeThread(db, {
      userId,
      conversationId: String(input.conversationId || ""),
      snoozedUntil: input.snoozedUntil ? Number(input.snoozedUntil) : null,
      tag: input.tag,
    });
  }, { destructive: true, note: "Snooze a thread until a given unix-timestamp; tag adds a custom label" });

  register("messaging", "thread_subscription", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sub = getThreadSubscription(db, { userId, conversationId: String(input.conversationId || "") });
    return { ok: true, subscription: sub };
  }, { note: "Read the caller's thread subscription (snooze + tag)" });

  // ── Typing + presence ──

  register("messaging", "typing_start", async (ctx, input = {}) => {
    // Ephemeral — pure socket fanout, no DB write.
    const userId = _actor(ctx);
    if (!userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    if (!conversationId) return { ok: false, reason: "conversationId_required" };
    _emitConvo(conversationId, "msg:typing", { userId });
    return { ok: true };
  }, { note: "Broadcast a typing indicator (ephemeral; clients TTL out after ~5s)" });

  register("messaging", "presence_set", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = setPresence(db, {
      userId, status: String(input.status || "online"),
      customText: input.customText,
      focusUntil: input.focusUntil ? Number(input.focusUntil) : null,
    });
    if (r.ok) _emitUser(userId, "presence:changed", { status: input.status, customText: input.customText });
    return r;
  }, { destructive: true, note: "Update the caller's presence (online / away / dnd / focus / offline)" });

  register("messaging", "presence_get_many", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const userIds = Array.isArray(input.userIds) ? input.userIds.map(String).slice(0, 200) : [];
    return { ok: true, presence: getPresenceMany(db, userIds) };
  }, { note: "Look up presence for a batch of users" });
}
