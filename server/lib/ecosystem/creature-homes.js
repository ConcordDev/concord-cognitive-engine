// server/lib/ecosystem/creature-homes.js
//
// Phase 6 — animal homes + sleep patterns + ecology imbalance signal.
//
// Three concerns:
//   1. Deterministic per-(world, biome, species) home anchor placement so
//      bears genuinely have a cave to retreat to. ensureHomeFor() is
//      idempotent on (world, biome, species).
//   2. Sleep-pattern lookup. Species default to diurnal active 06:00-20:00
//      unless registerSleepPattern() overrides them. isAtHomeHour() returns
//      true when current world-hour is outside the species' active window.
//   3. Ecology imbalance signal. recordImbalance() inserts a dedupe-keyed
//      row that the lattice-quest-cycle drains into a procedural "thin the
//      predators" / "find what's killing the herd" quest.

import crypto from "node:crypto";

const KIND_BY_SPECIES = Object.freeze({
  // herbivores -> grazing-pen-style burrows or warrens
  deer:           "den",
  rabbit:         "warren",
  goat:           "den",
  kraal_buck:     "den",
  // predators -> caves / lairs
  wolf:           "lair",
  bear:           "cave",
  meta_coyote:    "lair",
  // raptors / corvids -> roosts
  hawk:           "roost",
  wire_corvid:    "roost",
  plasma_pigeon:  "roost",
  trail_falcon:   "roost",
  cliff_condor:   "roost",
  archive_owl:    "roost",
  shimmer_finch:  "roost",
  sandsong_finch: "roost",
  // urban scavengers -> burrows
  drone_rat:      "burrow",
  dock_rat:       "burrow",
  alley_cat:      "den",
  // arid -> burrows (heat avoidance)
  dust_jackal:    "den",
  desert_snake:   "burrow",
  sand_scorpion:  "burrow",
  // tunya-flavor
  sangmoth:       "nest",
  // hybrids / phase-shifting
  drift_stag:     "den",
  // frontier
  walker_hound:   "den",
  // sovereign-ruins
  wraith_deer:    "den",
  // fey
  moonbloom_sprite: "nest",
  star_seed_kin:    "nest",
  // water — no homes (creatures live in the volume), but include for
  // map completeness so the spawner can return null gracefully.
});

const SLEEP_PATTERNS = Object.freeze({
  // Nocturnal
  bear:           { active_phase: "nocturnal", active_start_hour: 20, active_end_hour: 5,  is_hibernator: 1, hibernate_months: [11, 0, 1] },
  wolf:           { active_phase: "crepuscular", active_start_hour: 17, active_end_hour: 7 },
  archive_owl:    { active_phase: "nocturnal", active_start_hour: 19, active_end_hour: 6 },
  desert_snake:   { active_phase: "nocturnal", active_start_hour: 19, active_end_hour: 6 },
  drone_rat:      { active_phase: "nocturnal", active_start_hour: 21, active_end_hour: 5 },
  dock_rat:       { active_phase: "nocturnal", active_start_hour: 21, active_end_hour: 5 },
  alley_cat:      { active_phase: "crepuscular", active_start_hour: 18, active_end_hour: 7 },
  dust_jackal:    { active_phase: "crepuscular", active_start_hour: 17, active_end_hour: 8 },
  // Diurnal (most herbivores + raptors)
  deer:           { active_phase: "crepuscular", active_start_hour: 5,  active_end_hour: 20 },
  rabbit:         { active_phase: "crepuscular", active_start_hour: 5,  active_end_hour: 19 },
  goat:           { active_phase: "diurnal", active_start_hour: 6, active_end_hour: 20 },
  hawk:           { active_phase: "diurnal", active_start_hour: 6, active_end_hour: 18 },
  cliff_condor:   { active_phase: "diurnal", active_start_hour: 7, active_end_hour: 18 },
  trail_falcon:   { active_phase: "diurnal", active_start_hour: 6, active_end_hour: 18 },
  sand_scorpion:  { active_phase: "nocturnal", active_start_hour: 20, active_end_hour: 5 },
  // Default (diurnal active 6-20) covers everything else.
});

/**
 * Deterministic home anchor for (world, biome, species). Same input always
 * picks the same coordinates so the cave doesn't teleport between
 * server restarts.
 */
function deterministicAnchor(worldId, biome, speciesId, bounds = null) {
  const key = `${worldId}::${biome}::${speciesId}::home`;
  const hash = crypto.createHash("sha1").update(key).digest();
  const u32a = hash.readUInt32BE(0) / 0xffffffff;
  const u32b = hash.readUInt32BE(4) / 0xffffffff;
  const b = bounds ?? { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
  return {
    x: b.minX + u32a * (b.maxX - b.minX),
    z: b.minZ + u32b * (b.maxZ - b.minZ),
  };
}

/**
 * Idempotently insert a creature_homes row for (world, biome, species).
 * Returns the row (existing or newly created).
 */
export function ensureHomeFor(db, { worldId, biome, speciesId, bounds = null }) {
  if (!db || !worldId || !biome || !speciesId) return null;
  // Water species: no home anchor — they live in the volume.
  if (biome === "water") return null;
  const existing = db.prepare(`
    SELECT * FROM creature_homes WHERE world_id = ? AND biome = ? AND species_id = ?
  `).get(worldId, biome, speciesId);
  if (existing) return existing;
  const anchor = deterministicAnchor(worldId, biome, speciesId, bounds);
  const kind = KIND_BY_SPECIES[speciesId] ?? "den";
  const id = `home_${worldId}_${biome}_${speciesId}`;
  db.prepare(`
    INSERT OR IGNORE INTO creature_homes (id, world_id, biome, species_id, kind, x, y, z, capacity)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, worldId, biome, speciesId, kind, anchor.x, anchor.z, 5);
  return db.prepare(`SELECT * FROM creature_homes WHERE id = ?`).get(id);
}

/** List all homes in a world. Bounded — caller can cap for HUD reads. */
export function listHomesForWorld(db, worldId, limit = 200) {
  if (!db || !worldId) return [];
  return db.prepare(`
    SELECT * FROM creature_homes WHERE world_id = ? ORDER BY species_id LIMIT ?
  `).all(worldId, limit);
}

/**
 * Idempotently register a species' sleep pattern.
 */
export function registerSleepPattern(db, speciesId, pattern) {
  if (!db || !speciesId || !pattern) return false;
  const {
    active_phase = "diurnal",
    active_start_hour = 6,
    active_end_hour = 20,
    is_hibernator = 0,
    hibernate_months = null,
  } = pattern;
  db.prepare(`
    INSERT INTO creature_sleep_patterns (species_id, active_phase, active_start_hour, active_end_hour, is_hibernator, hibernate_months)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(species_id) DO UPDATE SET
      active_phase = excluded.active_phase,
      active_start_hour = excluded.active_start_hour,
      active_end_hour = excluded.active_end_hour,
      is_hibernator = excluded.is_hibernator,
      hibernate_months = excluded.hibernate_months
  `).run(
    speciesId,
    active_phase,
    active_start_hour,
    active_end_hour,
    is_hibernator,
    hibernate_months ? JSON.stringify(hibernate_months) : null,
  );
  return true;
}

/**
 * Seed the built-in SLEEP_PATTERNS map into the DB. Idempotent.
 */
export function seedSleepPatterns(db) {
  if (!db) return { seeded: 0 };
  let n = 0;
  for (const [speciesId, pattern] of Object.entries(SLEEP_PATTERNS)) {
    if (registerSleepPattern(db, speciesId, pattern)) n++;
  }
  return { seeded: n };
}

/**
 * Returns true when current world hour is OUTSIDE the species' active
 * window (i.e. the creature should be at home / sleeping). Handles
 * wraparound (nocturnal pattern 20→5 spans midnight).
 *
 * Fallback for unknown species: assumes diurnal 06:00-20:00.
 */
export function isAtHomeHour(db, speciesId, currentHour) {
  if (!db || typeof currentHour !== "number") return false;
  let pattern;
  try {
    pattern = db.prepare(`
      SELECT active_start_hour, active_end_hour FROM creature_sleep_patterns
      WHERE species_id = ?
    `).get(speciesId);
  } catch { pattern = null; }
  const start = pattern?.active_start_hour ?? 6;
  const end = pattern?.active_end_hour ?? 20;
  // Wraparound: active window crosses midnight when end < start
  if (end < start) {
    return !(currentHour >= start || currentHour <= end);
  }
  return !(currentHour >= start && currentHour <= end);
}

/* ── Ecology imbalance signal ────────────────────────────────────── */

/**
 * Insert an imbalance row, dedup'd by signature. Returns
 * { inserted, signature } so callers can know whether the signal is
 * new. Lattice-quest-cycle drains the un-resolved rows into procedural
 * quests.
 */
export function recordImbalance(db, { worldId, biome, kind, severity = 1, summary }) {
  if (!db || !worldId || !biome || !kind || !summary) return { inserted: 0 };
  const dayBucket = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  const signature = crypto.createHash("sha1")
    .update(`${worldId}::${biome}::${kind}::${dayBucket}`)
    .digest("hex");
  const id = `eco_${signature.slice(0, 12)}`;
  try {
    const r = db.prepare(`
      INSERT OR IGNORE INTO ecology_imbalance_log
        (id, world_id, biome, kind, severity, summary, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, worldId, biome, kind, severity, summary, signature);
    return { inserted: r.changes, signature };
  } catch {
    return { inserted: 0, signature };
  }
}

export function unresolvedImbalances(db, worldId = null, limit = 50) {
  if (!db) return [];
  const q = worldId
    ? `SELECT * FROM ecology_imbalance_log WHERE resolved_at IS NULL AND world_id = ? ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM ecology_imbalance_log WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT ?`;
  return worldId ? db.prepare(q).all(worldId, limit) : db.prepare(q).all(limit);
}

export function resolveImbalance(db, id) {
  if (!db || !id) return { ok: false };
  const r = db.prepare(`UPDATE ecology_imbalance_log SET resolved_at = unixepoch() WHERE id = ? AND resolved_at IS NULL`).run(id);
  return { ok: r.changes > 0 };
}

export const HOME_KIND_BY_SPECIES = KIND_BY_SPECIES;
export const SLEEP_PATTERN_REGISTRY = SLEEP_PATTERNS;
