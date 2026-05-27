// server/emergent/dungeon-spawner-cycle.js
//
// Wave F — periodically spawns new dungeons in each active world,
// capped at MAX_ACTIVE_PER_WORLD so the world map doesn't carpet
// itself in undiscoverable instances.
//
// Heartbeat invariant: never throws.
// Kill switch: CONCORD_DUNGEON_SPAWNER=0.

import logger from "../logger.js";
import { composeDungeon } from "../lib/dungeons.js";

const MAX_ACTIVE_PER_WORLD = 6;
const SPAWN_RADIUS_M = 600;     // distance from world center
const SPAWN_CADENCE_TICKS = 1;  // every pass when room exists

export async function runDungeonSpawnerCycle({ db } = {}) {
  if (process.env.CONCORD_DUNGEON_SPAWNER === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  // Active worlds — any world with at least one alive NPC OR a recent
  // world_visit. Fall back to ['concordia-hub'].
  let worlds = [];
  try {
    worlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits
      WHERE departed_at IS NULL
      LIMIT 10
    `).all().map((r) => r.world_id);
  } catch { /* table optional */ }
  if (worlds.length === 0) {
    try {
      worlds = db.prepare(`
        SELECT DISTINCT world_id FROM world_npcs
        WHERE COALESCE(is_dead, 0) = 0 LIMIT 10
      `).all().map((r) => r.world_id);
    } catch { /* ok */ }
  }
  if (worlds.length === 0) worlds = ["concordia-hub"];

  const stats = { ok: true, worldsScanned: worlds.length, spawned: 0, atCap: 0, errored: 0 };

  for (const worldId of worlds) {
    try {
      const active = db.prepare(`
        SELECT COUNT(*) AS n FROM dungeons WHERE world_id = ? AND status = 'active'
      `).get(worldId)?.n ?? 0;
      if (active >= MAX_ACTIVE_PER_WORLD) { stats.atCap++; continue; }

      // Pick a position within the spawn radius, deterministic per (world, tick).
      const ts = Math.floor(Date.now() / 1000);
      const angle = ((ts * 9301) % 360) * Math.PI / 180;
      const radius = 100 + ((ts * 7) % SPAWN_RADIUS_M);
      const anchorX = Math.cos(angle) * radius;
      const anchorZ = Math.sin(angle) * radius;
      // Depth scales with how many already exist + a small randomized bias.
      const depthLevel = 1 + active + (ts % 3);

      const r = composeDungeon(db, { worldId, anchorX, anchorZ, depthLevel });
      if (r.ok) {
        stats.spawned++;
        // Realtime so the World Map / Compass can pin a new objective.
        try {
          globalThis._concordRealtimeEmit?.("world:dungeon-spawned", {
            worldId, dungeonId: r.dungeonId, name: r.name,
            position: { x: anchorX, z: anchorZ }, depthLevel,
            templateKind: r.templateKind, roomCount: r.roomCount,
          });
        } catch { /* ok */ }
      } else {
        stats.errored++;
      }
    } catch (err) {
      stats.errored++;
      logger?.warn?.("dungeon-spawner", "world_failed", { worldId, error: err?.message });
    }
  }
  return stats;
}
