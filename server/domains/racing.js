// server/domains/racing.js — Phase I1 racing minigame surface.
import crypto from "node:crypto";

const _activeRaces = new Map();        // raceId -> { worldId, startedAt, laps, participants[] }
const _bestLapsByWorld = new Map();    // worldId -> [{ userId, laps, totalTimeMs }]

export default function registerRacingMacros(register) {
  register("racing", "start_race", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { worldId, laps = 3 } = input || {};
    if (!worldId) return { ok: false, reason: "missing_worldId" };
    const id = `race_${crypto.randomUUID()}`;
    _activeRaces.set(id, { worldId, startedAt: Date.now(), laps, participants: [userId], lapTimes: {} });
    try {
      if (globalThis?.__CONCORD_REALTIME__?.io) {
        globalThis.__CONCORD_REALTIME__.io.to(`world:${worldId}`).emit("world:racing-started", { raceId: id, worldId, startedBy: userId, laps });
      }
    } catch { /* socket optional */ }
    return { ok: true, raceId: id, laps };
  }, { note: "Start a new race in a world. Emits world:racing-started." });

  register("racing", "submit_lap", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { raceId, lapMs } = input || {};
    if (!raceId || typeof lapMs !== "number") return { ok: false, reason: "missing_inputs" };
    const race = _activeRaces.get(raceId);
    if (!race) return { ok: false, reason: "race_not_found" };
    race.lapTimes[userId] = race.lapTimes[userId] || [];
    race.lapTimes[userId].push(lapMs);
    if (race.lapTimes[userId].length >= race.laps) {
      // Race complete for this user.
      const total = race.lapTimes[userId].reduce((a, b) => a + b, 0);
      const board = _bestLapsByWorld.get(race.worldId) || [];
      board.push({ userId, laps: race.laps, totalTimeMs: total });
      board.sort((a, b) => a.totalTimeMs - b.totalTimeMs);
      _bestLapsByWorld.set(race.worldId, board.slice(0, 20));
    }
    return { ok: true, lapsCompleted: race.lapTimes[userId].length };
  }, { note: "Submit a lap time for a race." });

  register("racing", "leaderboard", async (_ctx, input = {}) => {
    const { worldId } = input || {};
    if (!worldId) return { ok: false, reason: "missing_worldId" };
    return { ok: true, board: _bestLapsByWorld.get(worldId) || [] };
  }, { note: "Top 20 race times per world." });
}
