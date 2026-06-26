// server/lib/brawl.js
//
// Phase CA7 — Brawl mode (sifu_brawler profile invocation).
//
// combat-polish.js#COMBAT_PROFILES.sifu_brawler is purpose-built for
// fist-only 1v1: generous parry windows, 8-hit combo finisher
// threshold, perfect-dodge time dilation. The substrate's been there;
// this thin layer exposes the invite/accept/decline loop + flags the
// next combat encounter to use the profile.
//
// In-memory only — brawl invites are ephemeral (~60s TTL) and the
// flag is consumed by the next combat:attack route. No table.

import crypto from "node:crypto";
import logger from "../logger.js";

const INVITE_TTL_MS = 60 * 1000;
const _invites = new Map();   // inviteId → { fromUserId, toUserId, expiresAt }
const _activeBrawls = new Map(); // userId → opponentUserId

function _sweep() {
  const now = Date.now();
  for (const [id, inv] of _invites) {
    if (inv.expiresAt <= now) _invites.delete(id);
  }
}

export function inviteBrawl(fromUserId, toUserId) {
  if (!fromUserId || !toUserId) return { ok: false, error: "missing_inputs" };
  if (fromUserId === toUserId) return { ok: false, error: "self_invite" };
  _sweep();
  // De-dupe: one open invite per (from, to) at a time.
  for (const inv of _invites.values()) {
    if (inv.fromUserId === fromUserId && inv.toUserId === toUserId) {
      return { ok: true, inviteId: inv.id, alreadyOpen: true };
    }
  }
  const id = `brawl_${crypto.randomBytes(6).toString("hex")}`;
  _invites.set(id, { id, fromUserId, toUserId, expiresAt: Date.now() + INVITE_TTL_MS });
  logger.info?.("brawl", "invite", { id, fromUserId, toUserId });
  return { ok: true, inviteId: id, alreadyOpen: false };
}

export function acceptBrawl(inviteId, accepterUserId) {
  if (!inviteId || !accepterUserId) return { ok: false, error: "missing_inputs" };
  _sweep();
  const inv = _invites.get(inviteId);
  if (!inv) return { ok: false, error: "no_invite_or_expired" };
  if (inv.toUserId !== accepterUserId) return { ok: false, error: "not_invited" };
  _invites.delete(inviteId);
  _activeBrawls.set(inv.fromUserId, inv.toUserId);
  _activeBrawls.set(inv.toUserId, inv.fromUserId);
  return { ok: true, opponent: inv.fromUserId, profile: "sifu_brawler" };
}

export function declineBrawl(inviteId, declinerUserId) {
  if (!inviteId || !declinerUserId) return { ok: false, error: "missing_inputs" };
  const inv = _invites.get(inviteId);
  if (!inv) return { ok: true, alreadyExpired: true };
  if (inv.toUserId !== declinerUserId) return { ok: false, error: "not_invited" };
  _invites.delete(inviteId);
  return { ok: true };
}

export function isInBrawl(userId) {
  return _activeBrawls.has(userId);
}

export function getBrawlOpponent(userId) {
  return _activeBrawls.get(userId) || null;
}

export function endBrawl(userId) {
  const opp = _activeBrawls.get(userId);
  if (opp) {
    _activeBrawls.delete(userId);
    _activeBrawls.delete(opp);
  }
  return { ok: true, opponent: opp };
}

export function listOpenInvitesFor(userId) {
  _sweep();
  const out = [];
  for (const inv of _invites.values()) {
    if (inv.toUserId === userId) out.push(inv);
  }
  return out;
}

// Phase E7 — brawl matchmaking queue.
//
// Players join a global queue with joinQueue(userId). The heartbeat
// pops pairs every minute (or immediately if there are >= 2 waiting).
// On pair, we synthesise an inviteBrawl from the older queuer to the
// newer one so the existing acceptBrawl flow fires. Players who don't
// accept within INVITE_TTL_MS go back to the front of the queue
// implicitly (no auto-rematch — they need to re-queue).
//
// In-memory like the invite map. The heartbeat owns the popPair call.
const _queue = new Map(); // userId → { joinedAt, userName? }

export function joinQueue(userId, opts = {}) {
  if (!userId) return { ok: false, error: "missing_user" };
  if (_activeBrawls.has(userId)) return { ok: false, error: "already_in_brawl" };
  if (_queue.has(userId)) return { ok: true, alreadyQueued: true, joinedAt: _queue.get(userId).joinedAt };
  _queue.set(userId, { userId, joinedAt: Date.now(), userName: opts.userName || null });
  return { ok: true, joinedAt: _queue.get(userId).joinedAt, queueSize: _queue.size };
}

export function leaveQueue(userId) {
  if (!userId) return { ok: false, error: "missing_user" };
  const had = _queue.delete(userId);
  return { ok: true, removed: had };
}

export function queueStatus(userId = null) {
  return {
    ok: true,
    size: _queue.size,
    inQueue: userId ? _queue.has(userId) : null,
    joinedAt: userId && _queue.has(userId) ? _queue.get(userId).joinedAt : null,
  };
}

/**
 * F5 — disconnect sweep for a user: drop them from the matchmaking queue and
 * cancel any pending invites they're a party to. The TTL would eventually do
 * this, but a crashed/closed socket shouldn't linger in the queue or hold a
 * phantom invite. Idempotent; safe to call for users with no brawl state.
 */
export function cleanupForUser(userId) {
  if (!userId) return { ok: false, error: "missing_user" };
  _queue.delete(userId);
  let invitesCleared = 0;
  for (const [id, inv] of _invites) {
    if (inv.fromUserId === userId || inv.toUserId === userId) {
      _invites.delete(id);
      invitesCleared++;
    }
  }
  return { ok: true, invitesCleared };
}

/**
 * Pop the two oldest queuers and create a brawl invite between them.
 * Returns { ok, paired: { a, b, inviteId } } or { ok: true, paired: null }.
 */
export function popPair() {
  if (_queue.size < 2) return { ok: true, paired: null };
  // Sort by joinedAt; oldest two pair.
  const sorted = Array.from(_queue.values()).sort((x, y) => x.joinedAt - y.joinedAt);
  const a = sorted[0];
  const b = sorted[1];
  _queue.delete(a.userId);
  _queue.delete(b.userId);
  // The older queuer "invites" the newer one — symmetric in practice
  // because both opted into the queue.
  const inv = inviteBrawl(a.userId, b.userId);
  if (!inv.ok) {
    // Re-add both to the queue so they aren't lost.
    _queue.set(a.userId, a);
    _queue.set(b.userId, b);
    return { ok: false, reason: "invite_failed", detail: inv.error };
  }
  logger.info?.("brawl", "queue_paired", { a: a.userId, b: b.userId, inviteId: inv.inviteId });
  return { ok: true, paired: { a: a.userId, b: b.userId, inviteId: inv.inviteId } };
}

// Test-only reset.
export function _reset() {
  _invites.clear();
  _activeBrawls.clear();
  _queue.clear();
}

export { INVITE_TTL_MS };
