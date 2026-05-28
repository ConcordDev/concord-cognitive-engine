// server/emergent/farm-growth-cycle.js
//
// Phase CB3 — farm crop growth heartbeat.
//
// Frequency 24 (~6 min). Pulls the current (season_idx, day_in_season)
// from seasons.js calendar and advances any crops whose seasonal
// affinity matches.

import logger from "../logger.js";
import { advanceGrowth } from "../lib/farming.js";
import { calendarFor } from "../lib/festivals.js";

export function runFarmGrowthCycle({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (process.env.CONCORD_FARMING_ENABLED === "0") {
    return { ok: true, skipped: "disabled_by_env" };
  }
  try {
    const cal = calendarFor(Date.now());
    const r = advanceGrowth(db, cal.season_idx, cal.day_in_season);
    if (!r.ok) return r;
    if (r.advanced > 0) {
      logger.info?.("farm-growth-cycle", "tick", { advanced: r.advanced });
    }
    return { ok: true, advanced: r.advanced };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}
