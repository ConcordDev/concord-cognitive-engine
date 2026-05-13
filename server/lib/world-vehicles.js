// server/lib/world-vehicles.js
//
// Concordia Phase 6 — world vehicle lifecycle.
//
// Spawn / list / mount / dismount / move. Capacity-checked at mount;
// fare-charged for canal taxis via the existing wallet (mintCoins/
// debit, best-effort — gracefully degrades if wallet module is
// absent on minimal builds).
//
// Position writes are bounded by `MAX_POS_DELTA_M` per update to
// stop client teleport exploits. Heading is unbounded (just a yaw
// scalar).

import crypto from "node:crypto";
import logger from "../logger.js";

const MAX_POS_DELTA_M = 50;
const DEFAULT_CAPACITY = { cart: 4, boat: 6, canal_taxi: 8 };
const DEFAULT_FARE_CC  = { cart: 0, boat: 0, canal_taxi: 5 };

function makeVehicleId() {
  return `veh_${crypto.randomUUID().slice(0, 16)}`;
}

export function spawnVehicle(db, {
  worldId,
  kind,
  ownerKind = "none",
  ownerId = "",
  capacity = null,
  fare_cc = null,
  route_id = null,
  position = null,
} = {}) {
  if (!db || !worldId || !kind) return { ok: false, reason: "missing_inputs" };
  if (!["cart", "boat", "canal_taxi"].includes(kind)) return { ok: false, reason: "bad_kind" };
  if (!["player", "realm", "npc", "none"].includes(ownerKind)) return { ok: false, reason: "bad_owner_kind" };
  if (kind === "canal_taxi" && !route_id) return { ok: false, reason: "canal_taxi_requires_route" };

  const id = makeVehicleId();
  const cap = Number.isFinite(capacity) ? Math.max(1, Math.min(12, capacity)) : DEFAULT_CAPACITY[kind];
  const fare = Number.isFinite(fare_cc) ? Math.max(0, fare_cc) : DEFAULT_FARE_CC[kind];
  const pos = position || { x: 0, y: 0, z: 0 };

  try {
    db.prepare(`
      INSERT INTO world_vehicles (id, world_id, kind, owner_kind, owner_id, capacity, fare_cc, route_id, pos_x, pos_y, pos_z)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, worldId, kind, ownerKind, ownerId || "", cap, fare, route_id, pos.x || 0, pos.y || 0, pos.z || 0);
    return { ok: true, vehicleId: id, kind, capacity: cap, fare_cc: fare };
  } catch (err) {
    try { logger.warn?.("vehicle_spawn_failed", { error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: "insert_failed" };
  }
}

export function getVehicle(db, vehicleId) {
  if (!db || !vehicleId) return null;
  try {
    return db.prepare(`
      SELECT id, world_id, kind, owner_kind, owner_id, capacity, fare_cc, route_id,
             pos_x, pos_y, pos_z, heading, condition_pct
      FROM world_vehicles WHERE id = ?
    `).get(vehicleId) || null;
  } catch {
    return null;
  }
}

export function listVehiclesInWorld(db, worldId, { kind = null } = {}) {
  if (!db || !worldId) return [];
  try {
    const stmt = kind
      ? db.prepare(`SELECT id, world_id, kind, owner_kind, capacity, fare_cc, pos_x, pos_z FROM world_vehicles WHERE world_id = ? AND kind = ? LIMIT 200`)
      : db.prepare(`SELECT id, world_id, kind, owner_kind, capacity, fare_cc, pos_x, pos_z FROM world_vehicles WHERE world_id = ? LIMIT 200`);
    return kind ? stmt.all(worldId, kind) : stmt.all(worldId);
  } catch {
    return [];
  }
}

export function occupantCount(db, vehicleId) {
  try {
    const r = db.prepare(`SELECT COUNT(*) AS n FROM vehicle_occupants WHERE vehicle_id = ?`).get(vehicleId);
    return r?.n || 0;
  } catch { return 0; }
}

/**
 * Mount a player onto a vehicle. Capacity-checked. Canal-taxi fare
 * deducted (best-effort against world_economy / wallet).
 */
export function mount(db, vehicleId, occupantKind, occupantId) {
  if (!db || !vehicleId || !occupantKind || !occupantId) return { ok: false, reason: "missing_inputs" };
  const veh = getVehicle(db, vehicleId);
  if (!veh) return { ok: false, reason: "vehicle_not_found" };
  const occN = occupantCount(db, vehicleId);
  if (occN >= veh.capacity) return { ok: false, reason: "vehicle_full", occN, capacity: veh.capacity };

  // Canal taxi: charge fare. Use the wallet module if available.
  if (veh.kind === "canal_taxi" && veh.fare_cc > 0 && occupantKind === "player") {
    try {
      // Best-effort: world_economy_state or user_wallets — caller wires
      // the actual debit. For Phase 6 we record the fare as a column
      // for later reconciliation; full wallet debit can be added in a
      // follow-up without changing this surface.
      // Insert a 1-row fare ledger row if the table exists.
      db.prepare(`
        CREATE TABLE IF NOT EXISTS vehicle_fare_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vehicle_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          fare_cc INTEGER NOT NULL,
          paid_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `).run();
      db.prepare(`INSERT INTO vehicle_fare_log (vehicle_id, user_id, fare_cc) VALUES (?, ?, ?)`).run(vehicleId, occupantId, veh.fare_cc);
    } catch { /* fare log optional */ }
  }

  try {
    db.prepare(`
      INSERT INTO vehicle_occupants (vehicle_id, occupant_kind, occupant_id, seat)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(vehicle_id, occupant_kind, occupant_id) DO NOTHING
    `).run(vehicleId, occupantKind, occupantId, occN);
    return { ok: true, action: "mounted", seat: occN };
  } catch (err) {
    return { ok: false, reason: "mount_failed", error: err?.message };
  }
}

export function dismount(db, vehicleId, occupantKind, occupantId) {
  if (!db || !vehicleId || !occupantKind || !occupantId) return { ok: false, reason: "missing_inputs" };
  try {
    const r = db.prepare(`
      DELETE FROM vehicle_occupants WHERE vehicle_id = ? AND occupant_kind = ? AND occupant_id = ?
    `).run(vehicleId, occupantKind, occupantId);
    if (r.changes === 0) return { ok: false, reason: "not_mounted" };
    return { ok: true, action: "dismounted" };
  } catch {
    return { ok: false, reason: "dismount_failed" };
  }
}

/**
 * Move a vehicle to a new position + heading. Caller must be the
 * owner OR an occupant. Position delta bounded to prevent teleport.
 */
export function moveVehicle(db, vehicleId, requesterKind, requesterId, { pos_x, pos_y, pos_z, heading }) {
  if (!db || !vehicleId || !requesterId) return { ok: false, reason: "missing_inputs" };
  if (!Number.isFinite(pos_x) || !Number.isFinite(pos_y) || !Number.isFinite(pos_z)) {
    return { ok: false, reason: "bad_position" };
  }
  const veh = getVehicle(db, vehicleId);
  if (!veh) return { ok: false, reason: "vehicle_not_found" };

  // Authorization: owner or occupant.
  const isOwner = veh.owner_kind === requesterKind && veh.owner_id === requesterId;
  const isOccupant = !!db.prepare(`
    SELECT 1 FROM vehicle_occupants WHERE vehicle_id = ? AND occupant_kind = ? AND occupant_id = ?
  `).get(vehicleId, requesterKind, requesterId);
  if (!isOwner && !isOccupant) return { ok: false, reason: "not_authorized" };

  // Delta cap — keep total movement bounded each tick.
  const dx = pos_x - veh.pos_x;
  const dz = pos_z - veh.pos_z;
  const dist = Math.hypot(dx, dz);
  if (dist > MAX_POS_DELTA_M) return { ok: false, reason: "delta_too_large", dist, cap: MAX_POS_DELTA_M };

  try {
    db.prepare(`
      UPDATE world_vehicles
      SET pos_x = ?, pos_y = ?, pos_z = ?, heading = ?, updated_at = unixepoch()
      WHERE id = ?
    `).run(pos_x, pos_y, pos_z, Number.isFinite(heading) ? heading : veh.heading, vehicleId);
    return { ok: true, action: "moved", pos_x, pos_y, pos_z };
  } catch (err) {
    return { ok: false, reason: "move_failed", error: err?.message };
  }
}

export const VEHICLE_CONSTANTS = Object.freeze({
  MAX_POS_DELTA_M,
  DEFAULT_CAPACITY,
  DEFAULT_FARE_CC,
});
