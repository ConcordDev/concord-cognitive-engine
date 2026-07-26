// server/lib/proximity-chat.js
//
// V1.2 Wave A — Society & Presence. A real, spatially-scoped, real-time-only
// chat channel: a message reaches every OTHER player within
// PROXIMITY_CHAT_RADIUS_M of the SENDER's own server-tracked position at the
// moment of sending — never a client-supplied x/z, and never a wider
// broadcast that relies on the client to filter honestly.
//
// ── Design decision: ephemeral, not persisted ──────────────────────────────
// This module intentionally has NO database table and NO history buffer.
// `server/lib/ambient-chat.js` (migration 231 `ambient_chat_messages`)
// already exists and IS a real, persisted, spatially-flavored chat system —
// but it is *district*-scoped by design (CLAUDE.md's own invariant: "Ambient
// chat is per-district... cross-district visibility is zero by design —
// encourages district identity"), with a bolt-on `/api/ambient-chat/proximity`
// read endpoint that filters that persisted, district-posted history down to
// messages from users who are CURRENTLY near the reader.
//
// True proximity chat, as asked for here, is a different shape: scoped by a
// live radius around a live position, not a zone id, and the "who's in
// range" set changes on every step either party takes. Reusing
// ambient-chat's persistence would force an uncomfortable choice: either
// (a) a message becomes readable by someone who walks into range *after* it
// was sent (they were never actually in earshot when it happened — a
// fabricated retroactive presence), or (b) build a parallel
// position-at-post-time-then-radius history table that duplicates
// ambient-chat's job with subtly incompatible semantics. Neither is honest.
// A message from someone 200m away who has since moved out of range
// SHOULD NOT be retrievable later — there both is no real record of who was
// in earshot at that past moment, and manufacturing one would misrepresent
// what actually happened. Ephemeral, direct-to-socket delivery is therefore
// the honest shape for this specific feature; district ambient chat remains
// the system of record for persisted, zone-scoped co-presence chatter.
//
// ── Design decision: recipient resolution reuses city-presence's own AOI math ──
// `resolveProximityRecipients` delegates entirely to
// `cityPresence.getNearbyUsers` — the same Euclidean 3D distance calculation
// already used by the movement anti-cheat / interest-management code — rather
// than inventing a second distance formula. Critically, it is evaluated
// against the SENDER's own server-tracked position (from the presence map
// city-presence.js already maintains from validated `player:move` packets),
// never a client-claimed x/z, so a client cannot widen or fake its own chat
// reach by lying about where it is. This also inherits the ghost/appear-
// offline exclusion (BD#27) for free: a hidden user is neither seen nor
// heard by anyone outside their own client, exactly as the visibility
// contract already promises for every other presence query in this file.

import { getNearbyUsers, getUserPosition } from "./city-presence.js";

// "Conversational earshot" default — tighter than the 500m default AOI
// radius (city-wide) and the ~150m 3x3-cell window ambient-chat's proximity
// READ uses (that one is a looser "recent chatter nearby" feed, not a live
// two-way channel). Override via env for ops tuning; callers may also pass
// an explicit radius per-message, clamped to [MIN_RADIUS_M, MAX_RADIUS_M].
export const PROXIMITY_CHAT_RADIUS_M = Number(process.env.CONCORD_PROXIMITY_CHAT_RADIUS_M) || 40;
const MIN_RADIUS_M = 5;
const MAX_RADIUS_M = 200;
export const PROXIMITY_CHAT_BODY_MAX_LEN = 280;

// Generous rate limit — this is a live chat channel a player may use
// continuously in conversation, not a broadcast/spam tool. Mirrors the
// shape of ambient-chat.js's rate limiter (count within a rolling window)
// but is in-memory only, matching this module's ephemeral nature.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const _rateState = new Map(); // userId -> { count, windowStart }

function _rateLimited(userId) {
  const now = Date.now();
  const s = _rateState.get(userId);
  if (!s || now - s.windowStart >= RATE_LIMIT_WINDOW_MS) {
    _rateState.set(userId, { count: 1, windowStart: now });
    return false;
  }
  s.count++;
  return s.count > RATE_LIMIT_MAX;
}

function clampRadius(radius) {
  const r = Number(radius);
  if (!Number.isFinite(r) || r <= 0) return PROXIMITY_CHAT_RADIUS_M;
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, r));
}

/**
 * Resolve who would currently receive a proximity chat message sent by
 * `senderId` — every OTHER user within `radius` metres of the sender's live,
 * server-tracked position, in the same city, excluding hidden/ghost users.
 * Pure delegation to city-presence's own AOI calculation; no separate
 * distance math is invented here.
 *
 * @param {string} senderId
 * @param {number} [radius=PROXIMITY_CHAT_RADIUS_M]
 * @returns {string[]} recipient userIds (never includes senderId itself)
 */
export function resolveProximityRecipients(senderId, radius = PROXIMITY_CHAT_RADIUS_M) {
  if (!senderId) return [];
  const sender = getUserPosition(senderId);
  if (!sender) return []; // sender has no live presence yet — nobody to reach
  const r = clampRadius(radius);
  return getNearbyUsers(senderId, r).map((u) => u.userId);
}

/**
 * Validate + build a proximity chat message. Pure — does not touch sockets
 * or send anything; the caller (server.js's `proximity:chat:send` socket
 * handler) resolves recipients separately (resolveProximityRecipients) and
 * fans the returned message out to each of them directly.
 *
 * @param {string} senderId
 * @param {string} body
 * @param {{ radius?: number, senderName?: string|null }} [opts]
 * @returns {{ok:true, message:object}|{ok:false, error:string}}
 */
export function buildProximityChatMessage(senderId, body, { radius = PROXIMITY_CHAT_RADIUS_M, senderName = null } = {}) {
  if (!senderId) return { ok: false, error: "sender_required" };
  const trimmed = String(body ?? "").trim();
  if (!trimmed) return { ok: false, error: "empty_body" };
  if (trimmed.length > PROXIMITY_CHAT_BODY_MAX_LEN) return { ok: false, error: "body_too_long" };
  const sender = getUserPosition(senderId);
  if (!sender) return { ok: false, error: "no_live_presence" };
  if (_rateLimited(senderId)) return { ok: false, error: "rate_limited" };
  const r = clampRadius(radius);
  return {
    ok: true,
    message: {
      id: `pchat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      senderId,
      senderName: senderName ? String(senderName).slice(0, 80) : null,
      body: trimmed,
      radiusM: r,
      position: { x: sender.x, y: sender.y, z: sender.z },
      cityId: sender.cityId,
      worldId: sender.worldId,
      ts: new Date().toISOString(),
    },
  };
}

/** Test-only: reset the in-memory rate-limit state between cases. */
export function _resetRateLimitState() {
  _rateState.clear();
}
