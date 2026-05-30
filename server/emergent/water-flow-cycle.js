// server/emergent/water-flow-cycle.js
//
// Living Society — Phase 0.6: advance the hydrology flow solver each cadence.
// Water moves to the lowest adjacent cell, conserves volume, and pools — so a
// dug ditch fills over time. Only worlds that actually have water cells do any
// work (a world with no water = zero-cost tick). Never throws.

import { tickWaterFlow } from "../lib/terrain-water.js";

export function runWaterFlowCycle({ db, io } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  let worlds = [];
  try {
    worlds = db.prepare(`SELECT DISTINCT world_id FROM world_water_cells`).all().map((r) => r.world_id);
  } catch { return { ok: true, worlds: 0 }; } // table absent
  let moved = 0;
  for (const w of worlds) {
    try {
      const r = tickWaterFlow(db, w);
      const cellsMoved = r?.cellsMoved || 0;
      moved += cellsMoved;
      // WS-A1 — hint the 3D client to refetch the water grid when the surface
      // actually changed. A hint, not a payload: the client owns the full read
      // via GET /api/worlds/:id/terrain. Floor-only — never break the tick.
      if (cellsMoved > 0) {
        try {
          io?.to?.(`world:${w}`)?.emit?.("concordia:water-updated", { worldId: w, changed: cellsMoved });
        } catch { /* realtime optional */ }
      }
    } catch { /* per-world isolation */ }
  }
  return { ok: true, worlds: worlds.length, cellsMoved: moved };
}
