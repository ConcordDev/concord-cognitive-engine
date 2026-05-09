// server/lib/land-claims.js
//
// Phase 5a — Player Settlements + Land Claims.
//
// Players claim a circular plot. Within it they can build, gather, and
// invite co-owners. Unpaid maintenance bonds let claims expire.

import crypto from "node:crypto";
import logger from "../logger.js";

const MIN_RADIUS_M = 5;
const MAX_RADIUS_M = 200;
const DEFAULT_MAINTENANCE_PER_DAY = 5; // sparks/day
const BOND_FLOOR = 50;                 // sparks required to claim
const RADIUS_TO_BOND_M = 1.5;          // bond = max(BOND_FLOOR, radius * 1.5)

/**
 * Claim a circular plot. Returns { ok, claimId, bond, reason? }.
 * Refuses overlap with existing claims (any other claim's circle
 * intersects).
 */
export function claimLand(db, { userId, worldId, x, z, radiusM, walletDebit }) {
  if (!db || !userId || !worldId) return { ok: false, reason: "missing_inputs" };
  const r = Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, Number(radiusM) || MIN_RADIUS_M));
  const ax = Number(x) || 0;
  const az = Number(z) || 0;

  // Overlap check.
  const existing = db.prepare(`
    SELECT id, anchor_x, anchor_z, radius_m FROM land_claims
    WHERE world_id = ? AND status = 'active'
  `).all(worldId);
  for (const e of existing) {
    const dx = e.anchor_x - ax;
    const dz = e.anchor_z - az;
    const dist = Math.hypot(dx, dz);
    if (dist < r + e.radius_m) {
      return { ok: false, reason: "overlap", overlappingClaimId: e.id };
    }
  }

  const bond = Math.max(BOND_FLOOR, Math.round(r * RADIUS_TO_BOND_M));

  // Wallet debit (best-effort callable from caller). When absent we
  // proceed without charging — callers in tests typically don't pass it.
  if (typeof walletDebit === "function") {
    const charged = walletDebit(bond);
    if (!charged?.ok) return { ok: false, reason: "wallet_insufficient", bond };
  }

  const claimId = `lc_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO land_claims
        (id, owner_user_id, world_id, anchor_x, anchor_z, radius_m,
         bond_sparks, maintenance_per_day, claimed_at, last_maintained_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch(), 'active')
    `).run(claimId, userId, worldId, ax, az, r, bond, DEFAULT_MAINTENANCE_PER_DAY);
  } catch (err) { return { ok: false, reason: "insert_failed", error: err?.message }; }

  insertEvent(db, claimId, "build", userId, { action: "claim_created", radius: r, bond });
  return { ok: true, claimId, bond, radius: r, anchor: { x: ax, z: az } };
}

/** Add a co-owner / guest / tax-collector. */
export function inviteToClaim(db, { claimId, userId, role = "co_owner", invitedBy }) {
  if (!db || !claimId || !userId) return { ok: false, reason: "missing_inputs" };
  if (!["co_owner", "guest", "tax_collector"].includes(role)) {
    return { ok: false, reason: "bad_role" };
  }
  const claim = db.prepare(`SELECT owner_user_id, status FROM land_claims WHERE id = ?`).get(claimId);
  if (!claim) return { ok: false, reason: "claim_not_found" };
  if (invitedBy && claim.owner_user_id !== invitedBy) return { ok: false, reason: "not_owner" };
  if (claim.status !== "active") return { ok: false, reason: "claim_not_active" };
  try {
    db.prepare(`
      INSERT INTO land_claim_invites (claim_id, user_id, role, invited_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(claim_id, user_id) DO UPDATE SET role = excluded.role
    `).run(claimId, userId, role);
    insertEvent(db, claimId, "invite", invitedBy, { invited: userId, role });
    return { ok: true };
  } catch (err) { return { ok: false, reason: "insert_failed", error: err?.message }; }
}

/**
 * Tick maintenance for one claim. Returns:
 *   { ok, action: 'paid' | 'partial' | 'expired', bondAfter }
 * The heartbeat calls this once per claim per maintenance interval.
 */
export function tickMaintenance(db, claimId, opts = {}) {
  if (!db || !claimId) return { ok: false, reason: "missing_inputs" };
  const claim = db.prepare(`SELECT * FROM land_claims WHERE id = ?`).get(claimId);
  if (!claim) return { ok: false, reason: "claim_not_found" };
  if (claim.status !== "active") return { ok: true, action: "noop", reason: "not_active" };

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const elapsedDays = Math.max(0, (now - claim.last_maintained_at) / 86400);
  if (elapsedDays < 1) return { ok: true, action: "noop", elapsedDays };

  const due = Math.ceil(elapsedDays * claim.maintenance_per_day);
  let bondAfter = claim.bond_sparks - due;
  if (bondAfter < 0) bondAfter = 0;

  if (bondAfter <= 0) {
    db.prepare(`UPDATE land_claims SET status = 'expired', bond_sparks = 0 WHERE id = ?`).run(claimId);
    insertEvent(db, claimId, "expired", null, { due, elapsedDays });
    return { ok: true, action: "expired", bondAfter: 0 };
  }

  db.prepare(`
    UPDATE land_claims SET bond_sparks = ?, last_maintained_at = ? WHERE id = ?
  `).run(bondAfter, now, claimId);
  insertEvent(db, claimId, "maintenance_paid", null, { due, elapsedDays, bondAfter });
  return { ok: true, action: "paid", bondAfter, due };
}

/** Top-up the bond. Caller debits wallet. */
export function topUpBond(db, { claimId, userId, amount }) {
  if (!db || !claimId || !userId || !(amount > 0)) return { ok: false, reason: "missing_inputs" };
  const claim = db.prepare(`SELECT owner_user_id, status FROM land_claims WHERE id = ?`).get(claimId);
  if (!claim) return { ok: false, reason: "claim_not_found" };
  if (claim.owner_user_id !== userId) return { ok: false, reason: "not_owner" };
  if (claim.status !== "active") return { ok: false, reason: "claim_not_active" };
  try {
    db.prepare(`UPDATE land_claims SET bond_sparks = bond_sparks + ? WHERE id = ?`).run(Math.round(amount), claimId);
    insertEvent(db, claimId, "build", userId, { action: "bond_topup", amount: Math.round(amount) });
    return { ok: true };
  } catch (err) { return { ok: false, reason: "update_failed", error: err?.message }; }
}

/** Lookup the claim a point falls inside (or null). */
export function claimAt(db, worldId, x, z) {
  if (!db || !worldId) return null;
  try {
    const claims = db.prepare(`
      SELECT id, owner_user_id, anchor_x, anchor_z, radius_m
      FROM land_claims
      WHERE world_id = ? AND status = 'active'
    `).all(worldId);
    for (const c of claims) {
      const dx = c.anchor_x - x;
      const dz = c.anchor_z - z;
      if (Math.hypot(dx, dz) <= c.radius_m) return c;
    }
    return null;
  } catch { return null; }
}

/**
 * Permission check for a build/gather action. Returns true if userId
 * is owner or invited (any role except tax_collector for write ops).
 * If point is in no claim, returns true (open territory).
 */
export function canActIn(db, worldId, x, z, userId, action = "build") {
  const claim = claimAt(db, worldId, x, z);
  if (!claim) return true;
  if (claim.owner_user_id === userId) return true;
  try {
    const invite = db.prepare(`SELECT role FROM land_claim_invites WHERE claim_id = ? AND user_id = ?`).get(claim.id, userId);
    if (!invite) {
      if (action === "trespass_check") {
        insertEvent(db, claim.id, "trespass", userId, { x, z });
      }
      return false;
    }
    if (action === "build" && invite.role !== "co_owner") return false;
    return true;
  } catch { return false; }
}

/** List claims a user owns (or is invited to). */
export function listClaimsForUser(db, userId, includeInvites = true) {
  if (!db || !userId) return [];
  try {
    const owned = db.prepare(`
      SELECT * FROM land_claims WHERE owner_user_id = ? ORDER BY claimed_at DESC LIMIT 50
    `).all(userId);
    if (!includeInvites) return owned;
    const invited = db.prepare(`
      SELECT lc.*, lci.role AS invite_role FROM land_claims lc
      JOIN land_claim_invites lci ON lci.claim_id = lc.id
      WHERE lci.user_id = ? AND lc.status = 'active'
      ORDER BY lc.claimed_at DESC LIMIT 50
    `).all(userId);
    return [...owned, ...invited];
  } catch { return []; }
}

function insertEvent(db, claimId, kind, actor, detail) {
  try {
    db.prepare(`
      INSERT INTO land_claim_events (id, claim_id, kind, actor_id, detail_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
    `).run(`lce_${crypto.randomUUID()}`, claimId, kind, actor, JSON.stringify(detail || {}));
  } catch (err) {
    try { logger.debug?.("land-claims", "event_insert_failed", { error: err?.message }); }
    catch { /* ignore */ }
  }
}

export const _internal = {
  MIN_RADIUS_M, MAX_RADIUS_M, DEFAULT_MAINTENANCE_PER_DAY, BOND_FLOOR, RADIUS_TO_BOND_M,
};
