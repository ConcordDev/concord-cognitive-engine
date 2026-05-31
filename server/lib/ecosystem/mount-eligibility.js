// server/lib/ecosystem/mount-eligibility.js
//
// Read + write helpers for the mount-eligibility flag on player_companions.
// Used by the taming flow (B2) to set `mount_eligible=1` when the tamed
// creature's species lives in `mount_species`, and by the read-side
// `mount.list_mountable` macro to surface eligible companions.
//
// CLAUDE.md invariant: a creature is mountable iff its species exists
// in `mount_species`. The flag on `player_companions` is denormalized
// from that table for read efficiency — fauna-spawner / taming flow
// must keep them in sync.

/**
 * Whether a given species_id corresponds to a mountable species.
 * Pure read; safe to call hot.
 */
export function isSpeciesMountable(db, speciesId) {
  if (!db || !speciesId) return false;
  try {
    const row = db.prepare(`SELECT 1 FROM mount_species WHERE species_id = ? LIMIT 1`).get(speciesId);
    return !!row;
  } catch {
    return false;
  }
}

/**
 * List all mountable species (with their base stats). Ordered by
 * size_class then base_speed_mps.
 */
export function listMountableSpecies(db) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT species_id, display_name, size_class, base_speed_mps, base_stamina,
             carry_capacity_kg, gait_profile_id, rider_seat_offset_json,
             saddle_anchor_bone, reins_anchor_bone, flight_capable, aesthetic_tags_json
      FROM mount_species
      ORDER BY size_class, base_speed_mps DESC
    `).all().map(_unpackSpeciesJson);
  } catch {
    return [];
  }
}

/**
 * Get a single species' full record (with parsed JSON columns).
 */
export function getMountSpecies(db, speciesId) {
  if (!db || !speciesId) return null;
  try {
    const row = db.prepare(`
      SELECT species_id, display_name, size_class, base_speed_mps, base_stamina,
             carry_capacity_kg, gait_profile_id, rider_seat_offset_json,
             saddle_anchor_bone, reins_anchor_bone, flight_capable, aesthetic_tags_json
      FROM mount_species WHERE species_id = ?
    `).get(speciesId);
    return row ? _unpackSpeciesJson(row) : null;
  } catch {
    return null;
  }
}

/**
 * Get the gait profile for a species (parsed JSON cycle blocks).
 * Returns null if the species has no gait profile (defensive).
 */
export function getGaitProfile(db, speciesId) {
  if (!db || !speciesId) return null;
  try {
    const row = db.prepare(`
      SELECT id, species_id, walk_cycle_json, trot_cycle_json, gallop_cycle_json, turn_radius_m
      FROM mount_gait_profiles WHERE species_id = ? LIMIT 1
    `).get(speciesId);
    if (!row) return null;
    return {
      id: row.id,
      speciesId: row.species_id,
      walk: _parseJson(row.walk_cycle_json),
      trot: _parseJson(row.trot_cycle_json),
      gallop: _parseJson(row.gallop_cycle_json),
      turnRadiusM: row.turn_radius_m,
    };
  } catch {
    return null;
  }
}

/**
 * Mark a player_companion as mount-eligible. Called from the taming
 * flow (B2) after `attemptTame` writes the row, IF the creature's
 * species is in mount_species.
 *
 * Idempotent — running this with the flag already set is a no-op
 * (UPDATE is conditional).
 */
export function markCompanionMountable(db, companionId, speciesId) {
  if (!db || !companionId) return { ok: false, reason: "missing_args" };
  if (!isSpeciesMountable(db, speciesId)) {
    return { ok: false, reason: "species_not_mountable" };
  }
  try {
    const r = db.prepare(`
      UPDATE player_companions
      SET mount_eligible = 1
      WHERE id = ? AND mount_eligible = 0
    `).run(companionId);
    return { ok: true, changed: r.changes };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Wave 7a glue #6 — topology-based rideability for BRED HYBRIDS.
 *
 * A crossbred hybrid has no `mount_species` row, so the species-table gate
 * above can never flag it — yet a quadruped/winged-quadruped of adequate mass
 * is obviously rideable. This pure rule lets a bred creature become a mount
 * (closing tame→breed→mount) without inventing a fake species row.
 */
export const RIDEABLE_TOPOLOGIES = Object.freeze(new Set([
  "quadruped", "winged_quadruped",
]));
const MIN_RIDEABLE_MASS_KG = 120; // a horse is ~450kg; a large hound ~40kg is not rideable.

export function isTopologyRideable(topology, massKg) {
  if (!RIDEABLE_TOPOLOGIES.has(topology)) return false;
  const m = Number(massKg);
  return Number.isFinite(m) && m >= MIN_RIDEABLE_MASS_KG;
}

/**
 * Mark a companion mountable when its creature is a bred hybrid whose lineage
 * blueprint is a rideable topology + mass. Reads `creature_lineage.blueprint`
 * (stamped with `mountEligible` by generateHybrid). Idempotent + best-effort —
 * a non-hybrid / unknown creature is a no-op (returns {ok:false}).
 */
export function markCompanionMountableForHybrid(db, companionId, creatureId) {
  if (!db || !companionId || !creatureId) return { ok: false, reason: "missing_args" };
  try {
    const row = db.prepare(`SELECT blueprint FROM creature_lineage WHERE child_id = ?`).get(creatureId);
    if (!row?.blueprint) return { ok: false, reason: "not_a_hybrid" };
    let bp = null;
    try { bp = JSON.parse(row.blueprint); } catch { return { ok: false, reason: "bad_blueprint" }; }
    const rideable = bp?.mountEligible === true || isTopologyRideable(bp?.topology, bp?.massKg);
    if (!rideable) return { ok: false, reason: "topology_not_rideable" };
    const r = db.prepare(`
      UPDATE player_companions SET mount_eligible = 1 WHERE id = ? AND mount_eligible = 0
    `).run(companionId);
    return { ok: true, changed: r.changes };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Whether a given player_companion row carries the mount_eligible flag.
 */
export function isCompanionMountable(db, companionId) {
  if (!db || !companionId) return false;
  try {
    const row = db.prepare(`SELECT mount_eligible FROM player_companions WHERE id = ?`).get(companionId);
    return !!row?.mount_eligible;
  } catch {
    return false;
  }
}

/**
 * List companions with `mount_eligible = 1` for a given owner. Used by
 * the MountedHUD to populate the "switch mount" dropdown (B2 onward).
 */
export function listMountableCompanionsForOwner(db, ownerId, worldId) {
  if (!db || !ownerId) return [];
  try {
    if (worldId) {
      return db.prepare(`
        SELECT id, owner_id, creature_id, name, level, world_id, mount_state, last_action_at
        FROM player_companions
        WHERE owner_id = ? AND world_id = ? AND mount_eligible = 1
        ORDER BY last_action_at DESC NULLS LAST, caught_at DESC
      `).all(ownerId, worldId);
    }
    return db.prepare(`
      SELECT id, owner_id, creature_id, name, level, world_id, mount_state, last_action_at
      FROM player_companions
      WHERE owner_id = ? AND mount_eligible = 1
      ORDER BY last_action_at DESC NULLS LAST, caught_at DESC
    `).all(ownerId);
  } catch {
    return [];
  }
}

// ---- helpers ----
function _parseJson(s, fallback = null) {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function _unpackSpeciesJson(row) {
  return {
    speciesId: row.species_id,
    displayName: row.display_name,
    sizeClass: row.size_class,
    baseSpeedMps: row.base_speed_mps,
    baseStamina: row.base_stamina,
    carryCapacityKg: row.carry_capacity_kg,
    gaitProfileId: row.gait_profile_id,
    riderSeatOffset: _parseJson(row.rider_seat_offset_json, { x: 0, y: 1.4, z: 0, yaw: 0 }),
    saddleAnchorBone: row.saddle_anchor_bone,
    reinsAnchorBone: row.reins_anchor_bone,
    flightCapable: !!row.flight_capable,
    aestheticTags: _parseJson(row.aesthetic_tags_json, []),
  };
}
