// server/lib/discovery-nodes.js
//
// Shared spawner for "discovery" resource nodes — the reward end of two spec
// pillars that the world had no loot path for:
//   G4 (Batman): solving a crime / a surveillance hit reveals a hidden high-rarity
//       node at the scene.
//   G5 (Far Cry / Just Cause): a procgen exploration region hides a cache at its
//       anchor, keyed to the region's character.
// Both just insert a world_resource_nodes row (idempotent via a deterministic id)
// so the EXISTING gather path picks it up — no new gather code, no new event.

// region_kind -> the rare material its cache holds.
export const REGION_CACHE = Object.freeze({
  haunted_glade:  { resourceId: "soul_essence", resourceName: "Lingering Soul Essence", quality: 4 },
  corrupt_market: { resourceId: "gold",         resourceName: "Skimmed Gold",          quality: 3 },
  hollow_chamber: { resourceId: "crystal",      resourceName: "Hollow Crystal",        quality: 3 },
  overgrown_wild: { resourceId: "herb",         resourceName: "Rare Wild Herb",        quality: 3 },
  silent_field:   { resourceId: "gemstone",     resourceName: "Buried Gemstone",       quality: 3 },
});
const DEFAULT_CACHE = { resourceId: "gemstone", resourceName: "Hidden Cache", quality: 3 };
const CACHE_RESPAWN_HOURS = Number(process.env.CONCORD_DISCOVERY_RESPAWN_HOURS ?? 720); // ~30d: effectively one-time

function tableOk(db) {
  try { db.prepare("SELECT 1 FROM world_resource_nodes LIMIT 1").get(); return true; } catch { return false; }
}

/**
 * Insert a discovery node. Idempotent on (id). Returns { ok, nodeId } / { ok:false }.
 */
export function spawnDiscoveryNode(db, { worldId, id, nodeType, resourceId, resourceName, x, z, quality = 3, quantity = 8, biome = "plains" }) {
  if (!db || !worldId || !id || !tableOk(db)) return { ok: false, reason: "missing_or_no_table" };
  try {
    const r = db.prepare(`
      INSERT OR IGNORE INTO world_resource_nodes
        (id, world_id, node_type, resource_id, resource_name, biome,
         x, y, z, depth, quantity_remaining, max_quantity, quality, difficulty, respawn_hours, seeded)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, 0)
    `).run(
      id, worldId, nodeType, resourceId, resourceName, biome,
      Number(x) || 0, Number(z) || 0,
      quantity, quantity, quality, Math.max(1, quality), CACHE_RESPAWN_HOURS,
    );
    return r.changes > 0 ? { ok: true, nodeId: id } : { ok: false, reason: "already_exists", nodeId: id };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/** G4 — reward end of a solved crime: a rare node at the crime's location. */
export function spawnInvestigationNode(db, { worldId, crimeId, locationId }) {
  if (process.env.CONCORD_INVESTIGATION_LOOT === "0") return { ok: false, reason: "disabled" };
  let x = 0, z = 0;
  try {
    const b = locationId && db.prepare("SELECT x, z FROM world_buildings WHERE id = ?").get(String(locationId));
    if (b) { x = Number(b.x) || 0; z = Number(b.z) || 0; }
  } catch { /* no building position — node still surfaces */ }
  return spawnDiscoveryNode(db, {
    worldId, id: `disc_crime_${crimeId}`, nodeType: "investigation_cache",
    resourceId: "soul_essence", resourceName: "Evidence-Locker Essence", x, z, quality: 4, quantity: 6,
  });
}

/** G5 — reward end of an exploration region: a cache at its anchor. */
export function spawnRegionCache(db, { worldId, regionId, regionKind, x, z }) {
  if (process.env.CONCORD_EXPLORATION_CACHE === "0") return { ok: false, reason: "disabled" };
  const c = REGION_CACHE[regionKind] || DEFAULT_CACHE;
  return spawnDiscoveryNode(db, {
    worldId, id: `disc_region_${regionId}`, nodeType: "exploration_cache",
    resourceId: c.resourceId, resourceName: c.resourceName, x, z, quality: c.quality, quantity: 8,
  });
}
