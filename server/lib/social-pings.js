/**
 * Social Pings — quick spatial signals between players.
 *
 * The audit flagged multiplayer at 1/10 because, while presence existed, there
 * was no way for players to interact across the world other than chat. This
 * module is the missing "ping the map" / "wave at someone" / "loot here" /
 * "follow me" / "danger" layer that AAA multiplayer worlds use to keep
 * tactical communication frictionless.
 *
 * Six ping types, all spatially scoped (only nearby players see them):
 *   wave        — friendly greeting at sender's position
 *   needs_help  — distress beacon
 *   loot_here   — calls attention to a drop
 *   meet_here   — rally point
 *   danger      — warns of a hostile
 *   inspect     — points at a building/object/NPC
 *
 * Per-user rate limit: max PINGS_PER_MINUTE = 12, with a 4-second cooldown
 * between identical-type pings. Rejection drops silently (no DoS surface).
 *
 * No persistence. Pings are ephemeral broadcast-only events.
 */

import logger from "../logger.js";

const PING_TYPES = Object.freeze(new Set([
  "wave", "needs_help", "loot_here", "meet_here", "danger", "inspect",
]));

const PINGS_PER_MINUTE       = 12;
const SAME_TYPE_COOLDOWN_MS  = 4000;
const BROADCAST_RADIUS_M     = 800;

const _userPingHistory = new Map(); // userId -> { count, windowStart, lastByType: Map<type, ts> }

function _checkRate(userId, type) {
  const now = Date.now();
  let h = _userPingHistory.get(userId);
  if (!h) {
    h = { count: 0, windowStart: now, lastByType: new Map() };
    _userPingHistory.set(userId, h);
  }
  // Slide the 60s window
  if (now - h.windowStart > 60_000) {
    h.count = 0;
    h.windowStart = now;
  }
  if (h.count >= PINGS_PER_MINUTE) return { ok: false, reason: "rate_limited" };

  const lastSame = h.lastByType.get(type) ?? 0;
  if (now - lastSame < SAME_TYPE_COOLDOWN_MS) return { ok: false, reason: "type_cooldown", remainingMs: SAME_TYPE_COOLDOWN_MS - (now - lastSame) };

  h.count += 1;
  h.lastByType.set(type, now);
  return { ok: true };
}

/**
 * Broadcast a social ping. Returns the count of peers that received it.
 *
 * @param {{ ready, io }} REALTIME
 * @param {Function} getNearbyUserIds  - (cityId, position, radius) => string[]
 * @param {object} args
 *   - userId: pinger
 *   - cityId, position
 *   - type: one of PING_TYPES
 *   - target?: { kind: 'npc'|'building'|'player', id }   (optional)
 *   - text?:   short string (sanitized to 80 chars)
 */
export function broadcastSocialPing(REALTIME, getNearbyUserIds, args) {
  if (!REALTIME?.ready || !REALTIME.io) return { delivered: 0, reason: "no_realtime" };
  const { userId, cityId, position, type, target = null, text = "" } = args ?? {};

  if (!userId || !cityId || !position) return { delivered: 0, reason: "missing_fields" };
  if (!PING_TYPES.has(type))            return { delivered: 0, reason: "invalid_type" };

  const rate = _checkRate(userId, type);
  if (!rate.ok) return { delivered: 0, reason: rate.reason, remainingMs: rate.remainingMs };

  const safeText = String(text || "").slice(0, 80);

  try {
    const peers = (getNearbyUserIds?.(cityId, position, BROADCAST_RADIUS_M) ?? []);
    const payload = {
      from:      userId,
      type,
      position,
      cityId,
      target,
      text:      safeText,
      ts:        new Date().toISOString(),
    };
    let delivered = 0;
    for (const uid of peers) {
      try {
        REALTIME.io.to(`user:${uid}`).emit("social:ping", payload);
        delivered++;
      } catch { /* per-peer best-effort */ }
    }
    return { delivered, payload };
  } catch (err) {
    logger?.warn?.({ err: err.message }, "social_ping_broadcast_failed");
    return { delivered: 0, reason: "broadcast_failed" };
  }
}

export function _resetPingState() { _userPingHistory.clear(); }
