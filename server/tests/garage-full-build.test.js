// Garage full build (queue takeover, F-F remainder #2) — the one
// verified remainder of R4's compilation against the rebuilt lens:
// F3's three-forms disagreement survived on exactly one surface.
// `mine` and the inspector (`get`) stamp the caller's own vehicles
// with the account's resolved display identity; `list` (the World
// table) stamped nothing, so an own vehicle read there rendered as
// the bare owner_kind. These pins hold the list macro to the same
// rendering — for the owner's own rows only, with the privacy
// projection (no owner_id, no display identity) intact for everyone
// else's.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerGarageMacros from "../domains/garage.js";

function collectMacros() {
  const map = new Map();
  registerGarageMacros((_domain, name, handler) => { map.set(name, handler); });
  return map;
}

// world_vehicles + vehicle_occupants at their post-migration shape
// (mig 177), mirroring garage-domain-macros.test.js's inline schema so
// this suite does not depend on the full migration chain.
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
  return userId ? { db, actor: { userId } } : { db };
}

describe("garage full build — F3 completion: the World list renders one owner identity", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("the caller's own rows in list carry the SAME ownerDisplay as mine and get", async () => {
    const owner = "fleet-owner-9f2c";
    const spawned = await macros.get("spawn")(ctxFor(db, owner), { worldId: "concordia-hub", kind: "cart" });
    assert.equal(spawned.ok, true);
    await macros.get("spawn")(ctxFor(db, "someone-else-77"), { worldId: "concordia-hub", kind: "cart" });

    const list = await macros.get("list")(ctxFor(db, owner), { worldId: "concordia-hub" });
    assert.equal(list.ok, true);
    assert.equal(list.vehicles.length, 2);
    const ownRow = list.vehicles.find((v) => v.id === spawned.vehicleId);
    const otherRow = list.vehicles.find((v) => v.id !== spawned.vehicleId);
    assert.equal(ownRow.isMine, true);
    assert.ok(typeof ownRow.ownerDisplay === "string" && ownRow.ownerDisplay.length > 0);
    // Other players' rows keep the privacy projection: no identity at all.
    assert.equal(otherRow.isMine, undefined);
    assert.equal(otherRow.ownerDisplay, undefined);
    assert.equal(otherRow.owner_id, undefined);

    const mine = await macros.get("mine")(ctxFor(db, owner), { worldId: "concordia-hub" });
    assert.equal(mine.vehicles[0].ownerDisplay, ownRow.ownerDisplay, "list and mine render one identity");
    const got = await macros.get("get")(ctxFor(db, owner), { vehicleId: spawned.vehicleId });
    assert.equal(got.vehicle.ownerDisplay, ownRow.ownerDisplay, "list and the inspector render one identity");
  });

  it("a stranger's list view stamps nothing and leaks no owner_id", async () => {
    const spawned = await macros.get("spawn")(ctxFor(db, "fleet-owner-9f2c"), { worldId: "concordia-hub", kind: "boat" });
    const list = await macros.get("list")(ctxFor(db, "complete-stranger"), { worldId: "concordia-hub" });
    const row = list.vehicles.find((v) => v.id === spawned.vehicleId);
    assert.equal(row.isMine, undefined);
    assert.equal(row.ownerDisplay, undefined);
    assert.equal(row.owner_id, undefined);
  });

  it("an anonymous list view (no actor) returns the plain projection", async () => {
    await macros.get("spawn")(ctxFor(db, "fleet-owner-9f2c"), { worldId: "concordia-hub", kind: "cart" });
    const list = await macros.get("list")(ctxFor(db, null), { worldId: "concordia-hub" });
    assert.equal(list.ok, true);
    assert.equal(list.vehicles.length, 1);
    assert.equal(list.vehicles[0].ownerDisplay, undefined);
    assert.equal(list.vehicles[0].isMine, undefined);
  });

  it("stamping respects the kind filter (only the filtered own rows stamp)", async () => {
    const owner = "fleet-owner-9f2c";
    const cart = await macros.get("spawn")(ctxFor(db, owner), { worldId: "concordia-hub", kind: "cart" });
    const boat = await macros.get("spawn")(ctxFor(db, owner), { worldId: "concordia-hub", kind: "boat" });
    const boats = await macros.get("list")(ctxFor(db, owner), { worldId: "concordia-hub", kind: "boat" });
    assert.equal(boats.vehicles.length, 1);
    assert.equal(boats.vehicles[0].id, boat.vehicleId);
    assert.equal(boats.vehicles[0].isMine, true);
    assert.ok(boats.vehicles[0].ownerDisplay);
    assert.ok(cart.vehicleId !== boat.vehicleId);
  });
});
