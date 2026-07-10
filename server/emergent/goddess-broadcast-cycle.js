// server/emergent/goddess-broadcast-cycle.js
//
// Wire-the-unwired: `goddess.compose_now` (server.js, delegates to
// lib/goddess-broadcaster.js#composeAndRecord) was a real, working macro
// with ZERO callers anywhere — no heartbeat, no frontend button, nothing
// (confirmed: `grep -rn 'runMacro("goddess"' server/` and `grep -rn
// "compose_now" concord-frontend/` both come back empty). Meanwhile the
// /lenses/goddess page's own header claims dispatches are "composed hourly
// from world ecosystem score, refusal-field strength, and drift events" —
// an automatic cadence that did not exist. In any real deployment the
// `goddess_dispatches` table would stay permanently empty and the lens
// would read "The goddess has not yet spoken in this world." forever.
//
// This heartbeat makes the header text true: every ~1h (frequency 240 at
// the 15s tick), walk active worlds and compose+record one dispatch each,
// mirroring the season-cycle.js world-enumeration pattern.
//
// Kill-switch: CONCORD_GODDESS_BROADCAST=0.

import logger from "../logger.js";
import { composeAndRecord } from "../lib/goddess-broadcaster.js";

export async function runGoddessBroadcastCycle({ state, db } = {}) {
  if (process.env.CONCORD_GODDESS_BROADCAST === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let worlds = [];
  try {
    worlds = db.prepare(`SELECT id FROM worlds LIMIT 50`).all().map((r) => r.id).filter(Boolean);
  } catch {
    try {
      worlds = db.prepare(`
        SELECT DISTINCT world_id FROM world_npcs
        WHERE COALESCE(is_dead, 0) = 0 LIMIT 20
      `).all().map((r) => r.world_id).filter(Boolean);
    } catch { return { ok: true, composed: 0, reason: "no_world_table" }; }
  }
  if (worlds.length === 0) return { ok: true, composed: 0 };

  let composed = 0;
  for (const worldId of worlds) {
    try {
      const r = await composeAndRecord(db, state, worldId);
      if (r?.ok) composed++;
    } catch (err) {
      try { logger.debug?.("goddess-broadcast-cycle", "compose_failed", { world: worldId, error: err?.message }); }
      catch { /* ignore */ }
    }
  }
  return { ok: true, composed, scanned: worlds.length };
}
