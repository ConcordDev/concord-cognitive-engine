// Macro surface for the player-housing lens (server/domains/housing.js).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a REAL in-memory sqlite DB built from the production schema, and
// asserts the macro both delegates to the lib AND mutates / reads the
// database for real (computed values + round-trips, not just { ok:true }).
//
// Mirrors the register(domain, name, handler) collection pattern the server
// uses so we exercise the exact handlers without booting server.js. The
// schema below is a faithful subset of the real migrations:
//   - land_claims         (mig 135)
//   - world_buildings     (mig 063)
//   - building_rooms      (mig 064) + lock_tier/lock_state (mig 065)
//                                   + furniture_layout_json (mig 232)
//   - player_houses       (mig 232)

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerHousingMacros from "../domains/housing.js";
import { claimHouse } from "../lib/player-housing.js";

function collectMacros() {
  const map = new Map();
  registerHousingMacros((domain, name, handler) => {
    map.set(name, handler);
  });
  return map;
}

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE land_claims (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, world_id TEXT NOT NULL,
      anchor_x REAL NOT NULL, anchor_z REAL NOT NULL, radius_m REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE world_buildings (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, building_type TEXT NOT NULL DEFAULT 'house',
      name TEXT, x REAL NOT NULL, y REAL NOT NULL DEFAULT 0, z REAL NOT NULL,
      width REAL DEFAULT 10, depth REAL DEFAULT 10, height REAL DEFAULT 8,
      material TEXT DEFAULT 'stone', state TEXT DEFAULT 'standing', health_pct REAL DEFAULT 1.0,
      owner_type TEXT DEFAULT 'world', owner_id TEXT
    );
    CREATE TABLE building_rooms (
      id TEXT PRIMARY KEY, building_id TEXT NOT NULL, world_id TEXT NOT NULL,
      room_type TEXT NOT NULL DEFAULT 'generic', name TEXT,
      width REAL DEFAULT 6, depth REAL DEFAULT 6, height REAL DEFAULT 3,
      x_offset REAL DEFAULT 0, z_offset REAL DEFAULT 0, floor INTEGER DEFAULT 1,
      capacity INTEGER DEFAULT 4, is_public INTEGER DEFAULT 1,
      lock_tier INTEGER DEFAULT 0, lock_state TEXT DEFAULT 'open',
      furniture TEXT DEFAULT '[]', furniture_layout_json TEXT
    );
    CREATE TABLE player_houses (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL,
      land_claim_id TEXT NOT NULL, building_id TEXT NOT NULL, name TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      allow_live_visits INTEGER NOT NULL DEFAULT 0, snapshot_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_decorated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(land_claim_id, building_id)
    );
  `);
  return db;
}

/** Seed an owned, claimable house for `userId` and return its ids. */
function seedHouse(db, userId, { worldId = "tunya", visibility } = {}) {
  db.prepare(`INSERT INTO land_claims (id, owner_user_id, world_id, anchor_x, anchor_z, radius_m, status)
              VALUES ('lc1', ?, ?, 0, 0, 50, 'active')`).run(userId, worldId);
  db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, name, x, y, z)
              VALUES ('wb1', ?, 'house', 'Cottage', 5, 0, 5)`).run(worldId);
  db.prepare(`INSERT INTO building_rooms (id, building_id, world_id, room_type, name)
              VALUES ('room1', 'wb1', ?, 'living', 'Living Room')`).run(worldId);
  const claimed = claimHouse(db, userId, { landClaimId: "lc1", buildingId: "wb1", name: "Home" });
  if (visibility) {
    db.prepare(`UPDATE player_houses SET visibility = ? WHERE id = ?`).run(visibility, claimed.houseId);
  }
  return { houseId: claimed.houseId, roomId: "room1", worldId };
}

function ctxFor(db, userId) {
  return { db, actor: { userId } };
}

describe("housing domain macros", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("registers the full read + write surface", () => {
    for (const name of [
      "mine", "get", "public", "claim", "place_furniture", "remove_furniture",
      "set_visibility", "set_live_visits", "set_lock", "visit",
    ]) {
      assert.equal(typeof macros.get(name), "function", `missing macro: ${name}`);
    }
  });

  it("claim → mine → get round-trips through the DB", async () => {
    db.prepare(`INSERT INTO land_claims (id, owner_user_id, world_id, anchor_x, anchor_z, radius_m, status)
                VALUES ('lc1', 'alice', 'tunya', 0, 0, 50, 'active')`).run();
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, name, x, y, z)
                VALUES ('wb1', 'tunya', 'house', 'Cottage', 5, 0, 5)`).run();
    db.prepare(`INSERT INTO building_rooms (id, building_id, world_id, room_type, name)
                VALUES ('room1', 'wb1', 'tunya', 'living', 'Living Room')`).run();

    const claimed = await macros.get("claim")(ctxFor(db, "alice"), {
      landClaimId: "lc1", buildingId: "wb1", name: "Home",
    });
    assert.equal(claimed.ok, true);
    const houseId = claimed.houseId;
    // The claim flips building ownership to the player.
    assert.equal(db.prepare(`SELECT owner_id FROM world_buildings WHERE id='wb1'`).get().owner_id, "alice");

    const mine = await macros.get("mine")(ctxFor(db, "alice"), {});
    assert.equal(mine.ok, true);
    assert.equal(mine.houses.length, 1);
    assert.equal(mine.houses[0].id, houseId);
    assert.equal(mine.houses[0].name, "Home");

    const got = await macros.get("get")(ctxFor(db, "alice"), { houseId });
    assert.equal(got.ok, true);
    assert.equal(got.house.id, houseId);
    assert.equal(got.house.rooms.length, 1);
    assert.equal(got.house.rooms[0].id, "room1");
    assert.ok(Array.isArray(got.house.rooms[0].furniture_layout));
  });

  it("place_furniture writes into furniture_layout_json; get returns it; remove clears it", async () => {
    const { houseId, roomId } = seedHouse(db, "alice");

    const placed = await macros.get("place_furniture")(ctxFor(db, "alice"), {
      houseId, roomId, item: { itemId: "sofa", x: 1.5, y: 0, z: 2, rot: 90 },
    });
    assert.equal(placed.ok, true);
    assert.equal(placed.layoutSize, 1);

    // Persisted to the real column.
    const raw = db.prepare(`SELECT furniture_layout_json AS j FROM building_rooms WHERE id=?`).get(roomId).j;
    const layout = JSON.parse(raw);
    assert.equal(layout.length, 1);
    assert.equal(layout[0].itemId, "sofa");
    assert.equal(layout[0].x, 1.5);
    assert.equal(layout[0].rot, 90);

    // last_decorated_at bumped (snapshot-relevant).
    const dec = db.prepare(`SELECT last_decorated_at FROM player_houses WHERE id=?`).get(houseId).last_decorated_at;
    assert.ok(dec > 0);

    // get surfaces the parsed layout.
    const got = await macros.get("get")(ctxFor(db, "alice"), { houseId });
    assert.equal(got.house.rooms[0].furniture_layout.length, 1);
    assert.equal(got.house.rooms[0].furniture_layout[0].itemId, "sofa");

    // Re-place same itemId moves it (idempotent on itemId).
    await macros.get("place_furniture")(ctxFor(db, "alice"), {
      houseId, roomId, item: { itemId: "sofa", x: 9, y: 0, z: 9, rot: 0 },
    });
    const moved = JSON.parse(db.prepare(`SELECT furniture_layout_json AS j FROM building_rooms WHERE id=?`).get(roomId).j);
    assert.equal(moved.length, 1);
    assert.equal(moved[0].x, 9);

    // remove clears it.
    const removed = await macros.get("remove_furniture")(ctxFor(db, "alice"), { houseId, roomId, itemId: "sofa" });
    assert.equal(removed.ok, true);
    assert.equal(removed.removed, true);
    assert.equal(JSON.parse(db.prepare(`SELECT furniture_layout_json AS j FROM building_rooms WHERE id=?`).get(roomId).j).length, 0);
  });

  it("set_visibility round-trips and gates invalid values", async () => {
    const { houseId, worldId } = seedHouse(db, "alice");

    const vis = await macros.get("set_visibility")(ctxFor(db, "alice"), { houseId, visibility: "public" });
    assert.equal(vis.ok, true);
    assert.equal(db.prepare(`SELECT visibility FROM player_houses WHERE id=?`).get(houseId).visibility, "public");

    // public macro now lists it.
    const pub = await macros.get("public")(ctxFor(db, "bob"), { worldId });
    assert.equal(pub.ok, true);
    assert.equal(pub.houses.length, 1);
    assert.equal(pub.houses[0].id, houseId);

    const bad = await macros.get("set_visibility")(ctxFor(db, "alice"), { houseId, visibility: "secret" });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "invalid_visibility");
  });

  it("set_live_visits and set_lock round-trip through the real columns", async () => {
    const { houseId, roomId } = seedHouse(db, "alice");

    const live = await macros.get("set_live_visits")(ctxFor(db, "alice"), { houseId, allow: true });
    assert.equal(live.ok, true);
    assert.equal(db.prepare(`SELECT allow_live_visits FROM player_houses WHERE id=?`).get(houseId).allow_live_visits, 1);

    const lock = await macros.get("set_lock")(ctxFor(db, "alice"), { houseId, roomId, lockTier: 3 });
    assert.equal(lock.ok, true);
    assert.equal(lock.lockTier, 3);
    const room = db.prepare(`SELECT lock_tier, lock_state, is_public FROM building_rooms WHERE id=?`).get(roomId);
    assert.equal(room.lock_tier, 3);
    assert.equal(room.lock_state, "locked");
    assert.equal(room.is_public, 0);

    // lock tier is clamped 0..5.
    const clamped = await macros.get("set_lock")(ctxFor(db, "alice"), { houseId, roomId, lockTier: 99 });
    assert.equal(clamped.lockTier, 5);
  });

  it("write macros reject a non-owner (ownership enforced in the lib)", async () => {
    const { houseId, roomId } = seedHouse(db, "alice");
    const r = await macros.get("place_furniture")(ctxFor(db, "mallory"), {
      houseId, roomId, item: { itemId: "trap", x: 0, y: 0, z: 0, rot: 0 },
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_owner");
  });

  it("visit gates by visibility: private blocks a stranger, public allows snapshot/live", async () => {
    const priv = seedHouse(db, "alice", { visibility: "private" });
    const blocked = await macros.get("visit")(ctxFor(db, "bob"), { houseId: priv.houseId });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "private");

    // Owner always gets in.
    const owner = await macros.get("visit")(ctxFor(db, "alice"), { houseId: priv.houseId });
    assert.equal(owner.ok, true);

    // Public + live on → live mode.
    await macros.get("set_visibility")(ctxFor(db, "alice"), { houseId: priv.houseId, visibility: "public" });
    await macros.get("set_live_visits")(ctxFor(db, "alice"), { houseId: priv.houseId, allow: true });
    const visit = await macros.get("visit")(ctxFor(db, "bob"), { houseId: priv.houseId });
    assert.equal(visit.ok, true);
    assert.equal(visit.mode, "live");
  });

  it("read macros return ok:false (not a throw) when ctx has no db", async () => {
    assert.equal((await macros.get("mine")({}, {})).ok, false);
    assert.equal((await macros.get("mine")({}, {})).reason, "no_db");
    assert.equal((await macros.get("get")({}, { houseId: "x" })).reason, "no_db");
    assert.equal((await macros.get("public")({}, { worldId: "x" })).reason, "no_db");
  });

  it("macros validate missing inputs without throwing", async () => {
    assert.equal((await macros.get("get")(ctxFor(db, "u"), {})).reason, "missing_house_id");
    assert.equal((await macros.get("public")(ctxFor(db, "u"), {})).reason, "missing_world_id");
    assert.equal((await macros.get("mine")({ db }, {})).reason, "no_user");
    const place = await macros.get("place_furniture")(ctxFor(db, "u"), { houseId: "nope", roomId: "r", item: { itemId: "x" } });
    assert.equal(place.ok, false);
    assert.equal(place.error, "no_house");
  });
});
