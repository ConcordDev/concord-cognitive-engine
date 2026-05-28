// server/lib/spectator-mode.js
//
// Phase N — spectator mode.
//
// Spectators are sockets that subscribe to a world's realtime events
// without inserting a presence row. They count as 0 against the soft cap
// (Phase M) and against the shard idle teardown (Phase I). They see what
// happens in the world but cannot interact.
//
// Use cases: faction wars in sovereign-ruins, cyber election night,
// lattice-crucible PvP tournaments, classroom observation, AI-resident
// monitoring.

import logger from "../logger.js";

/** @type {Map<string, Set<string>>} worldId → Set<socketId> */
const _spectators = new Map();

/**
 * Attach a spectator socket to a world. Joins the standard `world:${worldId}`
 * room (so it receives all world events) plus a `:spectator` sibling room
 * (for spectator-only overlays like fight stats / commentary).
 *
 * @param {object} socket - Socket.IO socket instance
 * @param {string} worldId
 * @returns {{ ok: boolean, count: number }}
 */
export function joinSpectator(socket, worldId) {
  if (!socket || !worldId) return { ok: false, count: 0 };
  try {
    socket.join(`world:${worldId}`);
    socket.join(`world:${worldId}:spectator`);
  } catch (err) {
    logger.warn?.("spectator-mode", "join_failed", { worldId, error: err?.message });
    return { ok: false, count: 0 };
  }
  let set = _spectators.get(worldId);
  if (!set) { set = new Set(); _spectators.set(worldId, set); }
  set.add(socket.id);
  socket._concordSpectatorWorldId = worldId;
  return { ok: true, count: set.size };
}

/**
 * Detach a spectator socket from its world (on disconnect or explicit leave).
 */
export function leaveSpectator(socket) {
  if (!socket) return;
  const worldId = socket._concordSpectatorWorldId;
  if (!worldId) return;
  try {
    socket.leave(`world:${worldId}`);
    socket.leave(`world:${worldId}:spectator`);
  } catch { /* socket may already be gone */ }
  const set = _spectators.get(worldId);
  if (set) {
    set.delete(socket.id);
    if (set.size === 0) _spectators.delete(worldId);
  }
  socket._concordSpectatorWorldId = null;
}

/** Total spectator count for a world. */
export function getSpectatorCount(worldId) {
  if (!worldId) return 0;
  return _spectators.get(worldId)?.size ?? 0;
}

/** Snapshot for ops-telemetry — { worldId: count }. */
export function listSpectatorCounts() {
  const out = {};
  for (const [worldId, set] of _spectators) {
    out[worldId] = set.size;
  }
  return out;
}

/** Test-only reset. */
export function _resetSpectators() {
  _spectators.clear();
}
