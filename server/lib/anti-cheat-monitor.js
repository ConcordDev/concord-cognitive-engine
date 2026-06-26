// H3+ — per-user anomaly score. Every anti-cheat rejection (speed-hack,
// teleport, damage-cap) is an intelligence data point, not just a dropped
// packet: a client that accumulates many in a short window is running a tool, so
// we drop their socket to protect everyone nearby. Rolling-window counter,
// kill-switchable, with an injectable clock for tests.
//
// In-memory + per-process (single Node thread): noteRejection records a hit and
// reports whether the user has crossed the disconnect threshold within the
// window. The caller (the socket handler) owns the actual disconnect + metric.

const WINDOW_MS = Number(process.env.CONCORD_ANTICHEAT_WINDOW_MS) || 30_000;
const THRESHOLD = Math.max(2, Number(process.env.CONCORD_ANTICHEAT_THRESHOLD) || 12);

const _hits = new Map(); // userId -> number[] (rejection timestamps within the window)

/**
 * Record one anti-cheat rejection for a user.
 * @returns {{ count, threshold, shouldDisconnect }} — `shouldDisconnect` true
 *          when the user has hit THRESHOLD rejections inside the window (the
 *          counter is then cleared so we act once, not every subsequent packet).
 */
export function noteRejection(userId, now = Date.now()) {
  if (!userId || process.env.CONCORD_ANTICHEAT_MONITOR === "0") {
    return { count: 0, threshold: THRESHOLD, shouldDisconnect: false };
  }
  let arr = _hits.get(userId);
  if (!arr) { arr = []; _hits.set(userId, arr); }
  arr.push(now);
  const cutoff = now - WINDOW_MS;
  while (arr.length && arr[0] < cutoff) arr.shift();
  const shouldDisconnect = arr.length >= THRESHOLD;
  if (shouldDisconnect) _hits.delete(userId); // acted on — reset
  return { count: arr.length, threshold: THRESHOLD, shouldDisconnect };
}

/** Forget a user's anomaly history (call on clean disconnect). */
export function clearUser(userId) { if (userId) _hits.delete(userId); }

/** Test hook. */
export function _reset() { _hits.clear(); }
