// server/lib/godot-move-rate.js
//
// Godot-path player:move cadence gate. Mirrors the socket.io handler's
// per-socket ~30Hz (33ms) cap (server.js tryInitWebSockets →
// socket.on("player:move") `_moveRateState`). Pure helper so unit tests can
// pin the contract without booting the monolith or a live WebSocket.
//
// The generic godot-gateway token bucket (20/s sustained) still covers
// auth/room/scene/unknown events. This is the MOVE-SPECIFIC gate that
// docs/GODOT_INTEGRATION.md + audit v4 proposal #2 called out as the
// remaining throughput-tuning gap vs. the browser path.
//
// Silent drop on excess (return false) — never a nack flood. Same as the
// browser path, which silently returns before applyPlayerMove.

/** Default min interval between accepted player:move frames (~30Hz). */
export const GODOT_MOVE_MIN_INTERVAL_MS = 33;

/**
 * Build a per-userId min-interval gate.
 *
 * @param {object} [opts]
 * @param {number} [opts.minIntervalMs=33]
 * @param {() => number} [opts.now] injectable clock (ms)
 * @returns {{
 *   tryAccept: (userId: string|null|undefined, t?: number) => boolean,
 *   clear: (userId?: string|null) => void,
 *   peekLast: (userId: string) => number,
 *   size: () => number,
 *   _state: Map<string, number>,
 * }}
 */
export function makeGodotMoveRateGate({
  minIntervalMs = GODOT_MOVE_MIN_INTERVAL_MS,
  now = () => Date.now(),
} = {}) {
  const minMs = Math.max(0, Number(minIntervalMs) || GODOT_MOVE_MIN_INTERVAL_MS);
  /** @type {Map<string, number>} userId → last accepted move ms */
  const lastByUser = new Map();

  /**
   * @param {string|null|undefined} userId
   * @param {number} [t]
   * @returns {boolean} true if the move should proceed; false = silent drop
   */
  function tryAccept(userId, t) {
    if (userId == null || userId === "") return true; // caller still drops unauth
    const key = String(userId);
    const ts = Number.isFinite(t) ? t : now();
    // Distinguish "never seen" from "last accepted at epoch 0" — a missing
    // entry always accepts (establishes the baseline), matching socket.io's
    // `_moveRateState = { last: 0 }` first-hit behavior when now > 0 and also
    // the honest first-frame case under an injectable clock starting at 0.
    if (lastByUser.has(key)) {
      const last = lastByUser.get(key);
      if (ts - last < minMs) return false;
    }
    lastByUser.set(key, ts);
    return true;
  }

  /** Drop one user (or all, if no arg) — call on disconnect to bound memory. */
  function clear(userId) {
    if (userId == null || userId === "") {
      lastByUser.clear();
      return;
    }
    lastByUser.delete(String(userId));
  }

  function peekLast(userId) {
    return lastByUser.get(String(userId)) || 0;
  }

  return {
    tryAccept,
    clear,
    peekLast,
    size: () => lastByUser.size,
    _state: lastByUser,
  };
}

export default { makeGodotMoveRateGate, GODOT_MOVE_MIN_INTERVAL_MS };
