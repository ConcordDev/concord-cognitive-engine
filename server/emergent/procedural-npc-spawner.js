// server/emergent/procedural-npc-spawner.js
//
// Phase 7 heartbeat — keep faction populations topped up.
//
// Frequency: 360 ticks (~90 min). Per pass:
//   1. For each active world, count live NPCs per faction.
//   2. If a faction is below its target population, spawn enough
//      procedural NPCs to reach the target — capped at MAX_PER_PASS so
//      a single tick can't flood the world with fresh strangers.
//
// Targets are configurable via env (CONCORD_FACTION_TARGET_POPULATION,
// default 8 per faction per world). The spawner is idempotent — the
// generator's deterministic ID guarantees re-running produces the same
// row keys, so the ON CONFLICT in persistGeneratedNpc covers replay.
//
// Kill-switch: CONCORD_PROCGEN_NPCS=0.

import crypto from "node:crypto";
import logger from "../logger.js";
import { generateNpc, persistGeneratedNpc, FACTION_PROFILES } from "../lib/npc-generator.js";
import { seedNPCAsymmetry } from "../lib/npc-asymmetry.js";
import { seedSecretForNpc } from "../lib/secrets.js";

const FACTION_TARGET = Number(process.env.CONCORD_FACTION_TARGET_POPULATION || 8);
const MAX_PER_PASS = Number(process.env.CONCORD_PROCGEN_NPCS_PER_PASS || 12);
// D4 #5 — fraction of procedural NPCs whose generated secret becomes a real,
// discoverable, quest-gating secret in the `secrets` table (not just flavour).
const SECRET_SEED_FRACTION = Math.max(0, Math.min(1, Number(process.env.CONCORD_PROCGEN_SECRET_FRACTION) || 0.33));

/** Deterministic 0..1 from an NPC id (so the same NPC always gets/doesn't get a secret). */
function _idFraction(id) {
  const b = crypto.createHash("sha1").update(String(id)).digest();
  return b[0] / 255;
}

export async function runProceduralNpcSpawner({ db } = {}) {
  if (process.env.CONCORD_PROCGEN_NPCS === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let activeWorlds = [];
  try {
    activeWorlds = db.prepare(`SELECT id FROM worlds LIMIT 20`).all().map(r => r.id).filter(Boolean);
  } catch {
    try {
      activeWorlds = db.prepare(`
        SELECT DISTINCT world_id FROM world_npcs
        WHERE COALESCE(is_dead, 0) = 0 LIMIT 10
      `).all().map(r => r.world_id).filter(Boolean);
    } catch { return { ok: true, spawned: 0, reason: "no_world_table" }; }
  }
  if (activeWorlds.length === 0) return { ok: true, spawned: 0 };

  const factionIds = Object.keys(FACTION_PROFILES).filter(f => f !== "default");

  let spawned = 0;
  for (const worldId of activeWorlds) {
    if (spawned >= MAX_PER_PASS) break;
    for (const factionId of factionIds) {
      if (spawned >= MAX_PER_PASS) break;
      let alive = 0;
      try {
        const r = db.prepare(`
          SELECT COUNT(*) AS n FROM world_npcs
          WHERE world_id = ? AND faction = ? AND COALESCE(is_dead, 0) = 0
        `).get(worldId, factionId);
        alive = r?.n || 0;
      } catch { continue; }

      const deficit = Math.max(0, FACTION_TARGET - alive);
      if (deficit === 0) continue;

      // Determine the next available seed index by counting prior
      // procedural NPCs in this faction (alive or dead). This keeps IDs
      // stable across restarts: re-running the spawner picks up where
      // the previous run left off without colliding.
      let nextSeed = 0;
      try {
        const r = db.prepare(`
          SELECT COUNT(*) AS n FROM procedural_npcs
          WHERE faction = ? AND world_id = ?
        `).get(factionId, worldId);
        nextSeed = r?.n || 0;
      } catch { /* table optional */ }

      const toSpawn = Math.min(deficit, MAX_PER_PASS - spawned);
      for (let i = 0; i < toSpawn; i++) {
        const npc = generateNpc({ factionId, seed: `gen_${nextSeed + i}`, worldId });
        if (!npc) continue;
        try {
          const r = persistGeneratedNpc(db, npc);
          if (r.ok && r.action === "created") {
            spawned++;
            // D4 (depth plan) — seed the scheme/asymmetry substrate for the
            // freshly-spawned procedural NPC from its GENERATED interiority
            // (narrative_context: secret/fear/current_goal). Without this the
            // deep scheme + asymmetry engines silently no-op on procedural
            // NPCs — they sit as flavour while only authored NPCs ever plot.
            // seedNPCAsymmetry → deriveSchemeSubstrateFromNarrative (T1.3)
            // turns that interiority into the stress/coping the scheme gate
            // reads, so the bulk of the population can now scheme. Idempotent.
            try { await seedNPCAsymmetry(db, npc); }
            catch (e) { logger.debug?.("procgen-npc-spawner", "asymmetry_seed_failed", { id: npc.id, error: e?.message }); }
            // D4 #5 — a deterministic fraction of procedural NPCs get their
            // generated secret promoted into the discoverable `secrets` table,
            // so they can seed procedural content (surveillance → hook → quest
            // gate) instead of just flavouring dialogue. Idempotent + guarded.
            try {
              if (_idFraction(npc.id) < SECRET_SEED_FRACTION) seedSecretForNpc(db, npc);
            } catch (e) { logger.debug?.("procgen-npc-spawner", "secret_seed_failed", { id: npc.id, error: e?.message }); }
          }
        } catch (err) {
          try { logger.debug?.("procgen-npc-spawner", "persist_failed", { id: npc.id, error: err?.message }); }
          catch { /* ignore */ }
        }
      }
    }
  }

  return { ok: true, spawned, target_per_faction: FACTION_TARGET };
}
