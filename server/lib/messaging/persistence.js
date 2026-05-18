// server/lib/messaging/persistence.js
//
// Message lens Sprint A — DB persistence helpers for the messaging
// substrate (migration 209). Same pattern as lib/whiteboard/
// persistence.js: tiny pure functions that wrap prepared statements,
// every helper returns an { ok, … } envelope, never throws.
//
// STATE.{_social.messages, ...} remains the hot cache in callers that
// already use it. New code paths go through these helpers and treat
// SQLite as source of truth.

import { randomUUID } from "node:crypto";

const MESSAGE_BODY_MAX_BYTES = 65_000;

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fallback) {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

// ── Conversations ──────────────────────────────────────────────────

const ROLE_RANK = { owner: 4, admin: 3, member: 2, guest: 1 };

/**
 * Create a conversation. `participants` is an array of user_ids (incl. owner).
 * The owner gets role='owner', everyone else 'member' by default.
 *
 * For DM conversations the id is deterministic (sorted-uid pair) so
 * two parties always land on the same row.
 */
export function createConversation(db, { kind = "dm", title, topic, ownerId, participants = [], workspaceId, externalSource, meta }) {
  if (!db || !ownerId) return { ok: false, reason: "missing_db_or_owner" };
  if (!["dm", "group", "channel", "external"].includes(kind)) return { ok: false, reason: "invalid_kind" };
  const uniqueParts = Array.from(new Set([ownerId, ...participants]));
  if (kind === "dm" && uniqueParts.length !== 2) return { ok: false, reason: "dm_needs_exactly_two_participants" };
  if (kind === "group" && uniqueParts.length < 2) return { ok: false, reason: "group_needs_at_least_two_participants" };
  const id = kind === "dm"
    ? `dm:${[...uniqueParts].sort().join(":")}`
    : `${kind}:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO conversations (id, kind, title, topic, workspace_id, owner_id, external_source, meta_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = COALESCE(excluded.title, conversations.title),
        topic = COALESCE(excluded.topic, conversations.topic),
        updated_at = excluded.updated_at
    `).run(id, kind, title || null, topic || null, workspaceId || null, ownerId, externalSource || null, meta ? JSON.stringify(meta) : null, _now(), _now());
    // Add participants (owner is always 'owner'; others default 'member')
    const ins = db.prepare(`
      INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(conversation_id, user_id) DO NOTHING
    `);
    for (const uid of uniqueParts) {
      ins.run(id, uid, uid === ownerId ? "owner" : "member", _now());
    }
    return { ok: true, id, row: getConversation(db, id) };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getConversation(db, id) {
  if (!db) return null;
  const row = db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id);
  if (!row) return null;
  return { ...row, meta: _safeJson(row.meta_json, {}) };
}

export function listConversationsForUser(db, userId, { kind, limit = 200 } = {}) {
  if (!db || !userId) return [];
  const lim = Math.min(500, Math.max(1, Number(limit) || 200));
  const sql = kind
    ? `SELECT c.* FROM conversations c
       JOIN conversation_participants p ON p.conversation_id = c.id
       WHERE p.user_id = ? AND c.kind = ?
       ORDER BY c.updated_at DESC LIMIT ?`
    : `SELECT c.* FROM conversations c
       JOIN conversation_participants p ON p.conversation_id = c.id
       WHERE p.user_id = ?
       ORDER BY c.updated_at DESC LIMIT ?`;
  return kind ? db.prepare(sql).all(userId, kind, lim) : db.prepare(sql).all(userId, lim);
}

export function listParticipants(db, conversationId) {
  if (!db) return [];
  return db.prepare(`
    SELECT user_id, role, last_read_message_id, muted_until, joined_at
    FROM conversation_participants WHERE conversation_id = ?
    ORDER BY joined_at ASC
  `).all(conversationId);
}

export function addParticipant(db, { conversationId, userId, role = "member" }) {
  if (!db || !conversationId || !userId) return { ok: false, reason: "missing_args" };
  if (!ROLE_RANK[role]) return { ok: false, reason: "invalid_role" };
  try {
    db.prepare(`
      INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(conversation_id, user_id) DO UPDATE SET role = excluded.role
    `).run(conversationId, userId, role, _now());
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(_now(), conversationId);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function removeParticipant(db, { conversationId, userId }) {
  if (!db) return { ok: false, reason: "no_db" };
  const r = db.prepare(`DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ? AND role != 'owner'`).run(conversationId, userId);
  return { ok: true, removed: r.changes };
}

export function getRole(db, conversationId, userId) {
  if (!db) return null;
  const row = db.prepare(`SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`).get(conversationId, userId);
  return row?.role || null;
}

export function hasRole(db, conversationId, userId, minRole) {
  const r = getRole(db, conversationId, userId);
  if (!r) return false;
  return (ROLE_RANK[r] || 0) >= (ROLE_RANK[minRole] || 0);
}

// ── Messages ───────────────────────────────────────────────────────

export function postMessage(db, { conversationId, authorId, body, bodyKind = "text", parentMessageId, attachments, mentions, scheduledFor }) {
  if (!db || !conversationId || !authorId) return { ok: false, reason: "missing_args" };
  if (bodyKind === "text" && (!body || !body.trim())) return { ok: false, reason: "body_required" };
  if (body && body.length > MESSAGE_BODY_MAX_BYTES) return { ok: false, reason: "body_too_long" };
  const id = `msg_${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO messages (id, conversation_id, parent_message_id, author_id, body, body_kind, attachments_json, mentions_json, scheduled_for, created_at, server_ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, conversationId, parentMessageId || null, authorId,
      body || null, bodyKind,
      attachments ? JSON.stringify(attachments) : null,
      mentions && mentions.length ? JSON.stringify(mentions) : "[]",
      scheduledFor || null, _now(), _now(),
    );
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(_now(), conversationId);
    return { ok: true, id, message: getMessage(db, id) };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getMessage(db, id) {
  if (!db) return null;
  const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id);
  if (!row) return null;
  return {
    ...row,
    attachments: _safeJson(row.attachments_json, []),
    mentions: _safeJson(row.mentions_json, []),
    reactions: _safeJson(row.reactions_json, {}),
  };
}

export function listMessages(db, conversationId, { limit = 50, beforeTs, parentMessageId, includeDeleted = false } = {}) {
  if (!db || !conversationId) return [];
  const lim = Math.min(500, Math.max(1, Number(limit) || 50));
  const clauses = ["conversation_id = ?"];
  const args = [conversationId];
  if (parentMessageId !== undefined) {
    clauses.push("parent_message_id IS ?");
    args.push(parentMessageId);
  }
  if (beforeTs) {
    clauses.push("server_ts < ?");
    args.push(beforeTs);
  }
  if (!includeDeleted) clauses.push("deleted_at IS NULL");
  // Hide scheduled-for-future messages from normal reads
  clauses.push("(scheduled_for IS NULL OR scheduled_for <= unixepoch())");
  const sql = `
    SELECT * FROM messages WHERE ${clauses.join(" AND ")}
    ORDER BY server_ts DESC, id DESC LIMIT ?
  `;
  args.push(lim);
  return db.prepare(sql).all(...args).map((r) => ({
    ...r,
    attachments: _safeJson(r.attachments_json, []),
    mentions: _safeJson(r.mentions_json, []),
    reactions: _safeJson(r.reactions_json, {}),
  })).reverse();    // chronological order
}

export function editMessage(db, { id, userId, body }) {
  if (!db || !id || !userId) return { ok: false, reason: "missing_args" };
  if (!body || !body.trim()) return { ok: false, reason: "body_required" };
  if (body.length > MESSAGE_BODY_MAX_BYTES) return { ok: false, reason: "body_too_long" };
  const row = db.prepare(`SELECT author_id FROM messages WHERE id = ?`).get(id);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.author_id !== userId) return { ok: false, reason: "forbidden" };
  db.prepare(`UPDATE messages SET body = ?, edited_at = ? WHERE id = ?`).run(body, _now(), id);
  return { ok: true, id, editedAt: _now() };
}

export function deleteMessage(db, { id, userId }) {
  if (!db || !id || !userId) return { ok: false, reason: "missing_args" };
  const row = db.prepare(`SELECT author_id, conversation_id FROM messages WHERE id = ?`).get(id);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.author_id !== userId) return { ok: false, reason: "forbidden" };
  db.prepare(`UPDATE messages SET deleted_at = ?, body = '' WHERE id = ?`).run(_now(), id);
  return { ok: true, id };
}

export function togglePin(db, { id, userId, pin }) {
  if (!db || !id) return { ok: false, reason: "missing_args" };
  const row = db.prepare(`SELECT conversation_id FROM messages WHERE id = ?`).get(id);
  if (!row) return { ok: false, reason: "not_found" };
  if (!hasRole(db, row.conversation_id, userId, "member")) return { ok: false, reason: "forbidden" };
  db.prepare(`UPDATE messages SET pinned = ? WHERE id = ?`).run(pin ? 1 : 0, id);
  return { ok: true, id, pinned: !!pin };
}

export function toggleReaction(db, { id, userId, emoji }) {
  if (!db || !id || !userId || !emoji) return { ok: false, reason: "missing_args" };
  if (emoji.length > 16) return { ok: false, reason: "emoji_too_long" };
  const row = db.prepare(`SELECT reactions_json, conversation_id FROM messages WHERE id = ?`).get(id);
  if (!row) return { ok: false, reason: "not_found" };
  if (!hasRole(db, row.conversation_id, userId, "guest")) return { ok: false, reason: "forbidden" };
  let reactions = _safeJson(row.reactions_json, {});
  const users = new Set(reactions[emoji] || []);
  const action = users.has(userId) ? (users.delete(userId), "removed") : (users.add(userId), "added");
  reactions[emoji] = Array.from(users);
  if (reactions[emoji].length === 0) delete reactions[emoji];
  db.prepare(`UPDATE messages SET reactions_json = ? WHERE id = ?`).run(JSON.stringify(reactions), id);
  return { ok: true, id, emoji, action, totalForEmoji: reactions[emoji]?.length || 0 };
}

// ── Read receipts ──────────────────────────────────────────────────

export function markRead(db, { messageId, userId }) {
  if (!db || !messageId || !userId) return { ok: false, reason: "missing_args" };
  try {
    db.prepare(`
      INSERT INTO message_read_receipts (message_id, user_id, read_at)
      VALUES (?, ?, ?)
      ON CONFLICT(message_id, user_id) DO NOTHING
    `).run(messageId, userId, _now());
    // Update the participant's last_read pointer too
    const row = db.prepare(`SELECT conversation_id FROM messages WHERE id = ?`).get(messageId);
    if (row) {
      db.prepare(`
        UPDATE conversation_participants SET last_read_message_id = ?
        WHERE conversation_id = ? AND user_id = ?
      `).run(messageId, row.conversation_id, userId);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listReadReceipts(db, messageId) {
  if (!db) return [];
  return db.prepare(`SELECT user_id, read_at FROM message_read_receipts WHERE message_id = ? ORDER BY read_at ASC`).all(messageId);
}

export function unreadCountForConversation(db, conversationId, userId) {
  if (!db) return 0;
  const row = db.prepare(`SELECT last_read_message_id FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`).get(conversationId, userId);
  const lastReadTs = row?.last_read_message_id
    ? (db.prepare(`SELECT server_ts FROM messages WHERE id = ?`).get(row.last_read_message_id)?.server_ts || 0)
    : 0;
  const count = db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND server_ts > ? AND deleted_at IS NULL AND author_id != ?`).get(conversationId, lastReadTs, userId);
  return count?.c || 0;
}

// ── Drafts / bookmarks / snooze / presence ─────────────────────────

export function saveDraft(db, { userId, conversationId, parentMessageId, body, attachments }) {
  if (!db || !userId || !conversationId) return { ok: false, reason: "missing_args" };
  try {
    db.prepare(`
      INSERT INTO drafts (user_id, conversation_id, parent_message_id, body, attachments_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, conversation_id, parent_message_id) DO UPDATE SET
        body = excluded.body, attachments_json = excluded.attachments_json, updated_at = excluded.updated_at
    `).run(userId, conversationId, parentMessageId || null, body || "", attachments ? JSON.stringify(attachments) : null, _now());
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getDraft(db, { userId, conversationId, parentMessageId }) {
  if (!db) return null;
  const row = db.prepare(`SELECT * FROM drafts WHERE user_id = ? AND conversation_id = ? AND parent_message_id IS ?`).get(userId, conversationId, parentMessageId || null);
  if (!row) return null;
  return { ...row, attachments: _safeJson(row.attachments_json, []) };
}

export function clearDraft(db, { userId, conversationId, parentMessageId }) {
  if (!db) return { ok: false, reason: "no_db" };
  const r = db.prepare(`DELETE FROM drafts WHERE user_id = ? AND conversation_id = ? AND parent_message_id IS ?`).run(userId, conversationId, parentMessageId || null);
  return { ok: true, cleared: r.changes };
}

export function addBookmark(db, { userId, messageId, note }) {
  if (!db || !userId || !messageId) return { ok: false, reason: "missing_args" };
  try {
    db.prepare(`
      INSERT INTO bookmarks (user_id, message_id, note, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, message_id) DO UPDATE SET note = excluded.note
    `).run(userId, messageId, note ? String(note).slice(0, 500) : null, _now());
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function removeBookmark(db, { userId, messageId }) {
  if (!db) return { ok: false, reason: "no_db" };
  const r = db.prepare(`DELETE FROM bookmarks WHERE user_id = ? AND message_id = ?`).run(userId, messageId);
  return { ok: true, removed: r.changes };
}

export function listBookmarks(db, userId, { limit = 100 } = {}) {
  if (!db) return [];
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  return db.prepare(`
    SELECT b.message_id, b.note, b.created_at, m.body, m.author_id, m.conversation_id
    FROM bookmarks b JOIN messages m ON m.id = b.message_id
    WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT ?
  `).all(userId, lim);
}

export function snoozeThread(db, { userId, conversationId, snoozedUntil, tag }) {
  if (!db || !userId || !conversationId) return { ok: false, reason: "missing_args" };
  try {
    db.prepare(`
      INSERT INTO thread_subscriptions (user_id, conversation_id, snoozed_until, tag, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, conversation_id) DO UPDATE SET
        snoozed_until = COALESCE(excluded.snoozed_until, thread_subscriptions.snoozed_until),
        tag = COALESCE(excluded.tag, thread_subscriptions.tag)
    `).run(userId, conversationId, snoozedUntil || null, tag ? String(tag).slice(0, 60) : null, _now());
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getThreadSubscription(db, { userId, conversationId }) {
  if (!db) return null;
  return db.prepare(`SELECT * FROM thread_subscriptions WHERE user_id = ? AND conversation_id = ?`).get(userId, conversationId);
}

export function setPresence(db, { userId, status, customText, focusUntil }) {
  if (!db || !userId) return { ok: false, reason: "missing_args" };
  if (!["online", "away", "dnd", "focus", "offline"].includes(status)) return { ok: false, reason: "invalid_status" };
  try {
    db.prepare(`
      INSERT INTO user_presence (user_id, status, custom_text, focus_until, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        status = excluded.status,
        custom_text = excluded.custom_text,
        focus_until = excluded.focus_until,
        updated_at = excluded.updated_at
    `).run(userId, status, customText ? String(customText).slice(0, 200) : null, focusUntil || null, _now());
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getPresenceMany(db, userIds = []) {
  if (!db || !Array.isArray(userIds) || userIds.length === 0) return [];
  const placeholders = userIds.map(() => "?").join(",");
  return db.prepare(`SELECT * FROM user_presence WHERE user_id IN (${placeholders})`).all(...userIds);
}
