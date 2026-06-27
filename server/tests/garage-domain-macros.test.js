// Macro surface for the vehicle garage (server/domains/garage.js).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a REAL in-memory sqlite DB, and asserts the macro both delegates to
// the lib AND produces real values (a spawned vehicle persists + lists back; get
// returns the real row; mount/dismount mutate occupancy), not just { ok:true }.
// Mirrors the register(domain, name, handler) collection pattern the server uses
// so we exercise the exact handlers without booting server.js.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerGarageMacros from "../domains/garage.js";
import { getVehicle, occupantCount } from "../lib/world-vehicles.js";

function collectMacros() {
  const map = new Map();
  registerGarageMacros((_domain, name, handler) => {
    map.set(name, handler);
  });
  return map;
}

// world_vehicles + vehicle_occupants at their post-migration shape (mig 177 —
// the columns lib/world-vehicles.js writes/reads). Built inline so the test
// doesn't depend on the full migration chain.
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
      vehicle_id    TEXT    NOT NULL,
      occupant_kind TEXT    NOT NULL CHECK (occupant_kind IN ('player','npc')),
      occupant_id   TEXT    NOT NULL,
      seat          INTEGER NOT NULL DEFAULT 0,
      boarded_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (vehicle_id, occupant_kind, occupant_id)
    );
  `);
  return db;
}

function ctxFor(db, userId) {
  return { db, actor: { userId } };
}

describe("garage domain macros", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("registers the full read + write surface", () => {
    for (const name of ["list", "mine", "get", "spawn", "create", "mount", "dismount", "move"]) {
      assert.equal(typeof macros.get(name), "function", `missing macro: ${name}`);
    }
  });

  it("spawn → persists a real row → list + get return the real values", async () => {
    const spawn = await macros.get("spawn")(ctxFor(db, "driver1"), {
      worldId: "concordia-hub", kind: "cart",
    });
    assert.equal(spawn.ok, true);
    assert.ok(typeof spawn.vehicleId === "string" && spawn.vehicleId.length > 0);
    assert.equal(spawn.kind, "cart");
    assert.equal(spawn.capacity, 4); // DEFAULT_CAPACITY.cart

    // It really persisted (read straight from the table via the lib).
    const row = getVehicle(db, spawn.vehicleId);
    assert.ok(row, "spawned vehicle must persist");
    assert.equal(row.world_id, "concordia-hub");
    assert.equal(row.owner_kind, "player");
    assert.equal(row.owner_id, "driver1"); // player spawn owned by the actor

    // list surfaces it with the real id.
    const list = await macros.get("list")(ctxFor(db, "driver1"), { worldId: "concordia-hub" });
    assert.equal(list.ok, true);
    assert.equal(list.vehicles.length, 1);
    assert.equal(list.vehicles[0].id, spawn.vehicleId);
    assert.equal(list.vehicles[0].kind, "cart");

    // get returns the full row + a live occupant count.
    const got = await macros.get("get")(ctxFor(db, "driver1"), { vehicleId: spawn.vehicleId });
    assert.equal(got.ok, true);
    assert.equal(got.vehicle.id, spawn.vehicleId);
    assert.equal(got.vehicle.capacity, 4);
    assert.equal(got.occupants, 0);
  });

  it("mine scopes to the calling player's owned fleet only", async () => {
    await macros.get("spawn")(ctxFor(db, "alice"), { worldId: "concordia-hub", kind: "cart" });
    await macros.get("spawn")(ctxFor(db, "alice"), { worldId: "concordia-hub", kind: "boat" });
    await macros.get("spawn")(ctxFor(db, "bob"), { worldId: "concordia-hub", kind: "cart" });

    const mineA = await macros.get("mine")(ctxFor(db, "alice"), { worldId: "concordia-hub" });
    assert.equal(mineA.ok, true);
    assert.equal(mineA.vehicles.length, 2, "alice owns exactly two");
    assert.ok(mineA.vehicles.every((v) => v.owner_id === "alice"));

    const mineB = await macros.get("mine")(ctxFor(db, "bob"), { worldId: "concordia-hub" });
    assert.equal(mineB.vehicles.length, 1);
    assert.equal(mineB.vehicles[0].owner_id, "bob");

    // But the world list sees all three.
    const all = await macros.get("list")(ctxFor(db, "alice"), { worldId: "concordia-hub" });
    assert.equal(all.vehicles.length, 3);

    // kind filter narrows the fleet.
    const mineCarts = await macros.get("mine")(ctxFor(db, "alice"), { worldId: "concordia-hub", kind: "cart" });
    assert.equal(mineCarts.vehicles.length, 1);
    assert.equal(mineCarts.vehicles[0].kind, "cart");
  });

  it("mount → dismount mutates real occupancy", async () => {
    const spawn = await macros.get("spawn")(ctxFor(db, "owner1"), { worldId: "concordia-hub", kind: "boat" });
    const id = spawn.vehicleId;

    const mounted = await macros.get("mount")(ctxFor(db, "rider1"), { vehicleId: id });
    assert.equal(mounted.ok, true);
    assert.equal(mounted.action, "mounted");
    assert.equal(occupantCount(db, id), 1);

    // get reflects the live occupant count.
    const got = await macros.get("get")(ctxFor(db, "rider1"), { vehicleId: id });
    assert.equal(got.occupants, 1);

    const dis = await macros.get("dismount")(ctxFor(db, "rider1"), { vehicleId: id });
    assert.equal(dis.ok, true);
    assert.equal(occupantCount(db, id), 0);
  });

  it("move is delta-bounded (rejects a teleport, accepts a small step)", async () => {
    const spawn = await macros.get("spawn")(ctxFor(db, "owner2"), { worldId: "concordia-hub", kind: "cart" });
    const id = spawn.vehicleId;

    // Teleport beyond MAX_POS_DELTA_M (50) is rejected.
    const far = await macros.get("move")(ctxFor(db, "owner2"), { vehicleId: id, pos_x: 999, pos_y: 0, pos_z: 0 });
    assert.equal(far.ok, false);
    assert.equal(far.reason, "delta_too_large");

    // A small owner-authorized step succeeds and persists.
    const near = await macros.get("move")(ctxFor(db, "owner2"), { vehicleId: id, pos_x: 5, pos_y: 0, pos_z: 3, heading: 1.5 });
    assert.equal(near.ok, true);
    const row = getVehicle(db, id);
    assert.equal(row.pos_x, 5);
    assert.equal(row.pos_z, 3);
    assert.equal(row.heading, 1.5);

    // A non-owner / non-occupant cannot move it.
    const intruder = await macros.get("move")(ctxFor(db, "stranger"), { vehicleId: id, pos_x: 6, pos_y: 0, pos_z: 3 });
    assert.equal(intruder.ok, false);
    assert.equal(intruder.reason, "not_authorized");
  });

  it("validates inputs cleanly — never throws on bad data", async () => {
    // bad kind rejected by the lib CHECK / guard.
    const badKind = await macros.get("spawn")(ctxFor(db, "u1"), { worldId: "concordia-hub", kind: "spaceship" });
    assert.equal(badKind.ok, false);
    assert.equal(badKind.reason, "bad_kind");

    // canal_taxi requires a route.
    const noRoute = await macros.get("spawn")(ctxFor(db, "u1"), { worldId: "concordia-hub", kind: "canal_taxi" });
    assert.equal(noRoute.ok, false);
    assert.equal(noRoute.reason, "canal_taxi_requires_route");

    // get miss is a clean envelope.
    const miss = await macros.get("get")(ctxFor(db, "u1"), { vehicleId: "veh_nope" });
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, "vehicle_not_found");

    // mine without an actor.
    const noUser = await macros.get("mine")({ db }, { worldId: "concordia-hub" });
    assert.equal(noUser.ok, false);
    assert.equal(noUser.reason, "no_user");
  });

  it("create artifact verb spawns through the same path as spawn", async () => {
    const out = await macros.get("create")(ctxFor(db, "maker"), { worldId: "concordia-hub", kind: "boat" });
    assert.equal(out.ok, true);
    assert.ok(getVehicle(db, out.vehicleId), "create must persist a real vehicle");
    const mine = await macros.get("mine")(ctxFor(db, "maker"), { worldId: "concordia-hub" });
    assert.equal(mine.vehicles.length, 1);
  });
});
