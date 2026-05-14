// server/lib/kingdom-seeder.js
//
// Concordia Foundation — seed procedural kingdoms from every authored
// faction that has controlled_districts, across all 9 canon worlds.
//
// Per Sprint D's design (mig 158, kingdoms.js documentation comment):
//   "Layered on top of factions: every authored faction with territory
//    becomes a kingdom. NPC ruler runs decrees deterministically;
//    player can take over via conquest / inheritance / election."
//
// This seeder makes that real at boot. Idempotent — re-runs are no-op
// for already-seeded realms (ON CONFLICT DO NOTHING).
//
// For each faction in content/world/<canon_world>/factions.json that
// has Array.isArray(faction.controlled_districts) && .length >= 1:
//   1. Insert/skip a realms row keyed by id = "realm_<faction.id>"
//   2. Insert/skip realm_territories rows, one per controlled_district
//   3. Insert/skip realm_citizens rows for every NPC with this faction_id
//
// Player can become ruler later via kingdom-takeover (existing code).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import logger from "../logger.js";

const CANON_WORLDS = Object.freeze([
  "tunya", "cyber", "crime", "fantasy", "superhero",
  "sovereign-ruins", "lattice-crucible", "concord-link-frontier",
  // concordia-hub deliberately omitted — Concordant Law makes it
  // unconquerable; the hub is governed by the Three Above All, not
  // by a kingdom in the realms sense.
]);

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    try { logger.warn?.("kingdom_seeder_parse_failed", { filePath, error: err?.message }); } catch { /* noop */ }
    return null;
  }
}

function factionsForWorld(repoRoot, worldId) {
  const file = join(repoRoot, "content", "world", worldId, "factions.json");
  const data = readJson(file);
  if (!data) return [];
  const list = Array.isArray(data) ? data : (data.factions || []);
  return list.filter((f) => Array.isArray(f.controlled_districts) && f.controlled_districts.length >= 1);
}

function npcsForWorld(repoRoot, worldId) {
  const file = join(repoRoot, "content", "world", worldId, "npcs.json");
  const data = readJson(file);
  if (!data) return [];
  const list = Array.isArray(data) ? data : (data.npcs || []);
  return list;
}

/**
 * Pick the ruler NPC id for a faction. Prefer faction.leader_npc_id
 * if present. Fall back to faction.npc_ids[0]. Fall back to the first
 * NPC in this world with matching faction_id.
 */
function pickRulerNpcId(faction, worldNpcs) {
  if (typeof faction.leader_npc_id === "string" && faction.leader_npc_id.length > 0) {
    return faction.leader_npc_id;
  }
  if (Array.isArray(faction.npc_ids) && faction.npc_ids.length > 0) {
    return faction.npc_ids[0];
  }
  const match = worldNpcs.find((n) => n.faction_id === faction.id || n.faction === faction.id);
  return match ? match.id : null;
}

/**
 * Seed procedural realms from every authored faction with territory
 * across all 8 Sovereign canon worlds. Concordia-hub is excluded
 * (governed by the Three Above All under Concordant Law).
 *
 * Returns { ok, realms_created, territories_seeded, citizens_seeded,
 *           realms_skipped, errors }.
 */
export function seedKingdoms(db, { repoRoot = process.cwd() } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  let realmsCreated = 0;
  let realmsSkipped = 0;
  let territoriesSeeded = 0;
  let citizensSeeded = 0;
  let errors = 0;

  // Prepare statements once.
  const insertRealm = db.prepare(`
    INSERT INTO realms (id, name, world_id, capital_settlement_id, faction_id,
                        ruler_kind, ruler_id, legitimacy, treasury, tax_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const insertTerritory = db.prepare(`
    INSERT INTO realm_territories (kingdom_id, region_id)
    VALUES (?, ?)
    ON CONFLICT(kingdom_id, region_id) DO NOTHING
  `);
  const insertCitizen = db.prepare(`
    INSERT INTO realm_citizens (npc_id, kingdom_id, loyalty)
    VALUES (?, ?, ?)
    ON CONFLICT(npc_id, kingdom_id) DO NOTHING
  `);

  for (const worldId of CANON_WORLDS) {
    const factions = factionsForWorld(repoRoot, worldId);
    const worldNpcs = npcsForWorld(repoRoot, worldId);
    if (factions.length === 0) continue;

    for (const faction of factions) {
      const realmId = `realm_${faction.id}`;
      const rulerId = pickRulerNpcId(faction, worldNpcs);
      const capital = faction.controlled_districts[0];
      const name = faction.name || faction.id;

      try {
        const r = insertRealm.run(
          realmId, name, worldId, capital, faction.id,
          "npc", rulerId, 60, 1000, 0.10,
        );
        if (r.changes > 0) realmsCreated++; else realmsSkipped++;
      } catch (err) {
        errors++;
        try { logger.warn?.("kingdom_seeder_realm_failed", { realmId, error: err?.message }); } catch { /* noop */ }
        continue;
      }

      // Territories
      for (const district of faction.controlled_districts) {
        try {
          const r = insertTerritory.run(realmId, district);
          if (r.changes > 0) territoriesSeeded++;
        } catch { errors++; }
      }

      // Citizens — every NPC whose faction_id or faction matches
      const citizens = worldNpcs.filter(
        (n) => n.faction_id === faction.id || n.faction === faction.id,
      );
      for (const npc of citizens) {
        try {
          const r = insertCitizen.run(npc.id, realmId, 50);
          if (r.changes > 0) citizensSeeded++;
        } catch { errors++; }
      }
    }
  }

  try {
    logger.info?.("kingdom_seeder_complete", {
      realms_created: realmsCreated,
      realms_skipped: realmsSkipped,
      territories_seeded: territoriesSeeded,
      citizens_seeded: citizensSeeded,
      errors,
    });
  } catch { /* noop */ }

  return {
    ok: true,
    realms_created: realmsCreated,
    realms_skipped: realmsSkipped,
    territories_seeded: territoriesSeeded,
    citizens_seeded: citizensSeeded,
    errors,
  };
}

export const KINGDOM_SEEDER_CONSTANTS = Object.freeze({
  CANON_WORLDS,
});
