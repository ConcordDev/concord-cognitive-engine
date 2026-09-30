// server/lib/runtime/capability-promotion.js
//
// Promote forged capabilities from DB registry to active status.

import { activateCapability } from "../capability-forge/index.js";

export function promoteForgedCapability(db, { capabilityId, benchmarkResult } = {}) {
  if (!db || !capabilityId) return { ok: false, reason: "missing_args" };

  let row;
  try {
    row = db.prepare(`
      SELECT capability_id, name, status FROM runtime_capability_registry
      WHERE capability_id = ? OR name = ?
    `).get(capabilityId, capabilityId);
  } catch {
    return { ok: false, reason: "migration_required" };
  }

  if (!row) return { ok: false, reason: "not_found", capabilityId };
  if (row.status === "active") return { ok: true, already: true, capabilityId: row.capability_id };

  const activated = activateCapability(db, row.capability_id, benchmarkResult || { promoted: true });
  return { ok: activated.ok, promoted: true, capabilityId: row.capability_id, ...activated };
}

export function listPromotableCapabilities(db, { limit = 20 } = {}) {
  try {
    const rows = db.prepare(`
      SELECT capability_id, name, description, status, created_at
      FROM runtime_capability_registry
      WHERE status IN ('registered', 'testing')
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(Math.min(limit, 100));
    return { ok: true, capabilities: rows };
  } catch {
    return { ok: false, reason: "migration_required", capabilities: [] };
  }
}
