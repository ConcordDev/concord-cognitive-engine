// server/domains/vehicles.js
//
// Concordia Phase 6 — vehicle macros.

import {
  spawnVehicle,
  getVehicle,
  listVehiclesInWorld,
  mount,
  dismount,
  moveVehicle,
  occupantCount,
  VEHICLE_CONSTANTS,
} from "../lib/world-vehicles.js";

export default function registerVehicleMacros(register) {
  register("vehicles", "list_in_world", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = String(input?.worldId || "").trim();
    if (!worldId) return { ok: false, reason: "missing_inputs" };
    const kind = input?.kind ? String(input.kind) : null;
    return { ok: true, vehicles: listVehiclesInWorld(db, worldId, { kind }) };
  });

  register("vehicles", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const id = String(input?.vehicleId || "").trim();
    if (!id) return { ok: false, reason: "missing_inputs" };
    const v = getVehicle(db, id);
    if (!v) return { ok: false, reason: "vehicle_not_found" };
    return { ok: true, vehicle: v, occupants: occupantCount(db, id) };
  });

  register("vehicles", "spawn", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return spawnVehicle(db, {
      worldId: input?.worldId,
      kind: input?.kind,
      ownerKind: "player",
      ownerId: userId,
      capacity: input?.capacity,
      fare_cc: input?.fare_cc,
      route_id: input?.route_id,
      position: input?.position,
    });
  });

  register("vehicles", "mount", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const vehicleId = String(input?.vehicleId || "").trim();
    if (!vehicleId) return { ok: false, reason: "missing_inputs" };
    return mount(db, vehicleId, "player", userId);
  });

  register("vehicles", "dismount", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const vehicleId = String(input?.vehicleId || "").trim();
    if (!vehicleId) return { ok: false, reason: "missing_inputs" };
    return dismount(db, vehicleId, "player", userId);
  });

  register("vehicles", "move", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const vehicleId = String(input?.vehicleId || "").trim();
    if (!vehicleId) return { ok: false, reason: "missing_inputs" };
    return moveVehicle(db, vehicleId, "player", userId, {
      pos_x: Number(input?.pos_x),
      pos_y: Number(input?.pos_y),
      pos_z: Number(input?.pos_z),
      heading: Number(input?.heading),
    });
  });

  register("vehicles", "constants", async () => {
    return { ok: true, constants: VEHICLE_CONSTANTS };
  });
}
