// server/domains/voice-chat.js — Phase I3 voice chat WebRTC signalling.
//
// Minimal signalling relay. Frontend creates peer connections directly;
// this surface lets clients exchange offer/answer/ice over the existing
// socket.io connection. Separate from the existing voice domain (which
// does transcript analysis), hence the distinct name.
//
// Phase X — adds room state for multi-party (~8 peer cap):
//   * room_state(roomId)  — list current participants
//   * join(roomId)        — enter room + broadcast voice:participant-joined
//   * leave(roomId)       — exit + broadcast voice:participant-left

// In-memory room registry: roomId -> Set<userId>. Process-local; on
// restart all rooms reset. Long-lived persistence isn't needed —
// peers re-discover via the existing realtime socket join.
const _rooms = new Map();

function _getRoom(roomId) {
  let s = _rooms.get(roomId);
  if (!s) { s = new Set(); _rooms.set(roomId, s); }
  return s;
}

export default function registerVoiceChatMacros(register) {
  register("voice_chat", "room_state", async (ctx, input = {}) => {
    const { roomId } = input || {};
    if (!roomId) return { ok: false, reason: "missing_room_id" };
    const peers = Array.from(_getRoom(roomId));
    return { ok: true, roomId, peers };
  }, { note: "List current peers in a voice room." });

  register("voice_chat", "join", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { roomId } = input || {};
    if (!roomId) return { ok: false, reason: "missing_room_id" };
    const room = _getRoom(roomId);
    const wasNew = !room.has(userId);
    room.add(userId);
    try {
      if (wasNew && globalThis?.__CONCORD_REALTIME__?.io) {
        // Broadcast to everyone else already in the room.
        for (const otherId of room) {
          if (otherId === userId) continue;
          globalThis.__CONCORD_REALTIME__.io.to(`user:${otherId}`).emit("voice:participant-joined", { roomId, userId });
        }
      }
    } catch { /* optional */ }
    return { ok: true, roomId, peers: Array.from(room) };
  }, { note: "Enter a voice room and broadcast presence." });

  register("voice_chat", "leave_room", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { roomId } = input || {};
    if (!roomId) return { ok: false, reason: "missing_room_id" };
    const room = _getRoom(roomId);
    const removed = room.delete(userId);
    try {
      if (removed && globalThis?.__CONCORD_REALTIME__?.io) {
        for (const otherId of room) {
          globalThis.__CONCORD_REALTIME__.io.to(`user:${otherId}`).emit("voice:participant-left", { roomId, userId });
        }
      }
    } catch { /* optional */ }
    if (room.size === 0) _rooms.delete(roomId);
    return { ok: true, roomId, removed };
  }, { note: "Leave a voice room and broadcast departure." });


  register("voice_chat", "offer", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { targetUserId, sdp } = input || {};
    if (!targetUserId || !sdp) return { ok: false, reason: "missing_inputs" };
    try {
      if (globalThis?.__CONCORD_REALTIME__?.io) {
        globalThis.__CONCORD_REALTIME__.io.to(`user:${targetUserId}`).emit("voice:offer", { from: userId, sdp });
      }
    } catch { /* optional */ }
    return { ok: true };
  }, { note: "Relay WebRTC offer to target user." });

  register("voice_chat", "answer", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { targetUserId, sdp } = input || {};
    if (!targetUserId || !sdp) return { ok: false, reason: "missing_inputs" };
    try {
      if (globalThis?.__CONCORD_REALTIME__?.io) {
        globalThis.__CONCORD_REALTIME__.io.to(`user:${targetUserId}`).emit("voice:answer", { from: userId, sdp });
      }
    } catch { /* optional */ }
    return { ok: true };
  }, { note: "Relay WebRTC answer back to caller." });

  register("voice_chat", "ice", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { targetUserId, candidate } = input || {};
    if (!targetUserId || !candidate) return { ok: false, reason: "missing_inputs" };
    try {
      if (globalThis?.__CONCORD_REALTIME__?.io) {
        globalThis.__CONCORD_REALTIME__.io.to(`user:${targetUserId}`).emit("voice:ice", { from: userId, candidate });
      }
    } catch { /* optional */ }
    return { ok: true };
  }, { note: "Relay ICE candidate." });

  register("voice_chat", "leave", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { targetUserId } = input || {};
    if (!targetUserId) return { ok: false, reason: "missing_inputs" };
    try {
      if (globalThis?.__CONCORD_REALTIME__?.io) {
        globalThis.__CONCORD_REALTIME__.io.to(`user:${targetUserId}`).emit("voice:leave", { from: userId });
      }
    } catch { /* optional */ }
    return { ok: true };
  }, { note: "Notify peer of disconnect." });
}
