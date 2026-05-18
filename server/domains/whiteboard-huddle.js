// server/domains/whiteboard-huddle.js
//
// Whiteboard Sprint C Item #16 — audio huddles inside a whiteboard.
//
// Real reuse of the audio_rooms substrate (migration 200). A huddle
// is just an audio_room keyed with whiteboard:<boardId> in the title
// so the lens can surface it. Participants resolve the same WebRTC
// path the Spaces lens uses.

import { randomUUID } from "node:crypto";
import * as rooms from "../lib/audio-rooms.js";
import { hasRole, getBoard } from "../lib/whiteboard/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

export default function registerWhiteboardHuddleMacros(register) {
  register("whiteboard", "huddle_start", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    if (!boardId) return { ok: false, reason: "boardId_required" };
    if (!hasRole(db, boardId, userId, "editor")) return { ok: false, reason: "forbidden" };
    const board = getBoard(db, boardId);
    if (!board) return { ok: false, reason: "board_not_found" };
    const roomId = `whiteboard:${boardId}:${randomUUID().slice(0, 6)}`;
    const r = rooms.createRoom(db, {
      roomId, hostUserId: userId,
      title: `Huddle: ${board.title || boardId}`.slice(0, 200),
      description: `Audio huddle for whiteboard ${boardId}`,
    });
    if (!r?.ok && !r?.id) return { ok: false, reason: "create_failed", room: r };
    try {
      globalThis._concordREALTIME?.io?.to(`whiteboard:${boardId}`).emit("whiteboard:huddle-started", {
        boardId, roomId, hostUserId: userId, ts: Date.now(),
      });
    } catch { /* best effort */ }
    return { ok: true, roomId, boardId };
  }, { destructive: true, note: "Start an audio huddle for a whiteboard (reuses audio_rooms substrate)" });

  register("whiteboard", "huddle_join", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const roomId = String(input.roomId || "");
    if (!roomId) return { ok: false, reason: "roomId_required" };
    return rooms.joinAsListener(db, { roomId, userId });
  }, { destructive: true, note: "Join an existing whiteboard huddle as a listener" });

  register("whiteboard", "huddle_leave", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const roomId = String(input.roomId || "");
    if (!roomId) return { ok: false, reason: "roomId_required" };
    return rooms.leaveRoom(db, { roomId, userId });
  }, { destructive: true, note: "Leave a whiteboard huddle" });

  register("whiteboard", "huddle_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const boardId = input.boardId ? String(input.boardId) : null;
    const active = rooms.listActiveRooms(db, { limit: 50 });
    const list = Array.isArray(active?.rooms) ? active.rooms : [];
    const filtered = boardId
      ? list.filter((r) => r.id && r.id.startsWith(`whiteboard:${boardId}:`))
      : list.filter((r) => r.id && r.id.startsWith("whiteboard:"));
    return { ok: true, huddles: filtered };
  }, { note: "List active whiteboard huddles (optionally scoped to one board)" });

  register("whiteboard", "huddle_end", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const roomId = String(input.roomId || "");
    if (!roomId) return { ok: false, reason: "roomId_required" };
    return rooms.endRoom(db, { roomId, byUserId: userId });
  }, { destructive: true, note: "End a whiteboard huddle (host only — enforced by audio-rooms)" });
}
