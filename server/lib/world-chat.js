// server/lib/world-chat.js
//
// In-world chat for the game clients on /unity-ws and /godot-ws: one
// `chat:send` verb with three channels, each backed by a substrate that
// already exists rather than a new chat store.
//
//   say   — proximity chat. Delegates to lib/proximity-chat.js (validation,
//           rate limit, and recipients resolved from the SENDER's
//           server-tracked position, never a client x/z). Range is
//           PROXIMITY_CHAT_RADIUS_M (40 m default), clamped to 5..200 m when
//           the client passes `radius`. The browser's proximity:chat:send uses
//           the same module, so web and Unity players in earshot hear each
//           other.
//   tell  — one named player, any distance. `to` is a userId or username.
//           The addressee must have live presence and not be hidden, so a tell
//           never reveals that an appear-offline player is online.
//   party — every other member of the sender's party (lib/parties.js),
//           any distance.
//
// Like proximity chat, nothing here is persisted: a message reaches whoever
// is connected when it is sent. This module only validates and resolves
// recipients; server.js delivers (see _deliverWorldChat).

import {
  buildProximityChatMessage,
  resolveProximityRecipients,
  PROXIMITY_CHAT_BODY_MAX_LEN,
} from "./proximity-chat.js";
import { getUserPosition, getUserVisibility } from "./city-presence.js";
import { getMyParty } from "./parties.js";

export const WORLD_CHAT_CHANNELS = Object.freeze(["say", "tell", "party"]);

// tell + party share one per-user budget, the same size as proximity chat's
// (20 per rolling minute). `say` is limited inside proximity-chat.js.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const _rateState = new Map(); // userId -> { count, windowStart }

function _rateLimited(userId, now = Date.now()) {
  const s = _rateState.get(userId);
  if (!s || now - s.windowStart >= RATE_LIMIT_WINDOW_MS) {
    _rateState.set(userId, { count: 1, windowStart: now });
    return false;
  }
  s.count++;
  return s.count > RATE_LIMIT_MAX;
}

function _newId() {
  return `wchat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function _resolveAddressee(db, to) {
  const key = String(to ?? "").trim().slice(0, 128);
  if (!key) return null;
  if (getUserPosition(key)) return key;
  if (!db) return null;
  try {
    const row = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(key);
    return row?.id || null;
  } catch {
    return null;
  }
}

/**
 * Validate a chat:send and resolve who receives it.
 *
 * @param {object|null} db
 * @param {{senderId:string, senderName?:string|null, text:string, channel?:string, to?:string, radius?:number}} msg
 * @returns {{ok:true, message:object, recipients:string[], proximity?:object}|{ok:false, reason:string}}
 *   `message` is the client-facing chat:message payload
 *   `{ id, from, fromName, channel, text, ts, to?, worldId? }`.
 *   `proximity` (say only) is proximity-chat's own message, for delivery to
 *   browser clients on their existing `proximity:chat` event.
 */
export function routeWorldChat(db, { senderId, senderName = null, text, channel = "say", to, radius } = {}) {
  if (!senderId) return { ok: false, reason: "sender_required" };
  const ch = String(channel || "say").toLowerCase();
  if (!WORLD_CHAT_CHANNELS.includes(ch)) return { ok: false, reason: "unknown_channel" };
  const fromName = senderName ? String(senderName).slice(0, 80) : null;

  if (ch === "say") {
    const built = buildProximityChatMessage(senderId, text, { radius, senderName: fromName });
    if (!built.ok) return { ok: false, reason: built.error };
    const p = built.message;
    return {
      ok: true,
      proximity: p,
      recipients: resolveProximityRecipients(senderId, p.radiusM),
      message: {
        id: p.id, from: senderId, fromName: p.senderName, channel: "say",
        text: p.body, ts: p.ts, worldId: p.worldId ?? null, radiusM: p.radiusM,
      },
    };
  }

  const body = String(text ?? "").trim();
  if (!body) return { ok: false, reason: "empty_body" };
  if (body.length > PROXIMITY_CHAT_BODY_MAX_LEN) return { ok: false, reason: "body_too_long" };

  let recipients;
  let addressee = null;
  if (ch === "tell") {
    if (to == null || String(to).trim() === "") return { ok: false, reason: "no_addressee" };
    addressee = _resolveAddressee(db, to);
    if (!addressee) return { ok: false, reason: "addressee_offline" };
    if (addressee === senderId) return { ok: false, reason: "cannot_tell_self" };
    if (!getUserPosition(addressee) || getUserVisibility(addressee) === "hidden") {
      return { ok: false, reason: "addressee_offline" };
    }
    recipients = [addressee];
  } else {
    const party = getMyParty(db, senderId);
    if (!party) return { ok: false, reason: "not_in_party" };
    recipients = (party.members || []).map((m) => m.userId).filter((id) => id && id !== senderId);
  }

  if (_rateLimited(senderId)) return { ok: false, reason: "rate_limited" };

  return {
    ok: true,
    recipients,
    message: {
      id: _newId(), from: senderId, fromName, channel: ch, text: body,
      ts: new Date().toISOString(),
      ...(addressee ? { to: addressee } : {}),
    },
  };
}

/** Test-only: reset the tell/party rate-limit state. */
export function _resetWorldChatRateLimit() {
  _rateState.clear();
}
