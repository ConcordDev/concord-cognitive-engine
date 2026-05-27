// Contract test for the vehicle-tuning Phase II Wave 15 substrate.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  registerPart,
  installPart,
  uninstallPart,
  listInstalledParts,
  computeVehicleStats,
  setPaint,
  addDecal,
  removeDecal,
  baseStatsForKind,
} from "../lib/vehicle-tuning-engine.js";
import registerVehicleTuningMacros from "../domains/vehicle-tuning.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`vehicle_tuning.${name}`);
  assert.ok(fn, `vehicle_tuning.${name} not registered`);
  return fn(ctx, input);
}

let db;

before(() => { registerVehicleTuningMacros(register); });

beforeEach(() => {
  db = new Database(":memory:");
  // Minimal world_vehicles schema with the wave-15 extensions
  db.exec(`
    CREATE TABLE world_vehicles (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL DEFAULT '',
      capacity INTEGER NOT NULL DEFAULT 2,
      fare_cc INTEGER NOT NULL DEFAULT 0,
      route_id TEXT,
      pos_x REAL NOT NULL DEFAULT 0,
      pos_y REAL NOT NULL DEFAULT 0,
      pos_z REAL NOT NULL DEFAULT 0,
      heading REAL NOT NULL DEFAULT 0,
      condition_pct INTEGER NOT NULL DEFAULT 100,
      tuning_json TEXT NOT NULL DEFAULT '{}',
      paint_color TEXT NOT NULL DEFAULT '#888888',
      decal_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE vehicle_parts_catalog (
      id TEXT PRIMARY KEY,
      author_user_id TEXT NOT NULL,
      vehicle_kind TEXT NOT NULL,
      slot TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      manifest_json TEXT NOT NULL DEFAULT '{}',
      dtu_id TEXT,
      listed_cents INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE vehicle_installations (
      vehicle_id TEXT NOT NULL,
      slot TEXT NOT NULL,
      part_id TEXT NOT NULL,
      installed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (vehicle_id, slot)
    );
  `);
  // Seed a player-owned car for tests
  db.prepare(`
    INSERT INTO world_vehicles (id, world_id, kind, owner_kind, owner_id)
    VALUES ('v_car_1', 'w1', 'car', 'player', 'user_alice')
  `).run();
});

const ctxAlice = () => ({ actor: { userId: "user_alice" }, userId: "user_alice", db });
const ctxBob   = () => ({ actor: { userId: "user_bob" },   userId: "user_bob",   db });

describe("vehicle-tuning engine (lib)", () => {
  it("baseStatsForKind returns stats for each vehicle kind", () => {
    for (const k of ["cart", "boat", "canal_taxi", "car", "motorcycle", "hovercraft", "spaceship"]) {
      const s = baseStatsForKind(k);
      assert.ok(s, `${k} should have base stats`);
      assert.ok(s.mass_kg > 0);
    }
  });

  it("registerPart inserts a row", () => {
    const r = registerPart(db, {
      authorUserId: "user_alice",
      vehicleKind: "car", slot: "engine",
      name: "Twin-turbo V6",
      manifest: { hp_delta: 80, top_speed_delta_mps: 12, mass_delta_kg: 20 },
    });
    assert.equal(r.created, true);
    const row = db.prepare("SELECT * FROM vehicle_parts_catalog WHERE id = ?").get(r.id);
    assert.equal(row.author_user_id, "user_alice");
    assert.equal(row.slot, "engine");
    assert.equal(JSON.parse(row.manifest_json).hp_delta, 80);
  });

  it("rejects invalid vehicleKind or slot", () => {
    assert.throws(() => registerPart(db, { authorUserId: "u", vehicleKind: "spaceshuttle", slot: "engine", name: "x" }));
    assert.throws(() => registerPart(db, { authorUserId: "u", vehicleKind: "car", slot: "rocketboost", name: "x" }));
  });

  it("install + uninstall + list", () => {
    const part = registerPart(db, {
      authorUserId: "user_alice", vehicleKind: "car", slot: "engine",
      name: "Stock V6", manifest: { hp_delta: 0 },
    });
    const ins = installPart(db, "v_car_1", part.id, "user_alice");
    assert.equal(ins.ok, true);
    const list = listInstalledParts(db, "v_car_1");
    assert.equal(list.length, 1);
    assert.equal(list[0].slot, "engine");
    const un = uninstallPart(db, "v_car_1", "engine", "user_alice");
    assert.equal(un.ok, true);
    assert.equal(listInstalledParts(db, "v_car_1").length, 0);
  });

  it("install is idempotent for same slot+part", () => {
    const part = registerPart(db, {
      authorUserId: "user_alice", vehicleKind: "car", slot: "engine",
      name: "p", manifest: {},
    });
    installPart(db, "v_car_1", part.id, "user_alice");
    const second = installPart(db, "v_car_1", part.id, "user_alice");
    assert.equal(second.alreadyInstalled, true);
  });

  it("install rejects when actor is not vehicle owner", () => {
    const part = registerPart(db, {
      authorUserId: "user_alice", vehicleKind: "car", slot: "engine",
      name: "p", manifest: {},
    });
    const r = installPart(db, "v_car_1", part.id, "user_bob");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_vehicle_owner");
  });

  it("install rejects when part kind mismatches vehicle kind", () => {
    const boatPart = registerPart(db, {
      authorUserId: "user_alice", vehicleKind: "boat", slot: "engine",
      name: "Sail", manifest: {},
    });
    const r = installPart(db, "v_car_1", boatPart.id, "user_alice");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "part_kind_mismatch");
  });

  it("computeVehicleStats sums installed-part deltas", () => {
    const engine = registerPart(db, {
      authorUserId: "user_alice", vehicleKind: "car", slot: "engine",
      name: "Turbo", manifest: { hp_delta: 100, top_speed_delta_mps: 20, mass_delta_kg: 30 },
    });
    const tires = registerPart(db, {
      authorUserId: "user_alice", vehicleKind: "car", slot: "tires",
      name: "Slicks", manifest: { drag_delta: -0.04, top_speed_delta_mps: 5 },
    });
    installPart(db, "v_car_1", engine.id, "user_alice");
    installPart(db, "v_car_1", tires.id,  "user_alice");
    const stats = computeVehicleStats(db, "v_car_1");
    assert.equal(stats.base.hp, 180);
    assert.equal(stats.effective.hp, 280);
    assert.equal(stats.effective.top_speed, 55 + 20 + 5);
    assert.equal(stats.effective.mass_kg, 1400 + 30);
    assert.ok(stats.effective.drag < stats.base.drag);
  });

  it("setPaint applies and validates hex", () => {
    const ok = setPaint(db, "v_car_1", "#ff8800", "user_alice");
    assert.equal(ok.ok, true);
    const bad = setPaint(db, "v_car_1", "tomato", "user_alice");
    assert.equal(bad.ok, false);
  });

  it("addDecal + removeDecal manage the decal layer", () => {
    const a = addDecal(db, "v_car_1", { kind: "label", text: "fastest", x: 10, y: 20 }, "user_alice");
    assert.equal(a.ok, true);
    const removed = removeDecal(db, "v_car_1", a.decal.id, "user_alice");
    assert.equal(removed.ok, true);
  });
});

describe("vehicle-tuning macros (domain)", () => {
  it("rejects anon callers", async () => {
    const r = await call("create_part", { db, actor: { userId: null }, userId: null }, {
      vehicleKind: "car", slot: "engine", name: "p", manifest: {},
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_user");
  });

  it("rejects no_db", async () => {
    const r = await call("create_part", { actor: { userId: "u" }, userId: "u" }, {
      vehicleKind: "car", slot: "engine", name: "p", manifest: {},
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("create_part → list_catalog → install → vehicle_stats", async () => {
    const create = await call("create_part", ctxAlice(), {
      vehicleKind: "car", slot: "engine", name: "Big block V8",
      manifest: { hp_delta: 150, top_speed_delta_mps: 25 },
      visibility: "public",
    });
    assert.equal(create.created, true);

    const list = await call("list_catalog", ctxBob(), { vehicleKind: "car", slot: "engine" });
    assert.equal(list.ok, true);
    assert.equal(list.parts.length, 1);

    const inst = await call("install", ctxAlice(), { vehicleId: "v_car_1", partId: create.id });
    assert.equal(inst.ok, true);

    const stats = await call("vehicle_stats", ctxAlice(), { vehicleId: "v_car_1" });
    assert.equal(stats.ok, true);
    assert.equal(stats.effective.hp, 180 + 150);
  });

  it("paint + decal macros validate ownership", async () => {
    const paint = await call("set_paint", ctxBob(), { vehicleId: "v_car_1", paintColor: "#000000" });
    assert.equal(paint.ok, false);

    const ok = await call("set_paint", ctxAlice(), { vehicleId: "v_car_1", paintColor: "#88ccff" });
    assert.equal(ok.ok, true);

    const decal = await call("add_decal", ctxAlice(), {
      vehicleId: "v_car_1",
      decal: { kind: "label", text: "Concord", x: 50, y: 20, color: "#ff00ff" },
    });
    assert.equal(decal.ok, true);
    assert.ok(decal.decal.id);
  });

  it("base_stats returns the per-kind table", async () => {
    const r = await call("base_stats", ctxAlice(), { kind: "spaceship" });
    assert.equal(r.ok, true);
    assert.ok(r.baseStats.mass_kg > 1000);
  });
});
