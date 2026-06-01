// server/emergent/procgen-settlement-cycle.js
//
// Sprint B Phase 11.4 — heartbeat that ensures every active procgen
// region has a populated settlement, and that fading regions take
// their NPCs with them.
//
// The lattice-quest-cycle (frequency 180) creates regions when drift
// alerts spawn. This cycle (frequency 240, ~60min) walks all active
// regions per world, calls spawnSettlementForRegion (idempotent —
// returns existing on repeat), and cascades decay when a region's
// drift alert resolves.
//
// Heartbeat-safe: every region operation in try/catch; one bad region
// never starves the cycle.

import {
  spawnSettlementForRegion,
  decaySettlementForRegion,
} from "../lib/procgen-settlements.js";
import { listActiveRegions } from "../lib/procgen-regions.js";

/** Heartbeat handler — registered as `procgen-settlement-cycle @ 240`. */
export async function runProcgenSettlementCycle({ db }) {
  if (!db) return { ok: false, reason: "no_db" };

  let scanned = 0;
  let spawned = 0;
  let decayed = 0;
  let errors = 0;

  // Active worlds — same heuristic as the sibling cycles.
  let worlds = [];
  try {
    worlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits WHERE departed_at IS NULL
    `).all().map(r => r.world_id).filter(Boolean);
  } catch {
    // Fallback for fresh DBs without city_presence.
    try { worlds = db.prepare(`SELECT id FROM worlds`).all().map(r => r.id); }
    catch { return { ok: false, reason: "no_worlds_table" }; }
  }

  if (worlds.length === 0) return { ok: true, scanned: 0, spawned: 0, decayed: 0 };

  for (const worldId of worlds) {
    let regions = [];
    try { regions = listActiveRegions(db, worldId, 50); }
    catch { continue; }

    for (const region of regions) {
      scanned += 1;
      try {
        const result = spawnSettlementForRegion(db, region);
        if (result?.action === "created") spawned += 1;
      } catch { errors += 1; }
    }

    // Decay cascade: any region marked decayed in the last 10 minutes
    // should have its settlement NPCs marked decayed too. Skip rows
    // whose NPCs are already cleaned up.
    try {
      const decayedRegions = db.prepare(`
        SELECT id FROM procgen_regions
         WHERE world_id = ? AND decayed_at IS NOT NULL
           AND decayed_at >= unixepoch() - 600
      `).all(worldId);
      for (const region of decayedRegions) {
        const r = decaySettlementForRegion(db, region.id, "region_decayed");
        if (r.decayed > 0) decayed += r.decayed;
      }
    } catch { /* procgen_regions may not be on minimal builds */ }
  }

  return { ok: true, scanned, spawned, decayed, errors };
}
