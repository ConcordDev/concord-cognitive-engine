// server/emergent/signal-propagation-cycle.js
//
// Theme 3 (game-feel pass) — heartbeat that drives the chemistry-cascade
// passes over `embodied_signal_log`. Frequency 3 (~45s).
//
// Per pass, for each active world: thermal spread → moisture spread →
// second-order combos. Lightning chain runs INLINE from the combat
// route, not from this heartbeat.
//
// Per heartbeat invariant: NEVER throws. Kill-switch:
// CONCORD_SIGNAL_PROPAGATION=0.

import logger from "../logger.js";
import {
  propagateThermal,
  propagateMoisture,
  evaluateCombos,
} from "../lib/embodied/signal-propagation.js";

const MAX_WORLDS_PER_PASS = 8;

export async function runSignalPropagationCycle({ db, state: _state, tickCount: _t } = {}) {
  if (process.env.CONCORD_SIGNAL_PROPAGATION === "0") {
    return { ok: false, reason: "disabled" };
  }
  if (!db) return { ok: false, reason: "no_db" };

  const stats = {
    ok: true, worldsTouched: 0,
    thermalSpread: 0, moistureSpread: 0,
    steam: 0, smoke: 0, evap: 0, poisonCleansed: 0,
  };

  let worlds = [];
  try {
    worlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits
      WHERE departed_at IS NULL
      LIMIT ?
    `).all(MAX_WORLDS_PER_PASS).map((r) => r.world_id).filter(Boolean);
  } catch { /* world_visits optional */ }
  if (worlds.length === 0) {
    try {
      worlds = db.prepare(`
        SELECT DISTINCT world_id FROM embodied_signal_log
         WHERE channel = 'thermal_os.ambient_temp'
           AND value > 30
         LIMIT ?
      `).all(MAX_WORLDS_PER_PASS).map((r) => r.world_id).filter(Boolean);
    } catch { /* signal-log may not exist on minimal deployments */ }
  }
  if (worlds.length === 0) return { ok: true, worldsTouched: 0 };

  for (const worldId of worlds) {
    try {
      const t = propagateThermal(db, worldId);
      const m = propagateMoisture(db, worldId);
      const c = evaluateCombos(db, worldId);
      stats.thermalSpread  += t;
      stats.moistureSpread += m;
      stats.steam          += c.steam;
      stats.smoke          += c.smoke;
      stats.evap           += c.evap;
      stats.poisonCleansed += c.poisonCleansed;
      if (t > 0 || m > 0 || c.steam > 0 || c.smoke > 0 || c.evap > 0) {
        stats.worldsTouched++;
      }
    } catch (err) {
      logger?.warn?.("signal-propagation-cycle: world failed", { worldId, err: err?.message });
    }
  }
  return stats;
}
