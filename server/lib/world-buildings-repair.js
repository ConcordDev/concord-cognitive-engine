// server/lib/world-buildings-repair.js
//
// Sprint C / Track B4 — repairBuilding helper. Cost = (1 - health_pct)
// × build_cost × 0.4. Caller (kingdoms domain or city macro) supplies
// payer userId. Owner-only OR a kingdom decree must permit.
//
// Pre-condition: applyStructuralStress (already shipped as part of
// Layer 7.5) drains world_buildings.health_pct + flips state on threshold.
// Repair reverses that — bumps health_pct back up + reverts state if
// thresholds cross going up.

const STATE_DAMAGED_THRESHOLD = 0.4;
const STATE_COLLAPSED_THRESHOLD = 0.0;
const REPAIR_COST_RATE = 0.4;

export function repairBuilding(db, userId, buildingId, { fraction = 0.3 } = {}) {
  if (!db || !userId || !buildingId) return { ok: false, reason: "missing_inputs" };
  const b = db.prepare(`
    SELECT id, owner_user_id, kingdom_id, state, health_pct, build_cost
    FROM world_buildings WHERE id = ?
  `).get(buildingId);
  if (!b) return { ok: false, reason: "building_not_found" };

  // Authority: owner OR kingdom decree allowed (best-effort kingdom check).
  let allowed = b.owner_user_id === userId;
  if (!allowed && b.kingdom_id) {
    try {
      const k = db.prepare(`SELECT ruler_kind, ruler_id FROM realms WHERE id = ?`).get(b.kingdom_id);
      if (k?.ruler_kind === "player" && k.ruler_id === userId) allowed = true;
    } catch { /* kingdoms table absent */ }
  }
  if (!allowed) return { ok: false, reason: "not_authorised" };

  const cost = Math.ceil((1 - (b.health_pct ?? 1)) * (b.build_cost ?? 100) * REPAIR_COST_RATE);
  // Best-effort wallet debit — fail open if wallet table is missing.
  try {
    const w = db.prepare(`SELECT balance FROM user_wallets WHERE user_id = ?`).get(userId);
    if (w && (w.balance ?? 0) < cost) return { ok: false, reason: "insufficient_funds", cost };
    if (w) {
      db.prepare(`UPDATE user_wallets SET balance = balance - ? WHERE user_id = ?`).run(cost, userId);
    }
  } catch { /* user_wallets optional */ }

  const newHealth = Math.min(1.0, (b.health_pct ?? 1) + fraction);
  let newState = b.state;
  if (newHealth > STATE_DAMAGED_THRESHOLD) newState = "standing";
  else if (newHealth > STATE_COLLAPSED_THRESHOLD) newState = "damaged";
  db.prepare(`UPDATE world_buildings SET health_pct = ?, state = ? WHERE id = ?`).run(newHealth, newState, buildingId);

  return { ok: true, buildingId, health_pct: newHealth, state: newState, cost };
}

export const REPAIR_CONSTANTS = Object.freeze({ REPAIR_COST_RATE });
