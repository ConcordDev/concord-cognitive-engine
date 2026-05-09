// server/emergent/creature-flock-cycle.js
//
// Theme 2 (game-feel pass) — heartbeat that advances boid steering for
// ambient fauna spawned by `fauna-spawner.js`.
//
// Frequency: 4 ticks (~60s). Per pass:
//   1. Discover active worlds via world_visits (fall back to world_npcs).
//   2. For each, run tickFlock(db, state, worldId).
//
// Bounded by `world_npcs` per-world creature count; tickFlock itself does
// its own pre-filter and bulk DB flush. Per the heartbeat invariant: this
// module never throws.
//
// Kill-switch: CONCORD_CREATURE_FLOCK=0.

import logger from "../logger.js";
import { tickFlock } from "../lib/ecosystem/creature-behaviors.js";

const MAX_WORLDS_PER_PASS = 8;

export async function runCreatureFlockCycle({ db, state, tickCount: _t } = {}) {
  if (process.env.CONCORD_CREATURE_FLOCK === "0") {
    return { ok: false, reason: "disabled" };
  }
  if (!db) return { ok: false, reason: "no_db" };

  const stats = { ok: true, worldsTouched: 0, totalMoved: 0, totalSpecies: 0 };

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
        SELECT DISTINCT world_id FROM world_npcs
        WHERE COALESCE(is_dead, 0) = 0
          AND archetype LIKE 'creature:%'
        LIMIT ?
      `).all(MAX_WORLDS_PER_PASS).map((r) => r.world_id).filter(Boolean);
    } catch {
      return { ok: true, worldsTouched: 0, reason: "no_world_npcs_table" };
    }
  }
  if (worlds.length === 0) return { ok: true, worldsTouched: 0 };

  for (const worldId of worlds) {
    try {
      const r = tickFlock(db, state ?? {}, worldId);
      if (r?.ok) {
        stats.worldsTouched++;
        stats.totalMoved += r.moved ?? 0;
        stats.totalSpecies += r.species ?? 0;
      }
    } catch (err) {
      logger?.warn?.("creature-flock-cycle: world failed", { worldId, err: err?.message });
    }
  }

  return stats;
}
