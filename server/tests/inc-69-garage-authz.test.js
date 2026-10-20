// INC-69 — garage get must not leak owner_id to other players, members cannot
// stamp a caller-chosen owner, and only the owner can despawn.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerGarageMacros from "../domains/garage.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "garage");
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`garage.${name} not registered`);
  // garage handlers are the canonical (ctx, input) shape, not the 3-arg lens shim.
  return fn(ctx, input);
}
before(() => registerGarageMacros(register));

function freshDb() {
  const db = new Database(":memory:");
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
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE vehicle_occupants (
      vehicle_id TEXT NOT NULL,
      occupant_kind TEXT NOT NULL,
      occupant_id TEXT NOT NULL,
      seat INTEGER NOT NULL DEFAULT 0,
      boarded_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (vehicle_id, occupant_kind, occupant_id)
    );
  `);
  return db;
}

const A = { actor: { userId: "user_a" }, userId: "user_a" };
const B = { actor: { userId: "user_b" }, userId: "user_b" };

describe("INC-69 garage ownership", () => {
  let db;
  beforeEach(() => { db = freshDb(); A.db = db; B.db = db; });

  it("A spawns; B's get hides A's id and isMine is false; A's get isMine", async () => {
    const spawned = await call("spawn", A, { worldId: "concordia-hub", kind: "cart" });
    assert.equal(spawned.ok, true);
    const id = spawned.vehicleId;

    const asB = await call("get", B, { vehicleId: id });
    assert.equal(asB.ok, true);
    assert.equal(asB.vehicle.isMine, false);
    assert.equal(Object.hasOwn(asB.vehicle, "owner_id"), false);
    assert.equal(JSON.stringify(asB).includes("user_a"), false);

    const asA = await call("get", A, { vehicleId: id });
    assert.equal(asA.ok, true);
    assert.equal(asA.vehicle.isMine, true);
    assert.equal(asA.vehicle.owner_id, "user_a");
  });

  it("a member spawning {ownerKind:npc, ownerId:x} gets a player-owned vehicle", async () => {
    const spawned = await call("spawn", B, {
      worldId: "concordia-hub", kind: "boat", ownerKind: "npc", ownerId: "x",
    });
    assert.equal(spawned.ok, true);
    const row = db.prepare("SELECT owner_kind, owner_id FROM world_vehicles WHERE id = ?").get(spawned.vehicleId);
    assert.equal(row.owner_kind, "player");
    assert.equal(row.owner_id, "user_b");
    assert.notEqual(row.owner_id, "x");
  });

  it("A can despawn and B cannot", async () => {
    const spawned = await call("spawn", A, { worldId: "concordia-hub", kind: "cart" });
    const id = spawned.vehicleId;
    const denied = await call("despawn", B, { vehicleId: id });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "not_authorized");
    assert.ok(db.prepare("SELECT id FROM world_vehicles WHERE id = ?").get(id));

    const gone = await call("despawn", A, { vehicleId: id });
    assert.equal(gone.ok, true);
    assert.equal(gone.action, "despawned");
    assert.equal(db.prepare("SELECT id FROM world_vehicles WHERE id = ?").get(id), undefined);
    const miss = await call("get", B, { vehicleId: id });
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, "vehicle_not_found");
  });
});
