// server/emergent/season-cycle.js
//
// Phase 5c heartbeat — advance world seasons + emit transitions.
//
// Frequency: 480 ticks (~2h). Cheap; just walks active worlds and
// advances each. Idempotent.
//
// Kill-switch: CONCORD_SEASONS=0.

import logger from "../logger.js";
import { advanceSeasonForWorld } from "../lib/seasons.js";

export async function runSeasonCycle({ db } = {}) {
  if (process.env.CONCORD_SEASONS === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let worlds = [];
  try {
    worlds = db.prepare(`SELECT id FROM worlds LIMIT 50`).all().map(r => r.id).filter(Boolean);
  } catch {
    try {
      worlds = db.prepare(`
        SELECT DISTINCT world_id FROM world_npcs
        WHERE COALESCE(is_dead, 0) = 0 LIMIT 20
      `).all().map(r => r.world_id).filter(Boolean);
    } catch { return { ok: true, advanced: 0, reason: "no_world_table" }; }
  }
  if (worlds.length === 0) return { ok: true, advanced: 0 };

  let transitioned = 0;
  for (const w of worlds) {
    try {
      const r = advanceSeasonForWorld(db, w);
      if (r?.transitioned) transitioned++;
    } catch (err) {
      try { logger.debug?.("season-cycle", "advance_failed", { world: w, error: err?.message }); }
      catch { /* ignore */ }
    }
  }
  return { ok: true, advanced: transitioned, scanned: worlds.length };
}
