// server/lib/crafting/station-tiers.js
//
// G1 — tiered crafting stations. resolveCraft already weights a `stationQuality`
// (0-100) term, but nothing ever set it. This maps a crafting building's
// building_type to its craft quality so crafting AT a station produces higher
// output potency than hand-crafting (Basic Forge -> Advanced Fabricator -> Divine
// Enchanter). A damaged station degrades; a collapsed one can't craft at tier.
// Kill-switch CONCORD_CRAFT_STATIONS=0 (falls back to hand-craft = 0).

export const STATION_TIERS = Object.freeze({
  forge: 60,               // Basic Forge
  workshop: 65,
  lab: 70,
  refinery: 75,            // refining chains (G2)
  factory_workbench: 80,   // Advanced Fabricator
  enchanter: 100,          // Divine Enchanter (G6)
});

export function stationsEnabled() {
  return process.env.CONCORD_CRAFT_STATIONS !== "0";
}

/**
 * Resolve the craft-quality of the station a player is crafting at. Returns 0
 * (hand-craft) when there's no building, it's not a crafting station, it's in
 * another world, or the feature is disabled. A damaged station degrades its tier
 * proportionally (floored at 0.4×); a collapsed one is 0.
 */
export function stationQualityFor(db, worldId, buildingId) {
  if (!db || !buildingId || !stationsEnabled()) return 0;
  try {
    const b = db.prepare(
      "SELECT building_type, world_id, health_pct FROM world_buildings WHERE id = ?"
    ).get(String(buildingId));
    if (!b) return 0;
    if (worldId && b.world_id !== worldId) return 0;          // server-authoritative world scope
    const base = STATION_TIERS[b.building_type] || 0;
    if (base === 0) return 0;
    const hp = b.health_pct == null ? 1 : Number(b.health_pct);
    if (hp <= 0) return 0;                                     // collapsed station can't craft
    return hp < 1 ? Math.round(base * Math.max(0.4, hp)) : base;
  } catch {
    return 0;
  }
}
