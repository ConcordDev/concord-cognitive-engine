// server/lib/inventory-audit.js
// Phase 10 of polish-to-ten — anti-duplication safeguards.
//
// Provides:
//   - logInventoryTransfer(db, opts) — append-only audit row
//   - scanForAnomalies(db, opts?)    — detection pass for the heartbeat
//
// Categories (must match migration 071 CHECK):
//   trade | craft | quest_reward | shop_buy | shop_sell | loot | gift |
//   consume | admin | system | other

import crypto from "crypto";

const ANOMALY_KINDS = new Set([
  "negative_quantity",
  "orphan_reservation",
  "lineage_break",
  "rapid_duplication",
  "manual_review",
]);

/**
 * Append-only audit log entry. Call from any code path that mutates
 * player_inventory rows or coin balances tied to inventory operations.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 * @param {string} [opts.actorUserId]   user that initiated the action
 * @param {string} [opts.fromUserId]    user the items left
 * @param {string} [opts.toUserId]      user the items arrived at
 * @param {string} [opts.itemId]
 * @param {string} [opts.itemName]
 * @param {number} opts.delta           positive = into to_user; negative = out of from_user
 * @param {string} opts.category
 * @param {string} [opts.refId]         trade id, quest id, etc — for tracing
 * @param {number} [opts.beforeQty]
 * @param {number} [opts.afterQty]
 * @param {string} [opts.notes]
 */
export function logInventoryTransfer(db, opts) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO inventory_audit_log (
      id, actor_user_id, from_user_id, to_user_id, item_id, item_name,
      delta, category, ref_id, before_qty, after_qty, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.actorUserId ?? null,
    opts.fromUserId ?? null,
    opts.toUserId ?? null,
    opts.itemId ?? null,
    opts.itemName ?? null,
    Math.trunc(Number(opts.delta) || 0),
    opts.category,
    opts.refId ?? null,
    opts.beforeQty ?? null,
    opts.afterQty ?? null,
    opts.notes ?? null,
  );
  return id;
}

/**
 * Open a new anomaly entry for human review.
 */
export function flagAnomaly(db, kind, opts) {
  if (!ANOMALY_KINDS.has(kind)) throw new Error(`unknown_anomaly_kind:${kind}`);
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO inventory_anomaly_queue (
      id, kind, user_id, item_id, inventory_id, details_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    kind,
    opts?.userId ?? null,
    opts?.itemId ?? null,
    opts?.inventoryId ?? null,
    opts?.details ? JSON.stringify(opts.details) : null,
  );
  return id;
}

/**
 * Heartbeat-friendly anomaly scan. Runs cheap queries:
 *   1. negative quantity rows (impossible — implies a bug or exploit)
 *   2. orphan reservations (reserved_until in the past but still locked)
 *   3. rapid duplication (>10 inserts of same item_id to same user in 60s
 *      via inventory_audit_log delta>0 entries — likely scripted exploit)
 *
 * Returns counts of newly-flagged anomalies. Idempotent: only flags
 * states that don't already have an `open` anomaly entry.
 */
export function scanForAnomalies(db, { now = Math.floor(Date.now() / 1000) } = {}) {
  const flagged = { negative_quantity: 0, orphan_reservation: 0, rapid_duplication: 0 };

  // 1. Negative quantity rows — should never exist.
  const negs = db.prepare(`
    SELECT id, user_id, item_id, quantity FROM player_inventory WHERE quantity < 0
  `).all();
  for (const row of negs) {
    const exists = db.prepare(`
      SELECT id FROM inventory_anomaly_queue
      WHERE inventory_id = ? AND kind = 'negative_quantity' AND status = 'open'
    `).get(row.id);
    if (exists) continue;
    flagAnomaly(db, "negative_quantity", {
      userId: row.user_id,
      itemId: row.item_id,
      inventoryId: row.id,
      details: { quantity: row.quantity },
    });
    flagged.negative_quantity += 1;
  }

  // 2. Orphan reservations — reserved_until in the past, still locked.
  const orphans = db.prepare(`
    SELECT id, user_id, item_id, reserved_by, reserved_until
      FROM player_inventory
     WHERE reserved_until IS NOT NULL AND reserved_until < ?
  `).all(now);
  for (const row of orphans) {
    const exists = db.prepare(`
      SELECT id FROM inventory_anomaly_queue
      WHERE inventory_id = ? AND kind = 'orphan_reservation' AND status = 'open'
    `).get(row.id);
    if (exists) continue;
    flagAnomaly(db, "orphan_reservation", {
      userId: row.user_id,
      itemId: row.item_id,
      inventoryId: row.id,
      details: { reservedBy: row.reserved_by, reservedUntil: row.reserved_until },
    });
    // Auto-clear the orphan reservation. Trade flow normally clears its own,
    // but if a trade row was deleted out-of-band the reservation is harmless
    // to release here.
    db.prepare(`
      UPDATE player_inventory SET reserved_until = NULL, reserved_by = NULL WHERE id = ?
    `).run(row.id);
    flagged.orphan_reservation += 1;
  }

  // 3. Rapid duplication — > 10 positive-delta audit entries for same
  //    (to_user_id, item_id) in the last 60s. Catches exploit scripts.
  const burst = db.prepare(`
    SELECT to_user_id AS user_id, item_id, COUNT(*) AS n, SUM(delta) AS total
      FROM inventory_audit_log
     WHERE ts >= ? AND delta > 0
     GROUP BY to_user_id, item_id
     HAVING n > 10
  `).all(now - 60);
  for (const row of burst) {
    const exists = db.prepare(`
      SELECT id FROM inventory_anomaly_queue
      WHERE user_id = ? AND item_id = ? AND kind = 'rapid_duplication' AND status = 'open'
    `).get(row.user_id, row.item_id);
    if (exists) continue;
    flagAnomaly(db, "rapid_duplication", {
      userId: row.user_id,
      itemId: row.item_id,
      details: { count: row.n, totalDelta: row.total, windowSec: 60 },
    });
    flagged.rapid_duplication += 1;
  }

  return flagged;
}
