// server/emergent/crossbreed-spawn-cycle.js
//
// Heartbeat — every ~100 ticks (~25 min). Scans `creature_bonds` for pairs
// whose bond has crossed BOND_THRESHOLD, loads the parents from world_npcs,
// runs generateHybrid() against them, and on success spawns the offspring
// into `world_hybrid_creatures` with the full 3D blueprint embedded.
// Emits `world:hybrid-spawned` realtime so the frontend renderer attaches
// a procedural Three.js mesh.
//
// Kill-switch: CONCORD_CROSSBREED_SPAWN=0.
//
// Heartbeat invariant: never throws. Returns plain { ok, ... }.

import crypto from "crypto";
import logger from "../logger.js";
import { generateHybrid, ensureCrossbreedingTables, getBond } from "../lib/creature-crossbreeding.js";

const MAX_HYBRIDS_PER_PASS = 4;
const BOND_THRESHOLD = 100;  // mirrored from creature-crossbreeding.js
const SPAWN_OFFSET_MAX_M = 3; // hybrid lands within 3m of the parents' midpoint

function _loadParent(db, npcId) {
  try {
    const row = db.prepare(`
      SELECT id, world_id AS worldId, x, z, archetype, species_id, mass_kg AS massKg,
             height_m AS heightM, topology
      FROM world_npcs WHERE id = ? AND COALESCE(is_dead, 0) = 0
    `).get(npcId);
    if (!row) return null;
    // Fall back to defaults if the NPC was spawned before the mass/topology
    // columns existed.
    return {
      id: row.id,
      worldId: row.worldId,
      x: row.x ?? 0,
      z: row.z ?? 0,
      topology: row.topology || "quadruped",
      massKg:  row.massKg  ?? 40,
      heightM: row.heightM ?? 1.2,
      archetype: row.archetype,
      speciesId: row.species_id,
      skillIds: [],
      abilitySeeds: [],
      provenance: { description: row.species_id || row.archetype || row.id },
    };
  } catch {
    return null;
  }
}

export async function runCrossbreedSpawnCycle({ db, realtime } = {}) {
  if (process.env.CONCORD_CROSSBREED_SPAWN === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  // Make sure the storage tables exist — defensive, the migration adds them.
  try { ensureCrossbreedingTables(db); } catch { /* idempotent */ }

  // Find pairs whose bond crossed threshold. Sort by bond desc so the strongest
  // bonds breed first. Caller-side cap of MAX_HYBRIDS_PER_PASS per cycle.
  let pairs = [];
  try {
    pairs = db.prepare(`
      SELECT a_id, b_id, bond
      FROM creature_bonds
      WHERE bond >= ?
      ORDER BY bond DESC
      LIMIT ?
    `).all(BOND_THRESHOLD, MAX_HYBRIDS_PER_PASS * 4);
  } catch {
    return { ok: true, reason: "no_bonds_table", spawned: 0 };
  }

  const result = { ok: true, evaluated: pairs.length, spawned: 0, hybrids: [], failures: [] };
  for (const pair of pairs) {
    if (result.spawned >= MAX_HYBRIDS_PER_PASS) break;
    try {
      const a = _loadParent(db, pair.a_id);
      const b = _loadParent(db, pair.b_id);
      if (!a || !b) {
        // Parent missing / dead — clear the bond so it doesn't dangle.
        db.prepare(`DELETE FROM creature_bonds WHERE a_id = ? AND b_id = ?`).run(pair.a_id, pair.b_id);
        continue;
      }
      // generateHybrid double-checks the bond + compatibility; we just hand it
      // the parents.
      const r = generateHybrid(db, { a, b, environment: null, generation: 1 });
      if (!r.ok) {
        result.failures.push({ a: a.id, b: b.id, reason: r.reason });
        continue;
      }

      // Place the hybrid near the midpoint of the parents with a small jitter.
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const offX = (Math.random() - 0.5) * 2 * SPAWN_OFFSET_MAX_M;
      const offZ = (Math.random() - 0.5) * 2 * SPAWN_OFFSET_MAX_M;
      const spawnX = mx + offX;
      const spawnZ = mz + offZ;
      const hybridId = `hybrid_${crypto.randomBytes(6).toString("hex")}`;
      const worldId = r.hybrid.worldId || a.worldId || b.worldId || "concordia";
      const blueprintJson = JSON.stringify(r.hybrid);

      try {
        db.prepare(`
          INSERT INTO world_hybrid_creatures
            (id, world_id, x, y, z, blueprint_json, parent_a, parent_b,
             generation, stability, cross_world, alive, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, unixepoch())
        `).run(
          hybridId, worldId, spawnX, 0, spawnZ, blueprintJson,
          a.id, b.id,
          r.generation ?? 1, r.stability ?? 0.5,
          r.crossWorld ? 1 : 0,
        );
      } catch (err) {
        result.failures.push({ a: a.id, b: b.id, reason: "persist_failed", message: err?.message });
        continue;
      }

      // Reset the bond so the same pair doesn't immediately produce another.
      try {
        db.prepare(`UPDATE creature_bonds SET bond = 0 WHERE a_id = ? AND b_id = ?`).run(pair.a_id, pair.b_id);
      } catch { /* best-effort */ }

      // Realtime fan-out — frontend renderer adds the mesh.
      try {
        const payload = {
          hybridId,
          worldId,
          parents: [a.id, b.id],
          position: { x: spawnX, y: 0, z: spawnZ },
          stability: r.stability,
          generation: r.generation ?? 1,
          crossWorld: !!r.crossWorld,
          topology: r.hybrid?.topology,
          blueprint: r.hybrid,
        };
        realtime?.io?.to?.(`world:${worldId}`)?.emit?.("world:hybrid-spawned", payload);
      } catch { /* best-effort */ }

      result.spawned++;
      result.hybrids.push({ id: hybridId, parents: [a.id, b.id], topology: r.hybrid?.topology });
    } catch (err) {
      logger?.warn?.("crossbreed-spawn-cycle: pair failed", { err: err?.message });
      result.failures.push({ a: pair.a_id, b: pair.b_id, reason: "exception", message: err?.message });
    }
  }

  return result;
}
