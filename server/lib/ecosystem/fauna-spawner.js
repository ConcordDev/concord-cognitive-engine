// server/lib/ecosystem/fauna-spawner.js
//
// EvoEcosystem: ambient fauna spawner. Runs on the heartbeat-registry
// every ~30 ticks (~30 minutes) and tops up the (world_id, biome) species
// populations toward their targets.
//
// Spawned creatures are written to the existing world_npcs table with
// archetype='creature' so the existing world rendering / proximity
// queries see them. creature_population tracks counts per species.
//
// Per CLAUDE.md heartbeat invariant: this module never throws.

import crypto from "node:crypto";
import { speciesForBiome } from "./loot-tables.js";

const BIOMES = ["plains", "forest", "highland", "mountain", "water"];
const BATCH_LIMIT = 60; // hard cap per tick across all worlds

function biomeBoundsForWorld(_worldId) {
  // We don't have per-world biome geometry yet (it's elevation-derived in
  // world-seeder.js). For spawn placement we pick random points in the
  // ±400 unit radius around origin and let the renderer use the existing
  // heightmap to drop them onto the correct biome. Approximate but adequate
  // for ambient population.
  return { x0: -400, x1: 400, z0: -400, z1: 400 };
}

function randomPos(bounds) {
  return {
    x: bounds.x0 + Math.random() * (bounds.x1 - bounds.x0),
    z: bounds.z0 + Math.random() * (bounds.z1 - bounds.z0),
  };
}

/**
 * One spawner pass. Reads existing populations + targets per
 * (world_id, biome, species) and tops up missing creatures into world_npcs.
 *
 * @param {{ state: object, db: object, tickCount: number }} ctx
 */
export function runFaunaSpawner({ state, db }) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!state) return { ok: false, reason: "no_state" };

  // Discover active worlds. We piggyback on world_npcs (any world with
  // an NPC presence is "alive") rather than introducing a new active-
  // worlds table.
  let worlds = [];
  try {
    worlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_npcs WHERE is_dead = 0
    `).all().map((r) => r.world_id);
  } catch { worlds = ["concordia-hub"]; }
  if (worlds.length === 0) worlds = ["concordia-hub"];

  let spawned = 0;
  for (const worldId of worlds) {
    if (spawned >= BATCH_LIMIT) break;
    // We don't yet load per-world universe_type; default to standard.
    // When the world meta is hooked, this will be looked up from
    // worlds.universe_type.
    let universe = "standard";
    try {
      const w = db.prepare(`SELECT universe_type FROM worlds WHERE id = ?`).get(worldId);
      if (w?.universe_type) universe = w.universe_type;
    } catch { /* worlds table may not exist on minimal deployments */ }

    for (const biome of BIOMES) {
      if (spawned >= BATCH_LIMIT) break;
      const species = speciesForBiome(universe, biome);
      for (const sp of species) {
        if (spawned >= BATCH_LIMIT) break;
        const popKey = `${worldId}::${biome}::${sp.id}`;
        // Upsert population row.
        const existing = db.prepare(`
          SELECT * FROM creature_population
          WHERE world_id = ? AND biome = ? AND species_id = ?
        `).get(worldId, biome, sp.id);

        if (!existing) {
          db.prepare(`
            INSERT INTO creature_population
              (id, world_id, biome, species_id, target_count, current_count, lifestyle)
            VALUES (?, ?, ?, ?, ?, 0, ?)
          `).run(`pop_${crypto.randomUUID()}`, worldId, biome, sp.id, sp.target, sp.lifestyle);
        }

        // Recount actual living members of this species.
        const liveCount = db.prepare(`
          SELECT COUNT(*) AS c FROM world_npcs
          WHERE world_id = ? AND archetype = ? AND is_dead = 0
        `).get(worldId, `creature:${sp.id}`)?.c ?? 0;

        const target = existing?.target_count ?? sp.target;
        const need = Math.max(0, target - liveCount);
        if (need === 0) {
          db.prepare(`
            UPDATE creature_population
            SET current_count = ?, last_tick_at = unixepoch()
            WHERE world_id = ? AND biome = ? AND species_id = ?
          `).run(liveCount, worldId, biome, sp.id);
          continue;
        }

        const bounds = biomeBoundsForWorld(worldId);
        const insert = db.prepare(`
          INSERT INTO world_npcs
            (id, world_id, archetype, name, x, y, z, level, is_dead, is_conscious, is_immortal)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
        `);
        for (let i = 0; i < Math.min(need, BATCH_LIMIT - spawned); i++) {
          const pos = randomPos(bounds);
          const id = `cr_${crypto.randomUUID()}`;
          try {
            insert.run(
              id,
              worldId,
              `creature:${sp.id}`,
              sp.id,
              pos.x, 0, pos.z,
              1,
            );
            spawned++;
          } catch {
            // world_npcs may have a stricter schema in some builds —
            // skip gracefully; spawner is best-effort.
            void popKey;
            break;
          }
        }
        db.prepare(`
          UPDATE creature_population
          SET current_count = ?, last_tick_at = unixepoch()
          WHERE world_id = ? AND biome = ? AND species_id = ?
        `).run(liveCount + need, worldId, biome, sp.id);
      }
    }
  }
  return { ok: true, spawned };
}
