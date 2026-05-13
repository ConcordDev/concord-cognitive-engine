// server/lib/underwater-content.js
//
// Concordia Phase 8 — underwater content lookups + threat AI.
//
// Lookups:
//   - listFeaturesInWorld(db, worldId)
//   - featuresNearPlayer(db, worldId, x, z, depth_m, radius_m)
//   - listSpecies(db)
//
// Threat AI (called from the dive position update handler):
//   - decideAttackOnPlayer(db, ctx) returns { ok, attacker?, painIntensity?,
//     cooldownUntil? } when a nearby aquatic species pursues. Uses the
//     existing pain.js to record bite damage. Cooldown is per-species
//     to bound the player's experience.

import logger from "../logger.js";

const COOLDOWN_KEY = (worldId, userId, speciesId) => `${worldId}::${userId}::${speciesId}`;
const cooldowns = new Map();

function tryLogger() {
  return logger || { warn: () => {}, info: () => {} };
}

export function listFeaturesInWorld(db, worldId) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, world_id, kind, name, pos_x, pos_z, depth_min_m, depth_max_m,
             radius_m, aggression, lore_json
      FROM underwater_features WHERE world_id = ?
      ORDER BY kind, name LIMIT 500
    `).all(worldId);
  } catch { return []; }
}

export function featuresNearPlayer(db, worldId, x, z, depth_m, scanRadiusM = 60) {
  if (!db || !worldId || !Number.isFinite(x) || !Number.isFinite(z)) return [];
  try {
    const rows = db.prepare(`
      SELECT id, world_id, kind, name, pos_x, pos_z, depth_min_m, depth_max_m, radius_m, aggression
      FROM underwater_features
      WHERE world_id = ?
        AND ABS(pos_x - ?) <= ?
        AND ABS(pos_z - ?) <= ?
    `).all(worldId, x, scanRadiusM, z, scanRadiusM);
    const d = Number.isFinite(depth_m) ? depth_m : 0;
    return rows.filter((r) => {
      if (d < r.depth_min_m || d > r.depth_max_m) return false;
      const dist = Math.hypot(r.pos_x - x, r.pos_z - z);
      return dist <= r.radius_m;
    });
  } catch { return []; }
}

export function listSpecies(db) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT species_id, display_name, taxonomy_prefix, threat_tier, preferred_depth_m, pursuit_radius_m, pain_per_bite, attack_cooldown_s
      FROM aquatic_species
      ORDER BY threat_tier DESC, species_id
    `).all();
  } catch { return []; }
}

export function getSpecies(db, speciesId) {
  if (!db || !speciesId) return null;
  try {
    return db.prepare(`SELECT * FROM aquatic_species WHERE species_id = ?`).get(speciesId) || null;
  } catch { return null; }
}

/**
 * Threat decision. Given the player's current world+pos+depth, and a
 * caller-supplied feature/species context, decide whether a threat
 * attacks this tick. Returns { ok, attacker?, painIntensity?,
 * cooldownUntil? }. Caller is responsible for invoking pain.js#
 * recordPain (so this module stays decoupled from pain substrate on
 * builds that don't have it).
 *
 * Selection rules:
 *   - aggression must be >= 1 (peaceful coral garden never attacks)
 *   - player must be within species pursuit_radius from the feature
 *     center
 *   - cooldown must have expired
 *   - probability per call = base + aggression × 0.10 (cap 0.5)
 */
export function decideAttackOnPlayer(db, { worldId, userId, position, depth_m, rngFn = Math.random } = {}) {
  if (!db || !worldId || !userId || !position) return { ok: false, reason: "missing_inputs" };
  const x = Number(position.x), z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: "bad_position" };

  const features = featuresNearPlayer(db, worldId, x, z, depth_m, 80);
  const aggressive = features.filter((f) => f.aggression >= 1);
  if (aggressive.length === 0) return { ok: true, attacker: null };

  // Pick the highest-aggression feature for this tick.
  aggressive.sort((a, b) => b.aggression - a.aggression);
  const feat = aggressive[0];
  const species = listSpecies(db).find((s) => s.threat_tier >= feat.aggression);
  if (!species) return { ok: true, attacker: null };

  const dist = Math.hypot(feat.pos_x - x, feat.pos_z - z);
  if (dist > species.pursuit_radius_m) return { ok: true, attacker: null };

  const key = COOLDOWN_KEY(worldId, userId, species.species_id);
  const now = Math.floor(Date.now() / 1000);
  const cdUntil = cooldowns.get(key) || 0;
  if (cdUntil > now) return { ok: true, attacker: null, on_cooldown_until: cdUntil };

  const probability = Math.min(0.5, 0.05 + feat.aggression * 0.10);
  if (rngFn() > probability) return { ok: true, attacker: null };

  cooldowns.set(key, now + species.attack_cooldown_s);

  try { tryLogger().info?.("underwater_threat_attack", { worldId, userId, species: species.species_id, feature: feat.id }); } catch { /* noop */ }

  return {
    ok: true,
    attacker: {
      species_id: species.species_id,
      display_name: species.display_name,
      feature_id: feat.id,
      feature_kind: feat.kind,
    },
    painIntensity: species.pain_per_bite,
    cooldownUntil: now + species.attack_cooldown_s,
  };
}

/** Spawn an authored feature. Idempotent on id. */
export function spawnFeature(db, {
  id, worldId, kind, name,
  pos_x, pos_z, depth_min_m = 0, depth_max_m = 30,
  radius_m = 50, aggression = 0, lore_json = null,
}) {
  if (!db || !id || !worldId || !kind || !name) return { ok: false, reason: "missing_inputs" };
  if (!Number.isFinite(pos_x) || !Number.isFinite(pos_z)) return { ok: false, reason: "bad_position" };
  try {
    db.prepare(`
      INSERT INTO underwater_features (id, world_id, kind, name, pos_x, pos_z, depth_min_m, depth_max_m, radius_m, aggression, lore_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE
        SET kind = excluded.kind, name = excluded.name,
            pos_x = excluded.pos_x, pos_z = excluded.pos_z,
            depth_min_m = excluded.depth_min_m, depth_max_m = excluded.depth_max_m,
            radius_m = excluded.radius_m, aggression = excluded.aggression,
            lore_json = excluded.lore_json
    `).run(id, worldId, kind, name, pos_x, pos_z, depth_min_m, depth_max_m, radius_m, aggression, lore_json ? JSON.stringify(lore_json) : null);
    return { ok: true, action: "set", id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

/** Test helper — clear cooldowns map. */
export function _resetCooldowns() {
  cooldowns.clear();
}
