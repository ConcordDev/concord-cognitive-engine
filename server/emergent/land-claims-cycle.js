// server/emergent/land-claims-cycle.js
//
// Phase 5a heartbeat — tick maintenance for every active claim.
// Frequency: 240 ticks (~1h). Cheap; bounded.
// Kill-switch: CONCORD_LAND_CLAIMS=0.

import logger from "../logger.js";
import { tickMaintenance } from "../lib/land-claims.js";

export async function runLandClaimsCycle({ db } = {}) {
  if (process.env.CONCORD_LAND_CLAIMS === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let claims = [];
  try {
    claims = db.prepare(`SELECT id FROM land_claims WHERE status = 'active' LIMIT 500`).all().map(r => r.id);
  } catch { return { ok: true, ticked: 0, reason: "no_table" }; }
  if (claims.length === 0) return { ok: true, ticked: 0 };

  let ticked = 0, expired = 0, paid = 0;
  for (const id of claims) {
    try {
      const r = tickMaintenance(db, id);
      if (r?.ok) {
        if (r.action === "expired") expired++;
        if (r.action === "paid") paid++;
        if (r.action !== "noop") ticked++;
      }
    } catch (err) {
      try { logger.debug?.("land-claims-cycle", "tick_failed", { id, error: err?.message }); }
      catch { /* ignore */ }
    }
  }
  return { ok: true, scanned: claims.length, ticked, expired, paid };
}
