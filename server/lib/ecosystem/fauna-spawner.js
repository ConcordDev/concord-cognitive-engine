// @sql-loop-ok: heartbeat handler with bounded world count + per-world distinct logic
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
import { signalsForWorld } from "../embodied/environment-sensor.js";
import { getWorldMeta } from "../cross-world-effectiveness.js";
import { ensureHomeFor, recordImbalance } from "./creature-homes.js";

const BIOMES = ["plains", "forest", "highland", "mountain", "water", "arid"];

/**
 * Biomes to spawn into for a given world. If the world's meta.json declares
 * `biomes`, only those are iterated — a cyber world doesn't need to scan
 * for mountain-biome bears. Falls back to all BIOMES if the meta isn't
 * registered yet (preserves legacy behaviour).
 */
function biomesForWorld(worldId) {
  const meta = getWorldMeta(worldId);
  if (meta && Array.isArray(meta.biomes) && meta.biomes.length > 0) {
    return meta.biomes.filter((b) => BIOMES.includes(b));
  }
  return BIOMES;
}

// Layer 7: Climate-responsive species modifier. Reads current world
// signals from the embodied substrate and produces a per-species
// multiplier on target_count so a cold zone genuinely has fewer bugs
// and more cold-adapted fauna. Loose substring classification — novel
// species default to modifier 1.0 (climate-neutral) until classified.
function _signalModifierFor(speciesId, signals) {
  if (!signals) return 1.0;
  const id = String(speciesId || "").toLowerCase();
  const temp = Number(signals.temperature);
  const isCold = Number.isFinite(temp) && temp < 5;
  const isHot  = Number.isFinite(temp) && temp > 28;
  const lowAir = Number(signals.airQuality) < 0.5;
  if (/(bug|insect|fly|beetle|wasp|bee|ant)/.test(id)) {
    if (isCold) return 0.1;
    if (isHot)  return 1.3;
    return 1.0;
  }
  if (/(rabbit|fox|squirrel|hare|marten|weasel)/.test(id)) {
    if (isCold) return 1.4;
    return 1.0;
  }
  if (/(deer|elk|bison|moose|bear)/.test(id)) {
    if (isCold) return 0.8;
    return 1.0;
  }
  if (/(snake|lizard|frog|gecko|turtle)/.test(id)) {
    if (isCold) return 0.0;
    if (isHot)  return 1.2;
    return 1.0;
  }
  if (/(fish|trout|bass|salmon|otter|crab)/.test(id)) {
    if (signals.humidity != null && signals.humidity < 30) return 0.5;
    return 1.0;
  }
  if (/(wolf|caribou|polar|tundra|arctic)/.test(id)) {
    if (isCold) return 1.3;
    if (isHot)  return 0.4;
    return 0.9;
  }
  if (lowAir && /(songbird|hummingbird|butterfly)/.test(id)) {
    return 0.3;
  }
  return 1.0;
}
// Bumped from 60 → 500 for 32GB-heap deployments. Per-tick cap on creature
// spawns across all worlds; large value lets thinly-populated worlds
// recover their target populations within a single tick.
const BATCH_LIMIT = Number(process.env.CONCORD_FAUNA_SPAWN_BATCH) || 500;

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
 * Theme 2 (game-feel pass): deterministic cluster center per
 * (world, biome, species). Birds of a feather start together, so the
 * boid cycle has something to flock toward instead of trying to fold a
 * uniformly-scattered point cloud into groups every tick.
 *
 * Seeded by sha1 so the same world+biome+species always anchors at the
 * same coords across server restarts. Two species in the same biome
 * pick distinct centers; the same species in two biomes picks two
 * centers (one per biome). Day-seed shift is *not* included — the
 * cluster center is a long-lived anchor for the species' niche, not a
 * daily migration.
 */
export function clusterCenterFor(worldId, biome, speciesId, bounds = null) {
  const b = bounds ?? biomeBoundsForWorld(worldId);
  const key = `${worldId}::${biome}::${speciesId}`;
  const h = crypto.createHash("sha1").update(key).digest();
  // Two 32-bit slices → x and z. Map to bounds.
  const ux = h.readUInt32BE(0) / 0xffffffff;
  const uz = h.readUInt32BE(4) / 0xffffffff;
  return {
    x: b.x0 + ux * (b.x1 - b.x0),
    z: b.z0 + uz * (b.z1 - b.z0),
  };
}

/** Random offset within ±radius of (cx, cz). Bounded to world bounds. */
function clusterOffsetPos(cx, cz, radius, bounds) {
  const a  = Math.random() * Math.PI * 2;
  const r  = Math.sqrt(Math.random()) * radius; // sqrt → uniform area distribution
  let x = cx + Math.cos(a) * r;
  let z = cz + Math.sin(a) * r;
  if (x < bounds.x0) x = bounds.x0;
  if (x > bounds.x1) x = bounds.x1;
  if (z < bounds.z0) z = bounds.z0;
  if (z > bounds.z1) z = bounds.z1;
  return { x, z };
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

  // Prepared INSERT — re-used across every spawn in the pass. The 8 args
  // align with the world_npcs columns this spawner cares about (id,
  // world_id, archetype, species_id, x, y, z, is_dead). Older builds
  // with a stricter schema throw on the .run; the catch in the loop
  // skips gracefully (spawner is best-effort, never fatal).
  const insert = db.prepare(`
    INSERT INTO world_npcs
      (id, world_id, archetype, species_id, x, y, z, is_dead)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

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

    // Layer 7: Read current environmental signals once per world per
    // tick. The per-species _signalModifierFor() consumes these to
    // adjust effective target counts (cold = bug × 0.1, etc.).
    let worldSignals = null;
    try { worldSignals = signalsForWorld(db, worldId); }
    catch { /* signals are optional; spawner falls back to static targets */ }

    for (const biome of biomesForWorld(worldId)) {
      if (spawned >= BATCH_LIMIT) break;
      const species = speciesForBiome(universe, biome);

      // Phase 6 — ecology imbalance scan. For each biome, compare live
      // predator total vs. live herbivore total against their summed
      // targets. When predators exceed 1.5× target AND herbivores fall
      // below 0.3× target, signal a "predator_excess" imbalance row.
      try {
        const bounds = biomesForWorld(worldId); // touch — avoid unused tag
        void bounds;
        let preyLive = 0, preyTarget = 0, predLive = 0, predTarget = 0;
        for (const sp of species) {
          const count = db.prepare(`
            SELECT COUNT(*) AS c FROM world_npcs
            WHERE world_id = ? AND archetype = ? AND is_dead = 0
          `).get(worldId, `creature:${sp.id}`)?.c ?? 0;
          if (sp.lifestyle === "herbivore") {
            preyLive += count; preyTarget += sp.target;
          } else if (sp.lifestyle === "carnivore") {
            predLive += count; predTarget += sp.target;
          }
        }
        if (
          preyTarget > 0 && predTarget > 0 &&
          predLive >= predTarget * 1.5 &&
          preyLive <= preyTarget * 0.3
        ) {
          recordImbalance(db, {
            worldId,
            biome,
            kind: "predator_excess",
            severity: Math.min(5, Math.round(predLive / Math.max(1, predTarget))),
            summary: `${biome} in ${worldId}: ${predLive} predators vs ${preyLive} prey (targets ${predTarget}/${preyTarget}). The herd is in collapse.`,
          });
        }
      } catch { /* imbalance log is best-effort */ }

      for (const sp of species) {
        if (spawned >= BATCH_LIMIT) break;
        const popKey = `${worldId}::${biome}::${sp.id}`;

        // Phase 6 — ensure this species has a home anchor in this biome
        // so the population isn't spawning out of thin air with nowhere
        // to retreat. Idempotent on (world, biome, species).
        try { ensureHomeFor(db, { worldId, biome, speciesId: sp.id }); } catch { /* best-effort */ }
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

        // Layer 7: apply climate-responsive modifier to the static
        // target. e.g. a "bug" species in a cold biome (temperature < 5°C)
        // gets target × 0.1 → far fewer spawn attempts and population
        // settles at ~10% of warm-zone density.
        const baseTarget = existing?.target_count ?? sp.target;
        const modifier = _signalModifierFor(sp.id, worldSignals);
        const target = Math.max(0, Math.round(baseTarget * modifier));
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
        // Theme 2 (game-feel pass): cluster around a deterministic center
        // per (world, biome, species) instead of uniform-random point cloud.
        // Cluster radius scales modestly with target_count so high-density
        // species occupy a plausibly larger range. randomPos remains as the
        // fallback for unbounded universes.
        const center = clusterCenterFor(worldId, biome, sp.id, bounds);
        const clusterRadius = Math.max(40, Math.min(180, 18 + (target * 1.5)));
        for (let i = 0; i < Math.min(need, BATCH_LIMIT - spawned); i++) {
          const pos = clusterOffsetPos(center.x, center.z, clusterRadius, bounds);
          // Suppress the unused-but-kept-for-fallback complaint.
          void randomPos;
          const id = `cr_${crypto.randomUUID()}`;
          try {
            insert.run(
              id,
              worldId,
              `creature:${sp.id}`,
              sp.id,
              pos.x, 0, pos.z,
              0,  // is_dead = 0 (alive). Previously this was 1 — every
                  // spawned creature landed in world_npcs marked dead, so
                  // none ever showed up in /npcs queries or flock cycles.
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
