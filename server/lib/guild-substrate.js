// server/lib/guild-substrate.js
//
// Phase BC1 — guild bank + guild XP + guild hall.
//
// world-organizations.js stays as the in-memory social graph
// (createOrganization, joinOrganization, members map, treasury coin
// counter). This module is a DB-backed companion layer keyed by
// org_id, so guilds get:
//   - persisted XP + level (org_progression)
//   - shared item inventory (org_inventory, role-gated withdraw)
//   - audit log (org_inventory_log)
//   - hall claim (hall_building_id on the same row as XP)
//
// Role gating is via a caller-supplied `isOfficer(userId)` predicate
// because the role lookup lives in world-organizations.js (in-memory).

import crypto from "node:crypto";
import logger from "../logger.js";

const DEFAULT_XP_CURVE = (level) => 100 * level * level; // 100/400/900/1600/2500 ...

function _ensureProgressionRow(db, orgId) {
  db.prepare(`
    INSERT INTO org_progression (org_id) VALUES (?)
    ON CONFLICT DO NOTHING
  `).run(orgId);
}

export function getOrgProgression(db, orgId) {
  if (!db || !orgId) return null;
  try {
    _ensureProgressionRow(db, orgId);
    return db.prepare(`SELECT * FROM org_progression WHERE org_id = ?`).get(orgId);
  } catch { return null; }
}

/**
 * Award XP. If the new XP crosses the next-level threshold, rolls up
 * org_level and emits the new level on the return. Caller can wire to
 * realtime emit.
 */
export function awardOrgXp(db, orgId, amount, reason = "") {
  if (!db || !orgId) return { ok: false, error: "missing_inputs" };
  const amt = Math.max(0, Number(amount) || 0);
  if (amt <= 0) return { ok: true, awarded: 0 };
  try {
    _ensureProgressionRow(db, orgId);
    const cur = db.prepare(`SELECT org_xp, org_level FROM org_progression WHERE org_id = ?`).get(orgId);
    const newXp = (cur.org_xp || 0) + amt;
    let newLevel = cur.org_level || 1;
    while (newXp >= DEFAULT_XP_CURVE(newLevel)) newLevel++;
    db.prepare(`
      UPDATE org_progression SET org_xp = ?, org_level = ?, updated_at = unixepoch()
      WHERE org_id = ?
    `).run(newXp, newLevel, orgId);
    const leveledUp = newLevel > (cur.org_level || 1);
    logger.info?.("guild-substrate", "xp_awarded", { orgId, amount: amt, reason, newXp, newLevel, leveledUp });
    return { ok: true, awarded: amt, newXp, newLevel, leveledUp };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Claim a building as the org's guild hall. Sets hall_building_id +
 * world_buildings.owner_type='org' + owner_id=orgId. Idempotent on
 * the same building.
 */
export function claimHallBuilding(db, userId, orgId, buildingId, opts = {}) {
  if (!db || !userId || !orgId || !buildingId) return { ok: false, error: "missing_inputs" };
  if (typeof opts.isLeader === "function" && !opts.isLeader(userId)) {
    return { ok: false, error: "leader_only" };
  }
  try {
    const building = db.prepare(`
      SELECT id, world_id, owner_type, owner_id FROM world_buildings WHERE id = ?
    `).get(buildingId);
    if (!building) return { ok: false, error: "no_building" };

    _ensureProgressionRow(db, orgId);
    db.prepare(`
      UPDATE org_progression
      SET hall_building_id = ?, hall_world_id = ?, updated_at = unixepoch()
      WHERE org_id = ?
    `).run(buildingId, building.world_id, orgId);
    db.prepare(`
      UPDATE world_buildings SET owner_type = 'org', owner_id = ? WHERE id = ?
    `).run(orgId, buildingId);
    // Sprint 1 — claiming a hall is a major guild milestone → org XP.
    const xp = awardOrgXp(db, orgId, 200, "hall_claimed");
    return { ok: true, buildingId, worldId: building.world_id, orgLevel: xp.newLevel, orgLeveledUp: xp.leveledUp };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Deposit an item into the guild bank. Any member can deposit.
 * Idempotent on (org_id, item_descriptor) — re-depositing same item
 * stacks the quantity.
 */
export function depositToOrgInventory(db, userId, orgId, opts = {}) {
  if (!db || !userId || !orgId) return { ok: false, error: "missing_inputs" };
  if (typeof opts.isMember === "function" && !opts.isMember(userId)) {
    return { ok: false, error: "not_member" };
  }
  const { itemDescriptor, quantity, itemKind = "inventory" } = opts;
  if (!itemDescriptor || !Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: "invalid_item" };
  }
  if (!["dtu", "inventory"].includes(itemKind)) {
    return { ok: false, error: "invalid_kind" };
  }
  try {
    db.prepare(`
      INSERT INTO org_inventory (org_id, item_kind, item_descriptor, quantity, deposited_by)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(org_id, item_descriptor)
      DO UPDATE SET quantity = quantity + excluded.quantity,
                    deposited_by = excluded.deposited_by,
                    deposited_at = unixepoch()
    `).run(orgId, itemKind, itemDescriptor, quantity, userId);
    _logInventoryAction(db, orgId, "deposit", userId, itemDescriptor, quantity);
    // Sprint 1 — guild progression was dead (awardOrgXp had zero non-test
    // callers). Treasury contribution is real guild progress: 5 XP/item,
    // capped at 100/deposit so a stack-dump doesn't spike a level.
    const xp = awardOrgXp(db, orgId, Math.min(100, quantity * 5), "treasury_deposit");
    return { ok: true, deposited: quantity, orgXp: xp.newXp, orgLevel: xp.newLevel, orgLeveledUp: xp.leveledUp };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Withdraw an item from the guild bank. Requires officer+ role
 * (passed-in isOfficer predicate).
 */
export function withdrawFromOrgInventory(db, userId, orgId, opts = {}) {
  if (!db || !userId || !orgId) return { ok: false, error: "missing_inputs" };
  if (typeof opts.isOfficer !== "function" || !opts.isOfficer(userId)) {
    return { ok: false, error: "officer_required" };
  }
  const { itemDescriptor, quantity } = opts;
  if (!itemDescriptor || !Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: "invalid_item" };
  }
  try {
    const row = db.prepare(`
      SELECT quantity FROM org_inventory WHERE org_id = ? AND item_descriptor = ?
    `).get(orgId, itemDescriptor);
    if (!row || row.quantity < quantity) return { ok: false, error: "insufficient" };
    const next = row.quantity - quantity;
    if (next === 0) {
      db.prepare(`DELETE FROM org_inventory WHERE org_id = ? AND item_descriptor = ?`)
        .run(orgId, itemDescriptor);
    } else {
      db.prepare(`UPDATE org_inventory SET quantity = ? WHERE org_id = ? AND item_descriptor = ?`)
        .run(next, orgId, itemDescriptor);
    }
    _logInventoryAction(db, orgId, "withdraw", userId, itemDescriptor, quantity);
    return { ok: true, withdrawn: quantity, remaining: next };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listOrgInventory(db, orgId) {
  if (!db || !orgId) return [];
  try {
    return db.prepare(`
      SELECT item_kind, item_descriptor, quantity, deposited_by, deposited_at
      FROM org_inventory WHERE org_id = ?
      ORDER BY deposited_at DESC
    `).all(orgId);
  } catch { return []; }
}

export function getOrgInventoryLog(db, orgId, limit = 50) {
  if (!db || !orgId) return [];
  try {
    return db.prepare(`
      SELECT id, action, user_id, item_descriptor, quantity, ts
      FROM org_inventory_log WHERE org_id = ?
      ORDER BY ts DESC LIMIT ?
    `).all(orgId, Math.max(1, Math.min(500, limit)));
  } catch { return []; }
}

function _logInventoryAction(db, orgId, action, userId, itemDescriptor, quantity) {
  try {
    db.prepare(`
      INSERT INTO org_inventory_log (id, org_id, action, user_id, item_descriptor, quantity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(`oil_${crypto.randomBytes(6).toString("hex")}`, orgId, action, userId, itemDescriptor, quantity);
  } catch { /* log table missing; best-effort */ }
}

export { DEFAULT_XP_CURVE };
