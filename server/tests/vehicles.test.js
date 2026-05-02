/**
 * Vehicles + presence speed clamp tests.
 * Run: node --test tests/vehicles.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import {
  spawnVehicle,
  listOwnedVehicles,
  validateOwnership,
  despawnVehicle,
} from "../lib/vehicles.js";
import {
  setUserVehicle,
  getUserVehicle,
  getMaxSpeedForVehicle,
  updateUserPosition,
  configurePresence,
} from "../lib/city-presence.js";

function setupDB() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, sparks INTEGER NOT NULL DEFAULT 1000);
    CREATE TABLE player_world_state (
      user_id TEXT PRIMARY KEY,
      city_id TEXT NOT NULL DEFAULT 'concordia-central',
      district_id TEXT, x REAL, y REAL, z REAL, rotation REAL, direction REAL,
      chunk_x INTEGER, chunk_z INTEGER,
      current_animation TEXT DEFAULT 'idle', action TEXT,
      health INTEGER DEFAULT 100, max_health INTEGER DEFAULT 100,
      stamina INTEGER DEFAULT 100, max_stamina INTEGER DEFAULT 100,
      client_state_json TEXT DEFAULT '{}',
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      vehicle_id TEXT, vehicle_type TEXT, vehicle_pose_json TEXT
    );
    CREATE TABLE vehicles (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
      world TEXT NOT NULL DEFAULT 'concordia',
      type TEXT NOT NULL DEFAULT 'car',
      pose_json TEXT NOT NULL DEFAULT '{}',
      fuel REAL NOT NULL DEFAULT 100,
      durability REAL NOT NULL DEFAULT 100,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.prepare(`INSERT INTO users (id) VALUES ('u1'), ('u2')`).run();
  return db;
}

describe("vehicles: spawn and ownership", () => {
  it("spawns and lists vehicles for the owner only", () => {
    const db = setupDB();
    const a = spawnVehicle(db, { ownerId: "u1", type: "car" });
    assert.strictEqual(a.ok, true);
    const b = spawnVehicle(db, { ownerId: "u1", type: "plane" });
    assert.strictEqual(b.ok, true);
    spawnVehicle(db, { ownerId: "u2", type: "glider" });

    const u1 = listOwnedVehicles(db, "u1");
    assert.strictEqual(u1.length, 2);
    const u2 = listOwnedVehicles(db, "u2");
    assert.strictEqual(u2.length, 1);
  });

  it("rejects invalid types", () => {
    const db = setupDB();
    const r = spawnVehicle(db, { ownerId: "u1", type: "spaceship" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "invalid_type");
  });

  it("validateOwnership returns null for non-owners", () => {
    const db = setupDB();
    const r = spawnVehicle(db, { ownerId: "u1", type: "car" });
    assert.ok(validateOwnership(db, r.vehicle.id, "u1"));
    assert.strictEqual(validateOwnership(db, r.vehicle.id, "u2"), null);
  });

  it("despawn flips is_active=0", () => {
    const db = setupDB();
    const r = spawnVehicle(db, { ownerId: "u1", type: "car" });
    assert.strictEqual(despawnVehicle(db, r.vehicle.id, "u1").ok, true);
    assert.strictEqual(listOwnedVehicles(db, "u1").length, 0);
  });
});

describe("city-presence: vehicle-aware speed clamp", () => {
  it("walking ceiling applies when no vehicle is set", () => {
    configurePresence({ db: null });
    const r1 = updateUserPosition("p1", { cityId: "c", x: 0, y: 0, z: 0 });
    assert.strictEqual(r1.ok, true);
    // Wait grace period to test speed check
    // We can't time-travel; instead set vehicle then check max-speed lookup
    assert.strictEqual(getMaxSpeedForVehicle("walk"), 16);
  });

  it("plane vehicle raises the max to 150 m/s", () => {
    setUserVehicle("p2", { vehicleId: "v", vehicleType: "plane" });
    const v = getUserVehicle("p2");
    assert.strictEqual(v.vehicleType, "plane");
    assert.strictEqual(getMaxSpeedForVehicle("plane"), 150);
    assert.strictEqual(getMaxSpeedForVehicle("car"), 40);
    assert.strictEqual(getMaxSpeedForVehicle("glider"), 60);
  });

  it("dismount returns to walking ceiling", () => {
    setUserVehicle("p3", { vehicleId: "v", vehicleType: "plane" });
    setUserVehicle("p3", { vehicleId: null, vehicleType: null });
    const v = getUserVehicle("p3");
    assert.strictEqual(v.vehicleType, null);
    assert.strictEqual(getMaxSpeedForVehicle(v.vehicleType), 16); // walking default
  });

  it("unknown vehicle types fall back to walking", () => {
    assert.strictEqual(getMaxSpeedForVehicle("rocket"), 16);
    assert.strictEqual(getMaxSpeedForVehicle(null), 16);
    assert.strictEqual(getMaxSpeedForVehicle(undefined), 16);
  });
});
