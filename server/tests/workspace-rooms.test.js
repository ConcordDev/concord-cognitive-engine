// server/tests/workspace-rooms.test.js
//
// V1.2 Wave A — shared DTU spaces: discovery metadata for MU2's Shared
// Workspace Room. These tests cover the lib functions directly against a
// real in-memory better-sqlite3 DB (mirroring tests/ambient-chat.test.js's
// pattern) AND the three macros end-to-end through a minimal `register`
// harness (mirroring how server.js's real `register(domain, name, fn)`
// is consumed, without booting the whole server).
//
// Run: node --test server/tests/workspace-rooms.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upWorkspaceRooms } from "../migrations/377_workspace_rooms.js";
import { createRoom, getRoom, listInDistrict, listMine } from "../lib/workspace-rooms.js";
import registerWorkspaceRoomMacros from "../domains/workspace-rooms.js";

function freshDb() {
  const db = new Database(":memory:");
  upWorkspaceRooms(db);
  return db;
}

/** Minimal macro-registry harness mirroring server.js's real `register`. */
function makeRegistry() {
  const macros = new Map();
  function register(domain, name, fn) {
    if (!macros.has(domain)) macros.set(domain, new Map());
    macros.get(domain).set(name, fn);
  }
  function call(domain, name, ctx, input) {
    const fn = macros.get(domain)?.get(name);
    if (!fn) throw new Error(`macro not registered: ${domain}.${name}`);
    return fn(ctx, input);
  }
  return { register, call };
}

describe("V1.2 Wave A — workspace-rooms lib (direct, real in-memory DB)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("migration applies cleanly to a fresh DB and creates the table + indexes", () => {
    const tbl = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_rooms'`).get();
    assert.ok(tbl, "workspace_rooms table exists");
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_workspace_rooms_%'`).all();
    assert.equal(idx.length, 2);
  });

  it("migration is idempotent — re-running up() is a no-op", () => {
    createRoom(db, { ownerId: "u1", worldId: "concordia-hub", name: "Q3 planning" });
    upWorkspaceRooms(db); // second run
    const rows = db.prepare("SELECT COUNT(*) n FROM workspace_rooms").get();
    assert.equal(rows.n, 1, "row preserved across a re-applied migration");
  });

  it("createRoom mints a fresh id + persists owner/world/district/name", () => {
    const r = createRoom(db, { ownerId: "u1", worldId: "concordia-hub", districtId: "plaza", name: "  Roadmap sync  " });
    assert.equal(r.ok, true);
    assert.match(r.room.id, /^wr_[0-9a-f]{16}$/);
    assert.equal(r.room.name, "Roadmap sync", "name is trimmed");
    assert.equal(r.room.owner_id, "u1");
    assert.equal(r.room.world_id, "concordia-hub");
    assert.equal(r.room.district_id, "plaza");
  });

  it("createRoom requires ownerId, worldId, and a non-empty name", () => {
    assert.equal(createRoom(db, { worldId: "w", name: "x" }).ok, false); // no owner
    assert.equal(createRoom(db, { ownerId: "u1", name: "x" }).ok, false); // no world
    assert.equal(createRoom(db, { ownerId: "u1", worldId: "w", name: "   " }).ok, false); // blank name
  });

  it("district anchor is optional — a room can be created with no district", () => {
    const r = createRoom(db, { ownerId: "u1", worldId: "concordia-hub", name: "No anchor" });
    assert.equal(r.ok, true);
    assert.equal(r.room.district_id, null);
  });

  it("getRoom round-trips a created room by id", () => {
    const created = createRoom(db, { ownerId: "u1", worldId: "w", name: "Findable" });
    const found = getRoom(db, created.room.id);
    assert.equal(found.id, created.room.id);
    assert.equal(found.name, "Findable");
  });

  it("listInDistrict scopes by (worldId, districtId) — mirrors ambient-chat's isolation", () => {
    createRoom(db, { ownerId: "u1", worldId: "tunya", districtId: "market", name: "A" });
    createRoom(db, { ownerId: "u2", worldId: "tunya", districtId: "docks", name: "B" });
    createRoom(db, { ownerId: "u3", worldId: "cyber", districtId: "market", name: "C" });

    const market = listInDistrict(db, "tunya", "market");
    assert.equal(market.length, 1);
    assert.equal(market[0].name, "A");

    const docks = listInDistrict(db, "tunya", "docks");
    assert.equal(docks.length, 1);
    assert.equal(docks[0].name, "B");

    const cyberMarket = listInDistrict(db, "cyber", "market");
    assert.equal(cyberMarket.length, 1);
    assert.equal(cyberMarket[0].name, "C");
  });

  it("listInDistrict orders newest first", () => {
    createRoom(db, { ownerId: "u1", worldId: "w", districtId: "d", name: "first" });
    db.prepare("UPDATE workspace_rooms SET created_at = created_at - 100 WHERE name = 'first'").run();
    createRoom(db, { ownerId: "u1", worldId: "w", districtId: "d", name: "second" });
    const list = listInDistrict(db, "w", "d");
    assert.equal(list[0].name, "second");
    assert.equal(list[1].name, "first");
  });

  it("listMine returns only rooms the given owner created", () => {
    createRoom(db, { ownerId: "alice", worldId: "w", name: "Alice's room" });
    createRoom(db, { ownerId: "bob", worldId: "w", name: "Bob's room" });
    const mine = listMine(db, "alice");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].name, "Alice's room");
  });

  it("rooms with no district anchor are absent from listInDistrict but present in listMine", () => {
    createRoom(db, { ownerId: "alice", worldId: "w", name: "Unanchored" });
    assert.equal(listInDistrict(db, "w", "anywhere").length, 0);
    assert.equal(listMine(db, "alice").length, 1);
  });
});

describe("V1.2 Wave A — workspace macros (create-room / list-in-district / list-mine)", () => {
  let db, registry, ctx;
  beforeEach(() => {
    db = freshDb();
    registry = makeRegistry();
    registerWorkspaceRoomMacros(registry.register);
    ctx = { db, actor: { userId: "user_alice" } };
  });

  it("create-room requires an authenticated actor", async () => {
    const r = await registry.call("workspace", "create-room", { db, actor: {} }, { worldId: "w", name: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_user");
  });

  it("create-room requires worldId", async () => {
    const r = await registry.call("workspace", "create-room", ctx, { name: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_world_id");
  });

  it("full round-trip: create -> appears in list-in-district -> appears in list-mine", async () => {
    const created = await registry.call("workspace", "create-room", ctx, {
      name: "Sprint planning",
      worldId: "concordia-hub",
      districtId: "plaza",
    });
    assert.equal(created.ok, true);
    assert.ok(created.room?.id);

    const inDistrict = await registry.call("workspace", "list-in-district", ctx, {
      worldId: "concordia-hub",
      districtId: "plaza",
    });
    assert.equal(inDistrict.ok, true);
    assert.equal(inDistrict.rooms.length, 1);
    assert.equal(inDistrict.rooms[0].id, created.room.id);
    assert.equal(inDistrict.rooms[0].name, "Sprint planning");

    const mine = await registry.call("workspace", "list-mine", ctx, {});
    assert.equal(mine.ok, true);
    assert.equal(mine.rooms.length, 1);
    assert.equal(mine.rooms[0].id, created.room.id);
  });

  it("list-in-district requires both worldId and districtId", async () => {
    const r = await registry.call("workspace", "list-in-district", ctx, { worldId: "w" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("list-mine defaults to ctx.actor.userId when no userId is passed", async () => {
    await registry.call("workspace", "create-room", ctx, { name: "Mine", worldId: "w" });
    const otherCtx = { db, actor: { userId: "user_bob" } };
    await registry.call("workspace", "create-room", otherCtx, { name: "Bob's", worldId: "w" });

    const mine = await registry.call("workspace", "list-mine", ctx, {});
    assert.equal(mine.rooms.length, 1);
    assert.equal(mine.rooms[0].name, "Mine");

    const bobs = await registry.call("workspace", "list-mine", ctx, { userId: "user_bob" });
    assert.equal(bobs.rooms.length, 1);
    assert.equal(bobs.rooms[0].name, "Bob's");
  });

  it("list-mine requires a resolvable user", async () => {
    const r = await registry.call("workspace", "list-mine", { db, actor: {} }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_user");
  });

  it("rooms created by different owners in the same district are all discoverable there", async () => {
    await registry.call("workspace", "create-room", { db, actor: { userId: "alice" } }, {
      name: "Alice room", worldId: "concordia-hub", districtId: "plaza",
    });
    await registry.call("workspace", "create-room", { db, actor: { userId: "bob" } }, {
      name: "Bob room", worldId: "concordia-hub", districtId: "plaza",
    });
    const list = await registry.call("workspace", "list-in-district", ctx, {
      worldId: "concordia-hub", districtId: "plaza",
    });
    assert.equal(list.rooms.length, 2);
  });
});
