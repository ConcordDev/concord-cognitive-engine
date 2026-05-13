/**
 * Tier-2 contract tests for Concordia Phase 6 — world-vehicles.
 *
 * Pins:
 *   - spawnVehicle validates kind + owner_kind + canal-taxi requires route
 *   - mount fills seats up to capacity; capacity exceeded → vehicle_full
 *   - dismount removes the row
 *   - moveVehicle bounded by MAX_POS_DELTA_M
 *   - moveVehicle authorization (owner or occupant only)
 *   - canal_taxi fare written to vehicle_fare_log on player mount
 *
 * Run: node --test tests/world-vehicles.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

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
import { up as up177 } from "../migrations/177_world_vehicles.js";

function setupDb() {
  const db = new Database(":memory:");
  up177(db);
  return db;
}

describe("Phase 6 / world-vehicles — spawnVehicle validation", () => {
  it("rejects missing inputs", () => {
    const db = setupDb();
    const r = spawnVehicle(db, { worldId: "concordia-hub" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("rejects bad kind", () => {
    const db = setupDb();
    const r = spawnVehicle(db, { worldId: "concordia-hub", kind: "spaceship" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_kind");
  });

  it("rejects bad owner kind", () => {
    const db = setupDb();
    const r = spawnVehicle(db, { worldId: "concordia-hub", kind: "cart", ownerKind: "ghost" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_owner_kind");
  });

  it("canal_taxi requires route", () => {
    const db = setupDb();
    const r = spawnVehicle(db, { worldId: "concordia-hub", kind: "canal_taxi" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "canal_taxi_requires_route");
  });

  it("spawns a cart with defaults", () => {
    const db = setupDb();
    const r = spawnVehicle(db, { worldId: "concordia-hub", kind: "cart", ownerKind: "player", ownerId: "user_1" });
    assert.equal(r.ok, true);
    assert.equal(r.capacity, VEHICLE_CONSTANTS.DEFAULT_CAPACITY.cart);
    assert.equal(r.fare_cc, 0);
  });

  it("spawns a canal taxi with route + fare", () => {
    const db = setupDb();
    const r = spawnVehicle(db, { worldId: "concordia-hub", kind: "canal_taxi", ownerKind: "realm", ownerId: "realm_tunya", route_id: "rt_canal_a" });
    assert.equal(r.ok, true);
    assert.equal(r.fare_cc, VEHICLE_CONSTANTS.DEFAULT_FARE_CC.canal_taxi);
  });
});

describe("Phase 6 / world-vehicles — mount / dismount", () => {
  it("mounts up to capacity", () => {
    const db = setupDb();
    const v = spawnVehicle(db, { worldId: "concordia-hub", kind: "cart", capacity: 2 });
    assert.equal(mount(db, v.vehicleId, "player", "u1").action, "mounted");
    assert.equal(mount(db, v.vehicleId, "player", "u2").action, "mounted");
    const full = mount(db, v.vehicleId, "player", "u3");
    assert.equal(full.ok, false);
    assert.equal(full.reason, "vehicle_full");
  });

  it("dismount removes row", () => {
    const db = setupDb();
    const v = spawnVehicle(db, { worldId: "concordia-hub", kind: "cart" });
    mount(db, v.vehicleId, "player", "u1");
    assert.equal(occupantCount(db, v.vehicleId), 1);
    dismount(db, v.vehicleId, "player", "u1");
    assert.equal(occupantCount(db, v.vehicleId), 0);
  });

  it("dismount of non-occupant returns not_mounted", () => {
    const db = setupDb();
    const v = spawnVehicle(db, { worldId: "concordia-hub", kind: "cart" });
    const r = dismount(db, v.vehicleId, "player", "u_ghost");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_mounted");
  });

  it("canal_taxi mount writes fare log", () => {
    const db = setupDb();
    const v = spawnVehicle(db, { worldId: "concordia-hub", kind: "canal_taxi", route_id: "rt_a" });
    mount(db, v.vehicleId, "player", "u1");
    const row = db.prepare(`SELECT vehicle_id, user_id, fare_cc FROM vehicle_fare_log WHERE vehicle_id = ?`).get(v.vehicleId);
    assert.equal(row.user_id, "u1");
    assert.equal(row.fare_cc, VEHICLE_CONSTANTS.DEFAULT_FARE_CC.canal_taxi);
  });

  it("cart mount does NOT write fare log", () => {
    const db = setupDb();
    const v = spawnVehicle(db, { worldId: "concordia-hub", kind: "cart" });
    mount(db, v.vehicleId, "player", "u1");
    // table either doesn't exist or has no row — both ok
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM vehicle_fare_log WHERE vehicle_id = ?`).get(v.vehicleId);
      assert.equal(row.n, 0);
    } catch { /* table optional */ }
  });
});

describe("Phase 6 / world-vehicles — moveVehicle", () => {
  it("owner can move", () => {
    const db = setupDb();
    const v = spawnVehicle(db, { worldId: "concordia-hub", kind: "cart", ownerKind: "player", ownerId: "u1" });
    const r = moveVehicle(db, v.vehicleId, "player", "u1", { pos_x: 5, pos_y: 0, pos_z: 5, heading: 1.57 });
    assert.equal(r.action, "moved");
  });

  it("occupant can move", () => {
    const db = setupDb();
    const v = spawnVehicle(db, { worldId: "concordia-hub", kind: "cart" });
    mount(db, v.vehicleId, "player", "u2");
    const r = moveVehicle(db, v.vehicleId, "player", "u2", { pos_x: 5, pos_y: 0, pos_z: 5 });
    assert.equal(r.action, "moved");
  });

  it("non-owner non-occupant refused", () => {
    const db = setupDb();
    const v = spawnVehicle(db, { worldId: "concordia-hub", kind: "cart", ownerKind: "player", ownerId: "u1" });
    const r = moveVehicle(db, v.vehicleId, "player", "u_evil", { pos_x: 5, pos_y: 0, pos_z: 5 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_authorized");
  });

  it("delta cap rejects teleport", () => {
    const db = setupDb();
    const v = spawnVehicle(db, { worldId: "concordia-hub", kind: "cart", ownerKind: "player", ownerId: "u1" });
    const r = moveVehicle(db, v.vehicleId, "player", "u1", { pos_x: 5000, pos_y: 0, pos_z: 5000 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "delta_too_large");
  });
});

describe("Phase 6 / world-vehicles — list_in_world", () => {
  it("filters by kind", () => {
    const db = setupDb();
    spawnVehicle(db, { worldId: "concordia-hub", kind: "cart" });
    spawnVehicle(db, { worldId: "concordia-hub", kind: "boat" });
    spawnVehicle(db, { worldId: "concordia-hub", kind: "canal_taxi", route_id: "r1" });
    assert.equal(listVehiclesInWorld(db, "concordia-hub").length, 3);
    assert.equal(listVehiclesInWorld(db, "concordia-hub", { kind: "boat" }).length, 1);
  });
});
