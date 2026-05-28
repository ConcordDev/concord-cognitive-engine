// server/emergent/world-zone-hazard-cycle.js
//
// T3.3 — hazard zones bite. For each world that has a 'hazard' zone, find the
// players standing inside it and apply hazard damage through the Layer-8 pain
// ledger (the off-combat player-harm path that the repair-cycle already turns
// into debuffs/XP), plus a `zone:hazard-tick` socket cue so the client can
// flash a damage vignette.
//
// Frequency 5 (~75s) so a hazard field is a steady pressure, not a one-shot.
// Heartbeat-compatible: always returns { ok, ... }, never throws.
// Kill-switch: CONCORD_ZONE_HAZARD=0.

import * as cityPresence from "../lib/city-presence.js";
import { listZones } from "../lib/world-zones.js";

export async function runWorldZoneHazardCycle({ db, io } = {}) {
  if (process.env.CONCORD_ZONE_HAZARD === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let worlds = [];
  try {
    worlds = db.prepare(`SELECT DISTINCT world_id FROM world_zones WHERE kind = 'hazard'`).all();
  } catch {
    return { ok: true, ticked: 0, reason: "no_table" };
  }
  if (worlds.length === 0) return { ok: true, ticked: 0 };

  let pain = null;
  try { pain = await import("../lib/embodied/pain.js"); } catch { /* Layer 8 optional */ }

  let ticked = 0;
  for (const { world_id: worldId } of worlds) {
    const hazardZones = listZones(db, worldId).filter((z) => z.kind === "hazard");
    if (hazardZones.length === 0) continue;
    let userIds = [];
    try { userIds = cityPresence.getUserIdsInWorld?.(worldId) || []; } catch { userIds = []; }

    for (const userId of userIds) {
      let pos;
      try { pos = cityPresence.getUserPosition?.(userId); } catch { pos = null; }
      if (!pos || !Number.isFinite(pos.x)) continue;
      // Inside any hazard zone? Apply the strongest one's dps.
      let worst = 0, element = "physical", zoneName = null;
      for (const z of hazardZones) {
        const dx = pos.x - z.center_x;
        const dz = (pos.z ?? 0) - z.center_z;
        if (dx * dx + dz * dz <= z.radius_m * z.radius_m) {
          const dps = Number(z.rules?.hazard) || 0;
          if (dps > worst) { worst = dps; element = z.rules?.element || "physical"; zoneName = z.name; }
        }
      }
      if (worst <= 0) continue;

      // Pain intensity normalised 0.05..1 from the per-tick dps.
      try {
        if (pain?.recordPain) {
          pain.recordPain(db, userId, {
            worldId,
            region: pain.regionForElement ? pain.regionForElement(element) : "systemic",
            intensity: Math.max(0.05, Math.min(1, worst / 50)),
            source: "environment",
            sourceId: `hazard_zone:${zoneName || "field"}`,
            element,
          });
        }
      } catch { /* pain ledger optional */ }

      try {
        io?.to?.(`user:${userId}`)?.emit?.("zone:hazard-tick", {
          worldId, zoneName, element, dps: worst, ts: Date.now(),
        });
      } catch { /* emit best-effort */ }
      ticked++;
    }
  }
  return { ok: true, ticked, worlds: worlds.length };
}
