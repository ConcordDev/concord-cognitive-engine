// server/emergent/festival-trigger-cycle.js
//
// Phase BB1 — festival trigger heartbeat.
//
// Frequency 4 (~1 min). Per active world: run a trigger pass which
// opens any festival whose window contains the current
// (season_idx, day_in_season). Idempotent on
// (festival_id, world_id, year_idx) so multiple cadence ticks within
// the same window are harmless.
//
// On the very first tick of process boot, lazy-load all festival
// content packs into the festivals table (idempotent).

import logger from "../logger.js";
import { runFestivalTriggerPass, loadFestivalsFromContent } from "../lib/festivals.js";

let _seeded = false;

export function runFestivalTriggerCycle({ db, worldId, io } = {}) {
  if (!db || !worldId) return { ok: false, reason: "no_db_or_world" };
  if (process.env.CONCORD_FESTIVALS_ENABLED === "0") {
    return { ok: true, skipped: "disabled_by_env" };
  }

  if (!_seeded) {
    try { loadFestivalsFromContent(db); } catch { /* tolerated */ }
    _seeded = true;
  }

  try {
    const r = runFestivalTriggerPass(db, worldId);
    if (!r.ok) return r;
    for (const opened of r.opened) {
      try {
        io?.emit?.("festival:started", {
          festivalId: opened.festivalId,
          name: opened.name,
          worldId,
          ts: Math.floor(Date.now() / 1000),
        });
      } catch (err) {
        logger.debug?.("festival-trigger-cycle", "emit_failed", { error: err?.message });
      }
    }
    if (r.opened.length > 0) {
      logger.info?.("festival-trigger-cycle", "tick", { worldId, opened: r.opened.map(o => o.festivalId) });
    }
    return { ok: true, world: worldId, openedCount: r.opened.length };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}

/** Test-only reset of the boot-seed flag. */
export function _resetSeedFlag() { _seeded = false; }
