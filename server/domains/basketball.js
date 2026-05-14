// server/domains/basketball.js — Phase I2 basketball minigame surface.
import crypto from "node:crypto";

const _activeCourts = new Map();   // courtId -> state

export default function registerBasketballMacros(register) {
  register("basketball", "start_match", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { worldId, courtX = 0, courtZ = 0, durationS = 180 } = input || {};
    if (!worldId) return { ok: false, reason: "missing_worldId" };
    const id = `bball_${crypto.randomUUID()}`;
    _activeCourts.set(id, {
      worldId, courtX, courtZ, durationS,
      startedAt: Date.now(), score: { [userId]: 0 }, participants: [userId],
    });
    try {
      if (globalThis?.__CONCORD_REALTIME__?.io) {
        globalThis.__CONCORD_REALTIME__.io.to(`world:${worldId}`).emit("world:basketball-started", { courtId: id, worldId, courtPos: { x: courtX, z: courtZ }, durationS });
      }
    } catch { /* socket optional */ }
    return { ok: true, courtId: id };
  }, { note: "Open a basketball match. Emits world:basketball-started." });

  register("basketball", "score", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { courtId, points = 2 } = input || {};
    const court = _activeCourts.get(courtId);
    if (!court) return { ok: false, reason: "court_not_found" };
    court.score[userId] = (court.score[userId] || 0) + points;
    return { ok: true, score: court.score };
  }, { note: "Submit a basket." });

  register("basketball", "leaderboard", async (_ctx, input = {}) => {
    const { courtId } = input || {};
    const court = _activeCourts.get(courtId);
    if (!court) return { ok: false, reason: "court_not_found" };
    const board = Object.entries(court.score)
      .map(([userId, score]) => ({ userId, score: score }))
      .sort((a, b) => b.score - a.score);
    return { ok: true, board };
  }, { note: "Per-court scoreboard." });
}
