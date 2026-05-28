// server/emergent/factory-cycle.js
//
// Phase CC4 — factory tick heartbeat.
//
// Per-claim sweep at frequency 1 (~15s) advancing every factory's
// belts + crafters. Kill-switch CONCORD_FACTORY_ENABLED=0.

import logger from "../logger.js";
import { tickClaimFactory } from "../lib/factory.js";

export function runFactoryCycle({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (process.env.CONCORD_FACTORY_ENABLED === "0") {
    return { ok: true, skipped: "disabled_by_env" };
  }
  try {
    const claims = db.prepare(`
      SELECT DISTINCT claim_id FROM claim_entities
    `).all();
    let totalMoved = 0;
    let totalCrafted = 0;
    for (const c of claims) {
      const r = tickClaimFactory(db, c.claim_id);
      if (r.ok) {
        totalMoved += r.moved || 0;
        totalCrafted += r.crafted || 0;
      }
    }
    if (totalMoved > 0 || totalCrafted > 0) {
      logger.info?.("factory-cycle", "tick", { claims: claims.length, totalMoved, totalCrafted });
    }
    return { ok: true, claims: claims.length, totalMoved, totalCrafted };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}
