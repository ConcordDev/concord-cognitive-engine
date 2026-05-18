// server/domains/messaging-channels.js
//
// Message lens Sprint A #3 — Slack-style channels.
//
// A channel is a conversation with kind='channel'. This domain just
// adds the discovery + join surface (browse all channels in a
// workspace, join one, set topic). All persistence lives in
// migration 209's conversations table.

import {
  createConversation, getConversation, addParticipant, removeParticipant,
  hasRole, listParticipants,
} from "../lib/messaging/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

function _emitConvo(conversationId, event, payload) {
  try {
    globalThis._concordREALTIME?.io?.to(`conversation:${conversationId}`).emit(event, { conversationId, ...payload, ts: Date.now() });
  } catch { /* best effort */ }
}

function _now() { return Math.floor(Date.now() / 1000); }

export default function registerMessagingChannelsMacros(register) {
  register("messaging", "channel_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const name = String(input.name || "").trim();
    if (!name || !/^[a-z0-9_\-]{2,40}$/i.test(name)) return { ok: false, reason: "invalid_name", hint: "2-40 chars, alphanumeric + _ -" };
    const topic = String(input.topic || "").slice(0, 200);
    const workspaceId = input.workspaceId ? String(input.workspaceId) : "default";
    return createConversation(db, {
      kind: "channel", title: name, topic, ownerId: userId,
      participants: [userId], workspaceId,
    });
  }, { destructive: true, note: "Create a new channel in a workspace. Caller becomes owner." });

  register("messaging", "channel_browse", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const workspaceId = input.workspaceId ? String(input.workspaceId) : "default";
    const q = input.q ? String(input.q).toLowerCase() : null;
    const limit = Math.min(200, Math.max(1, Number(input.limit) || 100));
    const sql = q
      ? `SELECT id, title, topic, owner_id, created_at, updated_at FROM conversations
         WHERE kind = 'channel' AND workspace_id = ?
           AND (LOWER(title) LIKE ? OR LOWER(topic) LIKE ?)
         ORDER BY updated_at DESC LIMIT ?`
      : `SELECT id, title, topic, owner_id, created_at, updated_at FROM conversations
         WHERE kind = 'channel' AND workspace_id = ?
         ORDER BY updated_at DESC LIMIT ?`;
    const rows = q
      ? db.prepare(sql).all(workspaceId, `%${q}%`, `%${q}%`, limit)
      : db.prepare(sql).all(workspaceId, limit);
    const userId = _actor(ctx);
    const augmented = rows.map((r) => {
      const memberCount = db.prepare(`SELECT COUNT(*) AS c FROM conversation_participants WHERE conversation_id = ?`).get(r.id)?.c || 0;
      const joined = userId ? !!db.prepare(`SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`).get(r.id, userId) : false;
      return { ...r, memberCount, joined };
    });
    return { ok: true, channels: augmented, count: augmented.length };
  }, { note: "Browse channels in a workspace; query filters by title/topic substring" });

  register("messaging", "channel_join", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    if (!conversationId) return { ok: false, reason: "conversationId_required" };
    const channel = getConversation(db, conversationId);
    if (!channel || channel.kind !== "channel") return { ok: false, reason: "not_a_channel" };
    const r = addParticipant(db, { conversationId, userId, role: "member" });
    if (r.ok) _emitConvo(conversationId, "channel:joined", { userId });
    return r;
  }, { destructive: true, note: "Join a channel as a member" });

  register("messaging", "channel_leave", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    if (!conversationId) return { ok: false, reason: "conversationId_required" };
    const r = removeParticipant(db, { conversationId, userId });
    if (r.ok) _emitConvo(conversationId, "channel:left", { userId });
    return r;
  }, { destructive: true, note: "Leave a channel (owner cannot leave — transfer ownership first)" });

  register("messaging", "channel_set_topic", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    const topic = String(input.topic || "").slice(0, 200);
    if (!conversationId) return { ok: false, reason: "conversationId_required" };
    if (!hasRole(db, conversationId, userId, "admin")) return { ok: false, reason: "forbidden" };
    db.prepare(`UPDATE conversations SET topic = ?, updated_at = ? WHERE id = ?`).run(topic, _now(), conversationId);
    _emitConvo(conversationId, "channel:topic-changed", { topic, byUserId: userId });
    return { ok: true, conversationId, topic };
  }, { destructive: true, note: "Set the channel topic (admin+)" });

  register("messaging", "channel_members", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    if (!conversationId) return { ok: false, reason: "conversationId_required" };
    if (!hasRole(db, conversationId, userId, "guest")) return { ok: false, reason: "forbidden" };
    return { ok: true, members: listParticipants(db, conversationId) };
  }, { note: "List members of a channel (visible to participants only)" });
}
