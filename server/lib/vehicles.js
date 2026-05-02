/**
 * Vehicles — server-authoritative vehicle ownership and mount state.
 *
 * Phase D adds car / glider / plane gameplay. The presence layer
 * (city-presence.js) is the source of truth for "is this user in a
 * vehicle right now"; THIS module is the source of truth for ownership,
 * fuel, and durability across sessions.
 *
 * Mount/dismount flow:
 *   1. Client requests mount via /api/vehicles/:id/mount
 *   2. Route handler calls validateOwnership(db, vehicleId, userId)
 *   3. On pass, route handler calls setUserVehicle on the presence layer
 *      with the type from the DB. Presence layer trusts the type going
 *      forward — clients cannot forge a higher max-speed by claiming a
 *      different vehicle type.
 *   4. Dismount calls setUserVehicle(userId, { vehicleId:null, vehicleType:null })
 *
 * No real-money codepaths. Vehicles are spawned by gameplay events,
 * crafting, or admin macros — never purchased with fiat.
 */

import crypto from "crypto";

const VEHICLE_TYPES = Object.freeze(new Set(["car", "glider", "plane"]));

/**
 * @returns {{ ok:true, vehicle:object } | { ok:false, reason:string }}
 */
export function spawnVehicle(db, { ownerId, world = "concordia", type = "car", pose = null }) {
  if (!ownerId) return { ok: false, reason: "missing_owner" };
  if (!VEHICLE_TYPES.has(type)) return { ok: false, reason: "invalid_type" };

  const id = `veh_${crypto.randomBytes(8).toString("hex")}`;
  const poseJson = JSON.stringify(pose || { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  db.prepare(`
    INSERT INTO vehicles (id, owner_id, world, type, pose_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, ownerId, world, type, poseJson);

  return { ok: true, vehicle: db.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(id) };
}

export function listOwnedVehicles(db, ownerId, { world = null } = {}) {
  if (world) {
    return db.prepare(`SELECT * FROM vehicles WHERE owner_id=? AND world=? AND is_active=1 ORDER BY created_at DESC`).all(ownerId, world);
  }
  return db.prepare(`SELECT * FROM vehicles WHERE owner_id=? AND is_active=1 ORDER BY created_at DESC`).all(ownerId);
}

export function getVehicle(db, vehicleId) {
  return db.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(vehicleId);
}

/**
 * Server-authoritative ownership check. Always run before flipping presence
 * vehicleType. Returns the row if valid, null otherwise.
 */
export function validateOwnership(db, vehicleId, userId) {
  const v = db.prepare(`SELECT * FROM vehicles WHERE id=? AND owner_id=? AND is_active=1`).get(vehicleId, userId);
  return v || null;
}

/** Persist a pose update from a mount endpoint. Pose validation lives client-side. */
export function updatePose(db, vehicleId, pose) {
  db.prepare(`UPDATE vehicles SET pose_json=?, updated_at=unixepoch() WHERE id=?`)
    .run(JSON.stringify(pose), vehicleId);
}

export function despawnVehicle(db, vehicleId, ownerId) {
  const v = validateOwnership(db, vehicleId, ownerId);
  if (!v) return { ok: false, reason: "not_owned_or_already_inactive" };
  db.prepare(`UPDATE vehicles SET is_active=0, updated_at=unixepoch() WHERE id=?`).run(vehicleId);
  return { ok: true };
}
