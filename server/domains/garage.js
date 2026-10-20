// server/domains/garage.js
//
// Macro surface for the vehicle garage (`/lenses/garage`).
//
// The lens drives the REST routes (`/api/garage/*` in server.js), which are
// themselves thin wrappers over server/lib/world-vehicles.js. This file exposes
// the SAME lib functions as registered macros so:
//   - the Orchestrated Invariant Engine (macro-assassin) can drive the
//     spawn / list / get / mount paths adversarially against a real DB, and
//   - the generic lens shell / ⌘K / mobile MacroClient can reach the garage
//     through the uniform `POST /api/lens/run { domain:"garage", name, input }`
//     path without bespoke endpoints.
//
// Every macro delegates to the real lib — NO spawn/list/get/mount/move logic is
// duplicated here. Read macros (list / mine / get) are headless-safe; write
// macros (spawn / mount / dismount / move) validate inputs and return a clean
// { ok:false, reason } envelope rather than throwing.
//
// The canonical vehicle kinds are cart / boat / canal_taxi (mig 177). owner_kind
// is player / realm / npc / none. A player-owned spawn stamps ownerKind='player'
// + ownerId=actor so `mine` can scope the player's own fleet.

import {
  spawnVehicle,
  getVehicle,
  listVehiclesInWorld,
  mount,
  dismount,
  moveVehicle,
  occupantCount,
  despawnVehicle,
} from "../lib/world-vehicles.js";
import { actorId as authzActorId, isAdmin } from "../lib/lens-authz.js";

function actorId(ctx) {
  return authzActorId(ctx);
}

// Operators (admin / owner / founder, or an explicit isAdmin flag) may stamp
// a non-player owner. There is no realm-officer role in the authz helpers;
// members always spawn as themselves.
function isOperator(ctx) {
  return isAdmin(ctx);
}

/**
 * World listings omit owner_id. A get does the same for anyone who is not
 * the player-owner, and always stamps isMine so the client can tell without
 * seeing the raw account id.
 */
function projectVehicle(vehicle, actor) {
  const isMine = vehicle.owner_kind === "player" && !!actor && vehicle.owner_id === actor;
  if (isMine) return { ...vehicle, isMine: true };
  const projected = { ...vehicle, isMine: false };
  delete projected.owner_id;
  return projected;
}

function clampStr(v, n, fallback) {
  if (v === undefined || v === null) return fallback;
  return String(v).slice(0, n);
}

export default function registerGarageMacros(register) {
  // ── reads (headless-safe) ──────────────────────────────────────────────

  /**
   * garage.list — every vehicle in a world (optionally kind-filtered). This is
   * the same data the in-world VehicleRenderer reads. input: { worldId?, kind? }
   */
  register("garage", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = clampStr(input.worldId, 64, "concordia-hub");
    const kind = input.kind ? clampStr(input.kind, 32, null) : null;
    return { ok: true, worldId, vehicles: listVehiclesInWorld(db, worldId, { kind }) };
  }, { note: "list vehicles in a world (kind-filterable)" });

  /**
   * garage.mine — only the calling player's owned vehicles in a world. Scopes
   * the world listing down to owner_kind='player' AND owner_id=actor, so the
   * garage hub can show "your fleet". input: { worldId?, kind? }
   */
  register("garage", "mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const worldId = clampStr(input.worldId, 64, "concordia-hub");
    const kind = input.kind ? clampStr(input.kind, 32, null) : null;
    // listVehiclesInWorld omits owner_id from its projection (renderer doesn't
    // need it), so re-read the owner-scoped rows directly with the same column
    // set the lib's getVehicle returns. No new query logic lives in the lens —
    // this is the per-owner slice of the same table.
    try {
      const cols = `id, world_id, kind, owner_kind, owner_id, capacity, fare_cc, route_id, pos_x, pos_y, pos_z, heading, condition_pct`;
      const stmt = kind
        ? db.prepare(`SELECT ${cols} FROM world_vehicles WHERE world_id = ? AND owner_kind = 'player' AND owner_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 200`)
        : db.prepare(`SELECT ${cols} FROM world_vehicles WHERE world_id = ? AND owner_kind = 'player' AND owner_id = ? ORDER BY created_at DESC LIMIT 200`);
      const vehicles = kind ? stmt.all(worldId, userId, kind) : stmt.all(worldId, userId);
      return { ok: true, worldId, vehicles };
    } catch (e) {
      return { ok: true, worldId, vehicles: [], reason: e?.message };
    }
  }, { note: "the calling player's own vehicles in a world" });

  /**
   * garage.get — one vehicle by id (full row incl. heading + condition_pct).
   * input: { vehicleId }
   */
  register("garage", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.vehicleId) return { ok: false, reason: "no_vehicle_id" };
    const vehicle = getVehicle(db, String(input.vehicleId));
    if (!vehicle) return { ok: false, reason: "vehicle_not_found" };
    return {
      ok: true,
      vehicle: projectVehicle(vehicle, actorId(ctx)),
      occupants: occupantCount(db, String(input.vehicleId)),
    };
  }, { note: "get one vehicle by id (with live occupant count)" });

  // ── writes (validate, never throw) ─────────────────────────────────────

  // Shared spawn path used by both `spawn` and the generic `create` artifact
  // verb so the spawn logic lives in exactly one place (the lib) and both
  // delegate to it. A player-driven spawn stamps the actor as owner.
  async function doSpawn(ctx, input = {}) {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    // Members cannot choose ownerKind/ownerId. A caller-supplied npc/realm/none
    // owner is ignored and the vehicle is stamped to the actor. Operators may
    // still spawn realm/npc/none vehicles with an explicit ownerId.
    let ownerKind = "player";
    let ownerId = userId;
    if (isOperator(ctx)) {
      ownerKind = clampStr(input.ownerKind, 16, "player");
      ownerId = ownerKind === "player" ? userId : clampStr(input.ownerId, 64, "");
    }
    if (ownerKind === "player" && !userId) return { ok: false, reason: "no_user" };
    return spawnVehicle(db, {
      worldId: clampStr(input.worldId, 64, "concordia-hub"),
      kind: clampStr(input.kind, 32, ""),
      ownerKind,
      ownerId,
      capacity: input.capacity != null ? Number(input.capacity) : null,
      fare_cc: input.fare_cc != null ? Number(input.fare_cc) : null,
      route_id: input.route_id != null ? clampStr(input.route_id, 64, null) : null,
      position: input.position && typeof input.position === "object" ? input.position : null,
    });
  }

  /**
   * garage.spawn — spawn a vehicle into a world. A player-owned spawn is owned
   * by the actor. Validates kind / owner_kind / canal-taxi-route in the lib.
   * input: { worldId?, kind, ownerKind?, ownerId?, capacity?, fare_cc?,
   *          route_id?, position? }
   */
  register("garage", "spawn", doSpawn, { note: "spawn a vehicle (player-owned by default)" });

  /**
   * garage.create — generic lens `create` artifact verb. A "vehicle" artifact is
   * created by spawning. Surfaced so the manifest's create verb resolves and the
   * spawn path runs through the SAME code as `spawn` (no duplicated logic).
   * input: same as spawn.
   */
  register("garage", "create", doSpawn, { note: "create a vehicle artifact (spawn)" });

  /**
   * garage.mount — board a vehicle (capacity-checked, canal-taxi fare logged).
   * The actor mounts as a player occupant. input: { vehicleId }
   */
  register("garage", "mount", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.vehicleId) return { ok: false, reason: "no_vehicle_id" };
    return mount(db, String(input.vehicleId), "player", userId);
  }, { note: "board a vehicle as the calling player" });

  /**
   * garage.dismount — leave a vehicle the actor is riding. input: { vehicleId }
   */
  register("garage", "dismount", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.vehicleId) return { ok: false, reason: "no_vehicle_id" };
    return dismount(db, String(input.vehicleId), "player", userId);
  }, { note: "leave a vehicle the player is riding" });

  /**
   * garage.move — move a vehicle the actor owns or rides. Position delta is
   * bounded server-side (anti-teleport). input: { vehicleId, pos_x, pos_y,
   * pos_z, heading? }
   */
  /**
   * garage.despawn — owner-only removal. A non-owner gets not_authorized and
   * the row stays. input: { vehicleId }
   */
  register("garage", "despawn", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.vehicleId) return { ok: false, reason: "no_vehicle_id" };
    return despawnVehicle(db, String(input.vehicleId), "player", userId);
  }, { note: "despawn a vehicle the calling player owns" });

  register("garage", "move", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.vehicleId) return { ok: false, reason: "no_vehicle_id" };
    return moveVehicle(db, String(input.vehicleId), "player", userId, {
      pos_x: Number(input.pos_x),
      pos_y: Number(input.pos_y),
      pos_z: Number(input.pos_z),
      heading: input.heading != null ? Number(input.heading) : undefined,
    });
  }, { note: "move a vehicle the player owns or rides (delta-bounded)" });
}
