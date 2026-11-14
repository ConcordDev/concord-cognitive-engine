// Slice B7 — FIX-garage-001: vehicles gain a name + spec (migration
// 505), spawn carries them, and the owner can edit them through
// garage.update. Real in-memory DB (better-sqlite3) — desk batch
// checks / CI, on the garage-domain-macros harness shape.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerGarageMacros from "../domains/garage.js";
import { up as migrate505 } from "../migrations/505_world_vehicle_name_spec.js";
import { getVehicle } from "../lib/world-vehicles.js";

function collectMacros() {
  const map = new Map();
  registerGarageMacros((_domain, name, handler) => { map.set(name, handler); });
  return map;
}

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_vehicles (
      id            TEXT    PRIMARY KEY,
      world_id      TEXT    NOT NULL,
      kind          TEXT    NOT NULL CHECK (kind IN ('cart','boat','canal_taxi')),
      owner_kind    TEXT    NOT NULL CHECK (owner_kind IN ('player','realm','npc','none')),
      owner_id      TEXT    NOT NULL DEFAULT '',
      capacity      INTEGER NOT NULL DEFAULT 2 CHECK (capacity BETWEEN 1 AND 12),
      fare_cc       INTEGER NOT NULL DEFAULT 0 CHECK (fare_cc >= 0),
      route_id      TEXT,
      pos_x         REAL    NOT NULL DEFAULT 0,
      pos_y         REAL    NOT NULL DEFAULT 0,
      pos_z         REAL    NOT NULL DEFAULT 0,
      heading       REAL    NOT NULL DEFAULT 0,
      condition_pct INTEGER NOT NULL DEFAULT 100 CHECK (condition_pct BETWEEN 0 AND 100),
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE vehicle_occupants (
      vehicle_id TEXT NOT NULL, occupant_kind TEXT NOT NULL, occupant_id TEXT NOT NULL
    );
  `);
  return db;
}

describe("FIX-garage-001 — vehicle name/spec (real DB)", () => {
  let db, macros;
  const ctx = (userId) => ({ db, actor: { userId } });
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("migration 505 adds name + spec to a pre-existing table, idempotently", () => {
    migrate505(db);
    const cols = db.prepare(`PRAGMA table_info(world_vehicles)`).all().map((c) => c.name);
    assert.ok(cols.includes("name") && cols.includes("spec"));
    migrate505(db); // second run is a no-op, not an error
  });

  it("spawn stamps the name + spec; get and list read them back", async () => {
    migrate505(db);
    const spawned = await macros.get("spawn")(ctx("u1"), {
      worldId: "concordia-hub", kind: "cart", name: "Old Reliable", spec: "Oak bed, iron-rim wheels",
    });
    assert.equal(spawned.ok, true);
    assert.equal(spawned.name, "Old Reliable");
    const row = getVehicle(db, spawned.vehicleId);
    assert.equal(row.name, "Old Reliable");
    assert.equal(row.spec, "Oak bed, iron-rim wheels");
    const list = await macros.get("list")(ctx("u1"), { worldId: "concordia-hub" });
    assert.equal(list.vehicles[0].name, "Old Reliable");
  });

  it("the owner edits name/spec/capacity via garage.update; a stranger cannot", async () => {
    migrate505(db);
    const spawned = await macros.get("spawn")(ctx("u1"), { worldId: "concordia-hub", kind: "cart" });
    const id = spawned.vehicleId;
    const denied = await macros.get("update")(ctx("u2"), { vehicleId: id, name: "Not yours" });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "not_authorized");
    const upd = await macros.get("update")(ctx("u1"), { vehicleId: id, name: "Named at last", capacity: 4 });
    assert.equal(upd.ok, true);
    assert.equal(upd.vehicle.name, "Named at last");
    assert.equal(upd.vehicle.capacity, 4);
    assert.equal(getVehicle(db, id).name, "Named at last");
  });
});
