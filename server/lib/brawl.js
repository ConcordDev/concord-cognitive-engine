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

// Test-only reset.
export function _reset() {
  _invites.clear();
  _activeBrawls.clear();
}

export { INVITE_TTL_MS };
