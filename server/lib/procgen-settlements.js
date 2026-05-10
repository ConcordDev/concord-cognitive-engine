// server/lib/procgen-settlements.js
//
// Sprint B Phase 11.4 — populate emergent regions with NPCs.
//
// lattice-quest-cycle (frequency 180) spawns regions per drift alert
// (Phase 5e: lib/procgen-regions.js + migration 137). Each region is
// procgen terrain with biases — but until now, they were geography
// without people. This module fills them.
//
// When `spawnSettlementForRegion(db, region)` runs, it samples 3-5
// NPC archetypes deterministically from sha1(regionId), drops them
// inside the region radius, and tags them with the region id. NPCs
// fade if the region itself decays (the lattice-quest-composer's
// realiseLatticeBornQuest cascades into decayRegion → cascades into
// decaySettlementForRegion below).
//
// Idempotent — repeat calls for the same regionId return the existing
// settlement. The region never has more than MAX_NPCS_PER_REGION
// active NPCs.

import crypto from "node:crypto";
import logger from "../logger.js";

const MAX_NPCS_PER_REGION = 5;
const MIN_NPCS_PER_REGION = 3;

// Archetype pool. Each archetype has a name pool, a default level, and
// a faction-id template. The procgen settlement picks archetypes
// stochastically per region (deterministic seed). All NPCs get the
// region_id tag so they can be cleaned up on decay.
const ARCHETYPES = [
  { archetype: "scholar",  weight: 1, level: 4, names: ["Iren", "Vesa", "Kael", "Mira", "Tobel"] },
  { archetype: "guard",    weight: 1, level: 5, names: ["Bron", "Sten", "Riska", "Korven", "Tama"] },
  { archetype: "trader",   weight: 1, level: 3, names: ["Pol", "Sennit", "Hesi", "Marek", "Vela"] },
  { archetype: "hunter",   weight: 1, level: 4, names: ["Wren", "Talo", "Skari", "Olen", "Phena"] },
  { archetype: "mystic",   weight: 1, level: 6, names: ["Yshe", "Loro", "Esh", "Marn", "Selka"] },
  { archetype: "warrior",  weight: 1, level: 5, names: ["Dorvik", "Kessa", "Ilan", "Ruven", "Tova"] },
];

/**
 * Ensure the procgen_settlement_npcs table exists. Lightweight schema
 * with foreign keys to procgen_regions (cascade delete on region
 * decay would require WAL + foreign-key-ON pragmas; we use explicit
 * decay cascade in decaySettlementForRegion below).
 */
function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS procgen_settlement_npcs (
      id            TEXT PRIMARY KEY,
      region_id     TEXT NOT NULL,
      world_id      TEXT NOT NULL,
      name          TEXT NOT NULL,
      archetype     TEXT NOT NULL,
      faction_id    TEXT,
      level         INTEGER NOT NULL DEFAULT 1,
      x             REAL NOT NULL,
      z             REAL NOT NULL,
      spawned_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      decayed_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pgs_region ON procgen_settlement_npcs(region_id);
    CREATE INDEX IF NOT EXISTS idx_pgs_world  ON procgen_settlement_npcs(world_id, decayed_at);
  `);
}

/**
 * Deterministic seeded RNG from a sha1 of the region id. Same region
 * always produces the same NPCs.
 */
function seededRng(seed) {
  const buf = crypto.createHash("sha1").update(seed).digest();
  let cursor = 0;
  return () => {
    if (cursor >= buf.length) cursor = 0;
    const v = buf[cursor++] / 256;
    return v;
  };
}

/**
 * Spawn (or return existing) settlement NPCs around the given region.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ id: string, world_id: string, anchor_x: number, anchor_z: number, radius_m: number, region_kind?: string }} region
 * @returns {{ ok: boolean, action: 'created' | 'already_exists' | 'noop', npcs: Array }}
 */
export function spawnSettlementForRegion(db, region) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!region?.id || !region?.world_id) return { ok: false, reason: "invalid_region" };

  ensureSchema(db);

  // Idempotency: if any non-decayed NPC already exists for this region,
  // return them.
  const existing = db.prepare(`
    SELECT * FROM procgen_settlement_npcs
     WHERE region_id = ? AND decayed_at IS NULL
  `).all(region.id);
  if (existing.length > 0) {
    return { ok: true, action: "already_exists", npcs: existing };
  }

  const rng = seededRng(`pgs_${region.id}`);
  const count = MIN_NPCS_PER_REGION + Math.floor(rng() * (MAX_NPCS_PER_REGION - MIN_NPCS_PER_REGION + 1));
  const radius = Math.max(20, Math.min(500, Number(region.radius_m) || 100));
  const cx = Number(region.anchor_x) || 0;
  const cz = Number(region.anchor_z) || 0;

  const created = [];
  const insert = db.prepare(`
    INSERT INTO procgen_settlement_npcs
      (id, region_id, world_id, name, archetype, faction_id, level, x, z)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < count; i++) {
    const archIdx = Math.floor(rng() * ARCHETYPES.length);
    const archetype = ARCHETYPES[archIdx];
    const nameIdx = Math.floor(rng() * archetype.names.length);
    const baseName = archetype.names[nameIdx];
    const nameSuffix = String.fromCharCode(65 + i); // A, B, C, ...
    const name = `${baseName} the ${archetype.archetype.charAt(0).toUpperCase() + archetype.archetype.slice(1)} (${nameSuffix})`;

    // Place inside the region disc (rejection-style sample).
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius * 0.8; // staying within 80% radius
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;

    const id = `pgs_npc_${crypto.randomUUID().slice(0, 12)}`;
    try {
      insert.run(id, region.id, region.world_id, name, archetype.archetype,
                 null, archetype.level, x, z);
      created.push({
        id, region_id: region.id, world_id: region.world_id, name,
        archetype: archetype.archetype, level: archetype.level, x, z,
      });
    } catch (err) {
      try { logger.warn?.("procgen-settlements", "insert_failed", { regionId: region.id, error: err?.message }); }
      catch { /* logger best-effort */ }
    }
  }

  return { ok: true, action: "created", npcs: created };
}

/**
 * Decay the settlement when its region fades. NPCs aren't physically
 * deleted — they get a `decayed_at` timestamp so quest log queries can
 * still reference them (e.g. for "you remember NPC X who was at the
 * Glade once" reflection). Idempotent.
 */
export function decaySettlementForRegion(db, regionId, reason = "region_decayed") {
  if (!db || !regionId) return { ok: false, reason: "missing_args" };
  ensureSchema(db);
  try {
    const result = db.prepare(`
      UPDATE procgen_settlement_npcs
         SET decayed_at = unixepoch()
       WHERE region_id = ? AND decayed_at IS NULL
    `).run(regionId);
    return { ok: true, decayed: result.changes ?? 0, reason };
  } catch (err) {
    try { logger.warn?.("procgen-settlements", "decay_failed", { regionId, error: err?.message }); }
    catch { /* logger best-effort */ }
    return { ok: false, reason: "decay_failed" };
  }
}

/**
 * List active NPCs in a settlement (for the world page render).
 * Bounded.
 */
export function listSettlementNpcs(db, regionId, limit = 50) {
  if (!db || !regionId) return [];
  ensureSchema(db);
  try {
    return db.prepare(`
      SELECT id, region_id, world_id, name, archetype, faction_id, level, x, z, spawned_at
        FROM procgen_settlement_npcs
       WHERE region_id = ? AND decayed_at IS NULL
       ORDER BY spawned_at ASC
       LIMIT ?
    `).all(regionId, limit);
  } catch { return []; }
}

/**
 * List active settlement NPCs for an entire world (for the world page
 * to render all current procgen NPCs in scope on world load).
 * Bounded.
 */
export function listSettlementNpcsForWorld(db, worldId, limit = 200) {
  if (!db || !worldId) return [];
  ensureSchema(db);
  try {
    return db.prepare(`
      SELECT id, region_id, world_id, name, archetype, faction_id, level, x, z, spawned_at
        FROM procgen_settlement_npcs
       WHERE world_id = ? AND decayed_at IS NULL
       ORDER BY spawned_at DESC
       LIMIT ?
    `).all(worldId, limit);
  } catch { return []; }
}
