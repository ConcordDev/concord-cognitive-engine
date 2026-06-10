// server/lib/world-tenancy.js
//
// Phase R — world marketplace. Users lease a copy of a world as a private
// tenant. Per-tenant world_id namespace (tenant_<baseWorld>_<slug>); shared
// substrate. LARP groups, classrooms, companies.
//
// CC-only billing. Cascade is handled by the standard royalty engine; the
// lease payment is recorded in economy_ledger.

import logger from "../logger.js";
import crypto from "node:crypto";

const TENANT_PREFIX = "tenant_";
const MAX_DURATION_DAYS = 365;

/**
 * Lease a world. Validates payment + creates the tenant record + adds
 * the owner as a member.
 *
 * @param {object} db
 * @param {object} input - { baseWorldId, ownerUserId, plan, durationDays, ccPaid }
 * @returns {object} { ok, tenantWorldId, error? }
 */
export function leaseWorld(db, input) {
  const { baseWorldId, ownerUserId, plan, durationDays = 30, ccPaid = 0 } = input || {};
  if (!db || !baseWorldId || !ownerUserId) {
    return { ok: false, error: "missing_inputs" };
  }
  if (!["private", "public", "public-read"].includes(plan)) {
    return { ok: false, error: "bad_plan" };
  }
  const days = Math.min(Math.max(1, Math.floor(Number(durationDays))), MAX_DURATION_DAYS);
  const leasedUntil = Math.floor(Date.now() / 1000) + days * 86_400;
  const tenantWorldId = `${TENANT_PREFIX}${baseWorldId}_${crypto.randomBytes(4).toString("hex")}`;

  try {
    db.prepare(`
      INSERT INTO world_tenancies
        (tenant_world_id, base_world_id, owner_user_id, plan, leased_until, cc_paid)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tenantWorldId, baseWorldId, ownerUserId, plan, leasedUntil, Number(ccPaid) || 0);

    db.prepare(`
      INSERT INTO world_tenant_members (tenant_world_id, user_id, role)
      VALUES (?, ?, 'owner')
    `).run(tenantWorldId, ownerUserId);

    return { ok: true, tenantWorldId, leasedUntil };
  } catch (err) {
    logger.warn?.("world-tenancy", "lease_failed", { baseWorldId, ownerUserId, error: err?.message });
    return { ok: false, error: err?.message };
  }
}

export function addTenantMember(db, tenantWorldId, userId, role = "member") {
  if (!["owner", "admin", "member", "spectator"].includes(role)) {
    return { ok: false, error: "bad_role" };
  }
  try {
    db.prepare(`
      INSERT INTO world_tenant_members (tenant_world_id, user_id, role)
      VALUES (?, ?, ?)
      ON CONFLICT(tenant_world_id, user_id) DO UPDATE SET role = excluded.role
    `).run(tenantWorldId, userId, role);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function removeTenantMember(db, tenantWorldId, userId) {
  try {
    db.prepare(`DELETE FROM world_tenant_members WHERE tenant_world_id = ? AND user_id = ?`).run(tenantWorldId, userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function getTenancy(db, tenantWorldId) {
  if (!db || !tenantWorldId) return null;
  try {
    return db.prepare(`SELECT * FROM world_tenancies WHERE tenant_world_id = ?`).get(tenantWorldId) || null;
  } catch {
    return null;
  }
}

export function listMyTenancies(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT t.*, COUNT(m.user_id) AS member_count
      FROM world_tenancies t
      LEFT JOIN world_tenant_members m ON m.tenant_world_id = t.tenant_world_id
      WHERE t.owner_user_id = ?
      GROUP BY t.tenant_world_id
      ORDER BY t.leased_until DESC
    `).all(userId);
  } catch {
    return [];
  }
}

/**
 * Access control — does this user have permission to act in this tenant?
 * Returns the resolved role or null if no access.
 */
export function getMemberRole(db, tenantWorldId, userId) {
  if (!db || !tenantWorldId || !userId) return null;
  try {
    const r = db.prepare(`
      SELECT role FROM world_tenant_members
      WHERE tenant_world_id = ? AND user_id = ?
    `).get(tenantWorldId, userId);
    return r?.role || null;
  } catch {
    return null;
  }
}

export function extendLease(db, tenantWorldId, extraDays, ccPaid = 0) {
  const days = Math.min(Math.max(1, Math.floor(Number(extraDays))), MAX_DURATION_DAYS);
  try {
    db.prepare(`
      UPDATE world_tenancies
      SET leased_until = leased_until + ?, cc_paid = cc_paid + ?
      WHERE tenant_world_id = ?
    `).run(days * 86_400, Number(ccPaid) || 0, tenantWorldId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** Sweep expired tenancies. Idempotent. */
export function sweepExpiredTenancies(db) {
  if (!db) return { swept: 0 };
  try {
    const expired = db.prepare(`
      SELECT tenant_world_id FROM world_tenancies WHERE leased_until < unixepoch()
    `).all();
    if (expired.length) {
      // Batch both deletes into one statement each (was a per-row N+1).
      const ids = expired.map((e) => e.tenant_world_id);
      const ph = ids.map(() => "?").join(",");
      db.prepare(`DELETE FROM world_tenant_members WHERE tenant_world_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM world_tenancies WHERE tenant_world_id IN (${ph})`).run(...ids);
    }
    return { swept: expired.length };
  } catch (err) {
    return { swept: 0, error: err?.message };
  }
}
