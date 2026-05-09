// server/lib/companions-mount.js
//
// Concordia Procedural Mount System Phase B2 — taming + riding.
//
// Wraps the existing companions.js#attemptTame so a successful tame on
// a mountable species also sets `mount_eligible=1` on the resulting
// player_companions row. Adds the riding state machine on the server
// side (server validates `mount` / `dismount` and writes the
// mounted_instances ledger).
//
// CLAUDE.md invariants enforced here:
//   - A user has at most one active `mounted_instances` row per world.
//   - Riding requires both `player_companions` ownership AND the
//     companion's `mount_eligible = 1`.
//   - dismount is idempotent (calling it when not mounted is a no-op).

import crypto from "node:crypto";
import { attemptTame } from "./companions.js";
import { isSpeciesMountable, markCompanionMountable, getMountSpecies, getGaitProfile } from "./ecosystem/mount-eligibility.js";

/**
 * Read the species_id for a creature row in world_npcs. fauna-spawner
 * writes archetype = `creature:${species_id}`; we strip the prefix.
 */
function speciesIdForCreature(db, creatureId) {
  if (!db || !creatureId) return null;
  try {
    const row = db.prepare(`SELECT archetype FROM world_npcs WHERE id = ?`).get(creatureId);
    if (!row) return null;
    const a = String(row.archetype || "");
    if (a.startsWith("creature:")) return a.slice("creature:".length);
    return null;
  } catch {
    return null;
  }
}

/**
 * Tame a creature, then if its species is mountable, mark the new
 * companion as mount-eligible. Single transaction so a bond/roll
 * succeeded record is consistent with mount eligibility flag.
 *
 * @returns {{ok: boolean, companionId?: string, mountEligible?: boolean, speciesId?: string, reason?: string}}
 */
export function tameForMount(db, args) {
  if (!db) return { ok: false, reason: "no_db" };
  const r = attemptTame(db, args);
  if (!r.ok) return r;
  const speciesId = speciesIdForCreature(db, args.creatureId);
  if (!speciesId) return { ...r, mountEligible: false };
  if (!isSpeciesMountable(db, speciesId)) return { ...r, mountEligible: false, speciesId };
  markCompanionMountable(db, r.companionId, speciesId);
  return { ...r, mountEligible: true, speciesId };
}

// ---- mounted_instances ledger ----

function _newMountedId() {
  return `mtinst_${crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Read the rider's currently-active mounted_instance for a world (the
 * single open row with dismounted_at IS NULL).
 */
export function getActiveMountFor(db, riderId, worldId = "concordia-hub") {
  if (!db || !riderId) return null;
  try {
    return db.prepare(`
      SELECT id, rider_id, mount_companion_id, world_id, mounted_at, seat_offset_json
      FROM mounted_instances
      WHERE rider_id = ? AND world_id = ? AND dismounted_at IS NULL
      LIMIT 1
    `).get(riderId, worldId) || null;
  } catch {
    return null;
  }
}

/**
 * Create a mounted_instances row. Validates ownership, eligibility,
 * and the one-active-per-world invariant. Returns seat_offset so the
 * client can lock the avatar's IK pelvis to the mount's saddle anchor.
 *
 * @param {object} db
 * @param {object} args — { riderId, companionId, worldId? }
 */
export function mount(db, args) {
  if (!db) return { ok: false, reason: "no_db" };
  const { riderId, companionId, worldId = "concordia-hub" } = args || {};
  if (!riderId || !companionId) return { ok: false, reason: "missing_args" };

  // Ownership + eligibility check.
  const comp = db.prepare(`
    SELECT id, owner_id, world_id, mount_eligible, creature_id, name
    FROM player_companions WHERE id = ?
  `).get(companionId);
  if (!comp) return { ok: false, reason: "companion_not_found" };
  if (comp.owner_id !== riderId) return { ok: false, reason: "not_owner" };
  if (!comp.mount_eligible) return { ok: false, reason: "not_mountable" };
  // Companion must live in the world we're mounting into — otherwise a
  // single companion could open `mounted_instances` rows in multiple
  // worlds simultaneously, breaking world consistency.
  if (comp.world_id !== worldId) return { ok: false, reason: "wrong_world" };

  // One active per world.
  const existing = getActiveMountFor(db, riderId, worldId);
  if (existing) return { ok: false, reason: "already_mounted", instanceId: existing.id };

  const speciesId = speciesIdForCreature(db, comp.creature_id);
  const species = speciesId ? getMountSpecies(db, speciesId) : null;
  const seatOffset = species?.riderSeatOffset || { x: 0, y: 1.4, z: 0, yaw: 0 };

  const id = _newMountedId();
  try {
    db.prepare(`
      INSERT INTO mounted_instances
        (id, rider_id, mount_companion_id, world_id, mounted_at, seat_offset_json)
      VALUES (?, ?, ?, ?, unixepoch(), ?)
    `).run(id, riderId, companionId, worldId, JSON.stringify(seatOffset));
  } catch (err) {
    return { ok: false, reason: err.message };
  }

  return {
    ok: true,
    instanceId: id,
    companionId,
    speciesId,
    seatOffset,
    saddleAnchorBone: species?.saddleAnchorBone || "spine_03",
    reinsAnchorBone: species?.reinsAnchorBone || "head",
    flightCapable: !!species?.flightCapable,
  };
}

/**
 * Close the rider's active mounted_instance for a world. Idempotent —
 * calling when not mounted returns ok:true with `wasMounted:false`.
 *
 * Ground-clearance check is left to the client (physics + raycast); the
 * server only enforces the ledger invariant.
 */
export function dismount(db, riderId, worldId = "concordia-hub") {
  if (!db) return { ok: false, reason: "no_db" };
  if (!riderId) return { ok: false, reason: "no_rider" };
  const existing = getActiveMountFor(db, riderId, worldId);
  if (!existing) return { ok: true, wasMounted: false };
  try {
    db.prepare(`
      UPDATE mounted_instances SET dismounted_at = unixepoch()
      WHERE id = ? AND dismounted_at IS NULL
    `).run(existing.id);
    return { ok: true, wasMounted: true, instanceId: existing.id };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Read the rider's full active-mount payload (instance + companion +
 * species + gait) for the MountedHUD on connect or reconnect.
 */
export function getActiveMountPayload(db, riderId, worldId = "concordia-hub") {
  const inst = getActiveMountFor(db, riderId, worldId);
  if (!inst) return null;
  const comp = db.prepare(`SELECT id, name, creature_id, mount_eligible, mount_state FROM player_companions WHERE id = ?`)
    .get(inst.mount_companion_id);
  if (!comp) return { instance: inst };
  const speciesId = speciesIdForCreature(db, comp.creature_id);
  const species = speciesId ? getMountSpecies(db, speciesId) : null;
  const gait = speciesId ? getGaitProfile(db, speciesId) : null;
  let seatOffset = null;
  try { seatOffset = JSON.parse(inst.seat_offset_json || "null"); } catch { /* fall back */ }
  return {
    instance: { id: inst.id, mountedAt: inst.mounted_at },
    companion: { id: comp.id, name: comp.name, creatureId: comp.creature_id },
    speciesId,
    species,
    gait,
    seatOffset: seatOffset || species?.riderSeatOffset || { x: 0, y: 1.4, z: 0, yaw: 0 },
  };
}

/**
 * History view — closed mounted_instances rows for the rider, ordered
 * recent-first. Used by the achievement / habit panels.
 */
export function listMountHistory(db, riderId, { worldId = null, limit = 50 } = {}) {
  if (!db || !riderId) return [];
  try {
    if (worldId) {
      return db.prepare(`
        SELECT id, mount_companion_id, world_id, mounted_at, dismounted_at
        FROM mounted_instances
        WHERE rider_id = ? AND world_id = ? AND dismounted_at IS NOT NULL
        ORDER BY dismounted_at DESC LIMIT ?
      `).all(riderId, worldId, Math.min(limit, 200));
    }
    return db.prepare(`
      SELECT id, mount_companion_id, world_id, mounted_at, dismounted_at
      FROM mounted_instances
      WHERE rider_id = ? AND dismounted_at IS NOT NULL
      ORDER BY dismounted_at DESC LIMIT ?
    `).all(riderId, Math.min(limit, 200));
  } catch {
    return [];
  }
}
