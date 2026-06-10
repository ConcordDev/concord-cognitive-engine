// server/lib/build-bill.js
//
// Living Society — Phase 0.6: conserved matter. Construction debits a real
// materials bill (extracted resources) instead of free spawns. Reused by
// Phase 1.5/2 settlement building + the player build path.
//
// A "bill" is [{ id, quantity }] (same shape as recipe/chain inputs). The
// builder may be a user (player_inventory, world-scoped) or a settlement
// (settlement_stores — Phase 2). Both share this verify+debit.

/** Default materials bill for a building type (overridable per build). */
export const BUILD_BILLS = Object.freeze({
  house:     [{ id: "wood", quantity: 20 }, { id: "stone", quantity: 10 }],
  inn:       [{ id: "wood", quantity: 30 }, { id: "stone", quantity: 20 }],
  forge:     [{ id: "stone", quantity: 30 }, { id: "iron_ingot", quantity: 8 }],
  market:    [{ id: "wood", quantity: 24 }, { id: "stone", quantity: 12 }],
  well:      [{ id: "stone", quantity: 24 }],
  tower:     [{ id: "stone", quantity: 50 }, { id: "iron_ingot", quantity: 12 }],
  farm:      [{ id: "wood", quantity: 12 }],
  warehouse: [{ id: "wood", quantity: 28 }, { id: "stone", quantity: 16 }],
  dock:      [{ id: "wood", quantity: 36 }],
  mine:      [{ id: "wood", quantity: 16 }, { id: "stone", quantity: 8 }],
});

export function billFor(buildingType, override = null) {
  if (Array.isArray(override) && override.length) return override;
  return BUILD_BILLS[buildingType] || [{ id: "wood", quantity: 10 }];
}

/** Does the player (world-scoped) hold the full bill? Returns { ok, missing }. */
export function canAfford(db, userId, worldId, bill) {
  const missing = [];
  for (const item of bill) {
    let have = 0;
    try {
      const row = db.prepare(`
        SELECT COALESCE(SUM(quantity),0) AS qty FROM player_inventory
        WHERE user_id = ? AND world_id = ? AND item_id = ?
      `).get(userId, worldId, item.id);
      have = row?.qty ?? 0;
    } catch { have = 0; }
    if (have < item.quantity) missing.push({ id: item.id, needed: item.quantity, have });
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Verify + debit a materials bill from the player's world-scoped inventory in a
 * single transaction. Returns { ok } or { ok:false, reason:'insufficient_materials', missing }.
 * No partial debits — all or nothing (conserved matter).
 */
export function debitBuildBill(db, userId, worldId, bill) {
  if (!db || !userId || !worldId || !Array.isArray(bill)) return { ok: false, reason: "missing_inputs" };
  if (process.env.CONCORD_RESOURCE_GATED_BUILD === "0") return { ok: true, skipped: true };
  const afford = canAfford(db, userId, worldId, bill);
  if (!afford.ok) return { ok: false, reason: "insufficient_materials", missing: afford.missing };
  const tx = db.transaction(() => {
    const selSlots = db.prepare(`
        SELECT id, quantity FROM player_inventory
        WHERE user_id = ? AND world_id = ? AND item_id = ? AND quantity > 0
        ORDER BY acquired_at ASC
      `);
    const delSlot = db.prepare(`DELETE FROM player_inventory WHERE id = ?`);
    const decSlot = db.prepare(`UPDATE player_inventory SET quantity = quantity - ? WHERE id = ?`);
    for (const item of bill) {
      let remaining = item.quantity;
      const slots = selSlots.all(userId, worldId, item.id);
      for (const slot of slots) {
        if (remaining <= 0) break;
        if (slot.quantity <= remaining) {
          delSlot.run(slot.id);
          remaining -= slot.quantity;
        } else {
          decSlot.run(remaining, slot.id);
          remaining = 0;
        }
      }
    }
  });
  try { tx(); } catch (e) { return { ok: false, reason: "debit_failed", error: e?.message }; }
  return { ok: true, debited: bill };
}
