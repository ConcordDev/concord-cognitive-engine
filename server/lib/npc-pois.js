// server/lib/npc-pois.js
//
// Living Society WS4.2 — smart-object POIs (The Sims "smart object" model).
//
// Each building TYPE advertises which needs it satisfies + how much. The utility
// scorer (npc-utility.js) reads these to decide where an NPC goes — and crucially
// the candidates are REAL `world_buildings` near the NPC, not the spawn±random
// offset the old schedule used. Adding a POI kind = a row in POI_ADVERTISEMENTS.

// building_type → { need: satisfaction amount } it advertises.
export const POI_ADVERTISEMENTS = Object.freeze({
  inn:       { hunger: 0.6, social: 0.5, energy: 0.3 },
  market:    { wealth: 0.5, social: 0.4 },
  forge:     { wealth: 0.6, purpose: 0.5 },
  farm:      { wealth: 0.5, purpose: 0.5 },
  mine:      { wealth: 0.6, purpose: 0.4 },
  house:     { energy: 0.8 },
  well:      { hunger: 0.25 },
  tower:     { safety: 0.5, purpose: 0.4 },
  dock:      { wealth: 0.5, purpose: 0.4 },
  warehouse: { wealth: 0.4 },
});

export function advertisementFor(buildingType) {
  return POI_ADVERTISEMENTS[String(buildingType || "").toLowerCase()] || {};
}

/**
 * The REAL nearby smart-object POIs for an NPC: standing world_buildings near
 * (x,z), each annotated with distance + its need advertisement. The scorer
 * decides among these. Returns [] if no buildings (an empty/unbuilt world —
 * the NPC just paces, honest, not a fake POI).
 */
export function nearbyPOIs(db, worldId, x, z, limit = 12) {
  if (!db || !worldId) return [];
  const px = Number(x) || 0, pz = Number(z) || 0;
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT id, building_type, x, z
      FROM world_buildings
      WHERE world_id = ? AND state != 'collapsed'
      ORDER BY ((x - ?) * (x - ?) + (z - ?) * (z - ?)) ASC
      LIMIT ?
    `).all(worldId, px, px, pz, pz, Math.max(1, limit));
  } catch { return []; }
  return rows
    .map((b) => {
      const advertises = advertisementFor(b.building_type);
      if (Object.keys(advertises).length === 0) return null; // a POI that satisfies nothing isn't a goal
      return { id: b.id, type: b.building_type, x: b.x, z: b.z, dist: Math.hypot(b.x - px, b.z - pz), advertises };
    })
    .filter(Boolean);
}

/** The nearest POI of a specific building type (e.g. resolve "home" → the nearest house). */
export function nearestOfType(db, worldId, x, z, buildingType) {
  const px = Number(x) || 0, pz = Number(z) || 0;
  try {
    const b = db.prepare(`
      SELECT id, building_type, x, z FROM world_buildings
      WHERE world_id = ? AND state != 'collapsed' AND building_type = ?
      ORDER BY ((x - ?) * (x - ?) + (z - ?) * (z - ?)) ASC LIMIT 1
    `).get(worldId, String(buildingType), px, px, pz, pz);
    if (!b) return null;
    return { id: b.id, type: b.building_type, x: b.x, z: b.z, dist: Math.hypot(b.x - px, b.z - pz), advertises: advertisementFor(b.building_type) };
  } catch { return null; }
}

// The schedule's location_kind → the building type(s) that fulfil it (so the
// time-block bias can still steer toward the right kind of place).
export const LOCATION_KIND_BUILDING = Object.freeze({
  home: "house", tavern: "inn", market: "market", plaza: "market",
  temple: "tower", workplace: "forge", mine: "mine", farm: "farm", dock: "dock",
});
