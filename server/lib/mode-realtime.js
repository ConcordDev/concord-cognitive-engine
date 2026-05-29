// server/lib/mode-realtime.js
//
// Reusable "emit on change" helpers for game-mode HUDs — the server half of the
// polling→push conversion. Route handlers (which have req.app.locals.io) and
// heartbeat cycles (which get io passed in) call these the moment a mode's state
// mutates, so the client refreshes instantly instead of polling on an interval.
//
// Per-user push uses the `user:${userId}` room joined on socket auth; per-world
// uses `world:${worldId}`. Payload is enriched with `ts` for client ordering.
// Fully guarded: a null io or bad room never throws (push is best-effort; the
// client keeps a slow backstop poll for reconnect gaps).

/** Push a mode state-change to one authenticated user. Returns whether it emitted. */
export function emitModeToUser(io, userId, event, payload = {}) {
  if (!io || !userId || !event) return false;
  try {
    io.to(`user:${userId}`).emit(event, { ...payload, ts: Date.now() });
    return true;
  } catch { return false; }
}

/** Push a mode state-change to everyone in a world (spectators, shared sessions). */
export function emitModeToWorld(io, worldId, event, payload = {}) {
  if (!io || !worldId || !event) return false;
  try {
    io.to(`world:${worldId}`).emit(event, { ...payload, ts: Date.now() });
    return true;
  } catch { return false; }
}

/** Push to an arbitrary room (e.g. a session/table room). */
export function emitModeToRoom(io, room, event, payload = {}) {
  if (!io || !room || !event) return false;
  try {
    io.to(room).emit(event, { ...payload, ts: Date.now() });
    return true;
  } catch { return false; }
}
