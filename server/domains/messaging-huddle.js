// server/domains/messaging-huddle.js
//
// Message lens Sprint C #20 — audio huddles bound to a conversation
// (Slack-style). Reuses the existing audio_rooms substrate (migration
// 200) — same trick as whiteboard Sprint C #16. Room id prefixed
// `messaging:<conversationId>:` so per-conversation listing filters
// cleanly.

import { randomUUID } from "node:crypto";
import * as rooms from "../lib/audio-rooms.js";
import { hasRole, getConversation } from "../lib/messaging/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

function _emit(conversationId, event, payload) {
  try {
    globalThis._concordREALTIME?.io?.to(`conversation:${conversationId}`).emit(event, { conversationId, ...payload, ts: Date.now() });
  } catch { /* best effort */ }
}

export default function registerMessagingHuddleMacros(register) {
  register("messaging", "huddle_start", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    if (!conversationId) return { ok: false, reason: "conversationId_required" };
    if (!hasRole(db, conversationId, userId, "member")) return { ok: false, reason: "forbidden" };
    const conv = getConversation(db, conversationId);
    if (!conv) return { ok: false, reason: "conversation_not_found" };
    const roomId = `messaging:${conversationId}:${randomUUID().slice(0, 6)}`;
    const r = rooms.createRoom(db, {
      roomId, hostUserId: userId,
      title: `Huddle: ${conv.title || conversationId}`.slice(0, 200),
      description: `Audio huddle for ${conv.kind} ${conversationId}`,
    });
    if (!r?.ok && !r?.id) return { ok: false, reason: "create_failed", room: r };
    _emit(conversationId, "messaging:huddle-started", { roomId, hostUserId: userId });
    return { ok: true, roomId, conversationId };
  }, { destructive: true, note: "Start an audio huddle bound to a conversation (member+)" });

  register("messaging", "huddle_join", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const roomId = String(input.roomId || "");
    if (!roomId) return { ok: false, reason: "roomId_required" };
    return rooms.joinAsListener(db, { roomId, userId });
  }, { destructive: true, note: "Join an active huddle as a listener" });

  register("messaging", "huddle_leave", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const roomId = String(input.roomId || "");
    if (!roomId) return { ok: false, reason: "roomId_required" };
    return rooms.leaveRoom(db, { roomId, userId });
  }, { destructive: true, note: "Leave a huddle" });

  register("messaging", "huddle_end", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const roomId = String(input.roomId || "");
    if (!roomId) return { ok: false, reason: "roomId_required" };
    return rooms.endRoom(db, { roomId, byUserId: userId });
  }, { destructive: true, note: "End a huddle (host-only — enforced by audio-rooms)" });

  register("messaging", "huddle_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const conversationId = input.conversationId ? String(input.conversationId) : null;
    const active = rooms.listActiveRooms(db, { limit: 50 });
    const list = Array.isArray(active?.rooms) ? active.rooms : [];
    const filtered = conversationId
      ? list.filter((r) => r.id?.startsWith(`messaging:${conversationId}:`))
      : list.filter((r) => r.id?.startsWith("messaging:"));
    return { ok: true, huddles: filtered };
  }, { note: "List active messaging huddles (optionally scoped to one conversation)" });
}
