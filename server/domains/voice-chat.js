// server/domains/voice-chat.js — Phase I3 voice chat WebRTC signalling.
//
// Minimal signalling relay. Frontend creates peer connections directly;
// this surface lets clients exchange offer/answer/ice over the existing
// socket.io connection. Separate from the existing voice domain (which
// does transcript analysis), hence the distinct name.

export default function registerVoiceChatMacros(register) {
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
