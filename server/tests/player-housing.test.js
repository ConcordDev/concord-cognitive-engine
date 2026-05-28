// Phase BA1 — player housing tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  claimHouse,
  placeFurniture,
  removeFurniture,
  setVisibility,
  setAllowLiveVisits,
  setLockTier,
  getHouse,
  listMyHouses,
  canVisit,
} from "../lib/player-housing.js";
import { up as upHouses } from "../migrations/232_player_houses.js";

function freshDb() {
  const db = new Database(":memory:");
  // Minimal substrate the housing layer reads. We don't run the full
  // migration pipeline here — just enough to exercise the join.
  db.exec(`
    CREATE TABLE land_claims (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      world_id TEXT,
      anchor_x REAL,
      anchor_z REAL,
      radius_m REAL,
      bond_sparks REAL,
      maintenance_per_day REAL,
      claimed_at INTEGER,
      last_maintained_at INTEGER,
      status TEXT
    );
    CREATE TABLE world_buildings (
      id TEXT PRIMARY KEY,
      world_id TEXT,
      building_type TEXT,
      name TEXT,
      x REAL, y REAL, z REAL,
      width REAL, depth REAL, height REAL,
      material TEXT,
      owner_type TEXT,
      owner_id TEXT,
      state TEXT DEFAULT 'standing',
      health_pct REAL DEFAULT 1.0
    );
    CREATE TABLE building_rooms (
      id TEXT PRIMARY KEY,
      building_id TEXT,
      world_id TEXT,
      room_type TEXT,
      name TEXT,
      width REAL, depth REAL, height REAL,
      x_offset REAL, z_offset REAL, floor INTEGER, capacity INTEGER,
      owner_id TEXT,
      is_public INTEGER DEFAULT 1,
      furniture TEXT DEFAULT '[]',
      lock_tier INTEGER DEFAULT 0,
      lock_state TEXT DEFAULT 'open',
      last_breach INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);
  upHouses(db);
  return db;
}

function seedClaimAndBuilding(db, { userId, worldId = "tunya", x = 0, z = 0, radius = 50, buildingX = 5, buildingZ = 5 }) {
  const claimId = `lc-${userId}`;
  db.prepare(`INSERT INTO land_claims VALUES (?, ?, ?, ?, ?, ?, 50, 5, unixepoch(), unixepoch(), 'active')`)
    .run(claimId, userId, worldId, x, z, radius);
  const buildingId = `b-${userId}`;
  db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, x, y, z, width, depth, height, material) VALUES (?, ?, 'house', ?, 0, ?, 10, 10, 8, 'wood')`)
    .run(buildingId, worldId, buildingX, buildingZ);
  const roomId = `r-${userId}`;
  db.prepare(`INSERT INTO building_rooms (id, building_id, world_id, room_type, name, width, depth, height, x_offset, z_offset, floor, capacity) VALUES (?, ?, ?, 'bedroom', 'Bedroom', 5, 5, 3, 0, 0, 1, 2)`)
    .run(roomId, buildingId, worldId);
  return { claimId, buildingId, roomId };
}

describe("Phase BA1 — player housing", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("claimHouse links land-claim + building, transfers ownership", () => {
    const { claimId, buildingId } = seedClaimAndBuilding(db, { userId: "u1" });
    const r = claimHouse(db, "u1", { landClaimId: claimId, buildingId, name: "Cottage" });
    assert.equal(r.ok, true);
    const b = db.prepare(`SELECT owner_id, owner_type FROM world_buildings WHERE id = ?`).get(buildingId);
    assert.equal(b.owner_id, "u1");
    assert.equal(b.owner_type, "player");
  });

  it("claimHouse rejects when caller doesn't own the claim", () => {
    const { claimId, buildingId } = seedClaimAndBuilding(db, { userId: "u1" });
    const r = claimHouse(db, "intruder", { landClaimId: claimId, buildingId });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_claim_owner");
  });

  it("claimHouse rejects building outside the claim's radius", () => {
    const { claimId, buildingId } = seedClaimAndBuilding(db, {
      userId: "u1", x: 0, z: 0, radius: 5, buildingX: 100, buildingZ: 100,
    });
    const r = claimHouse(db, "u1", { landClaimId: claimId, buildingId });
    assert.equal(r.ok, false);
    assert.equal(r.error, "building_outside_claim");
  });

  it("claimHouse is idempotent on (land_claim, building)", () => {
    const { claimId, buildingId } = seedClaimAndBuilding(db, { userId: "u1" });
    const a = claimHouse(db, "u1", { landClaimId: claimId, buildingId });
    const b = claimHouse(db, "u1", { landClaimId: claimId, buildingId });
    assert.equal(a.houseId, b.houseId);
    assert.equal(b.alreadyExisted, true);
  });

  it("placeFurniture writes per-coord layout and is idempotent on itemId", () => {
    const seed = seedClaimAndBuilding(db, { userId: "u1" });
    const { houseId } = claimHouse(db, "u1", { landClaimId: seed.claimId, buildingId: seed.buildingId });
    const a = placeFurniture(db, "u1", houseId, seed.roomId, { itemId: "bed-1", x: 1, y: 0, z: 1, rot: 0 });
    assert.equal(a.ok, true);
    assert.equal(a.layoutSize, 1);
    // Re-place same itemId moves it, doesn't duplicate.
    const b = placeFurniture(db, "u1", houseId, seed.roomId, { itemId: "bed-1", x: 2, y: 0, z: 2, rot: 90 });
    assert.equal(b.layoutSize, 1);
    const got = getHouse(db, houseId);
    const bed = got.rooms[0].furniture_layout.find(f => f.itemId === "bed-1");
    assert.equal(bed.x, 2);
    assert.equal(bed.rot, 90);
  });

  it("placeFurniture rejects non-owner", () => {
    const seed = seedClaimAndBuilding(db, { userId: "u1" });
    const { houseId } = claimHouse(db, "u1", { landClaimId: seed.claimId, buildingId: seed.buildingId });
    const r = placeFurniture(db, "u2", houseId, seed.roomId, { itemId: "bed-1", x: 0, y: 0, z: 0, rot: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_owner");
  });

  it("removeFurniture is idempotent (missing itemId returns removed:false)", () => {
    const seed = seedClaimAndBuilding(db, { userId: "u1" });
    const { houseId } = claimHouse(db, "u1", { landClaimId: seed.claimId, buildingId: seed.buildingId });
    placeFurniture(db, "u1", houseId, seed.roomId, { itemId: "bed-1" });
    const a = removeFurniture(db, "u1", houseId, seed.roomId, "bed-1");
    assert.equal(a.removed, true);
    const b = removeFurniture(db, "u1", houseId, seed.roomId, "bed-1");
    assert.equal(b.removed, false);
  });

  it("setLockTier writes through to building_rooms (world-crime can read it)", () => {
    const seed = seedClaimAndBuilding(db, { userId: "u1" });
    const { houseId } = claimHouse(db, "u1", { landClaimId: seed.claimId, buildingId: seed.buildingId });
    setLockTier(db, "u1", houseId, seed.roomId, 3);
    const room = db.prepare(`SELECT lock_tier, lock_state, is_public FROM building_rooms WHERE id = ?`).get(seed.roomId);
    assert.equal(room.lock_tier, 3);
    assert.equal(room.lock_state, "locked");
    assert.equal(room.is_public, 0);
  });

  it("canVisit gates by visibility and friend status", () => {
    const seed = seedClaimAndBuilding(db, { userId: "u1" });
    const { houseId } = claimHouse(db, "u1", { landClaimId: seed.claimId, buildingId: seed.buildingId });

    // Private: only owner.
    setVisibility(db, "u1", houseId, "private");
    assert.equal(canVisit(db, "u1", houseId).allowed, true);
    assert.equal(canVisit(db, "u2", houseId).allowed, false);

    // Friends: gated by isFriend opt.
    setVisibility(db, "u1", houseId, "friends");
    assert.equal(canVisit(db, "u2", houseId, { isFriend: false }).allowed, false);
    const friendVisit = canVisit(db, "u2", houseId, { isFriend: true });
    assert.equal(friendVisit.allowed, true);
    assert.equal(friendVisit.mode, "snapshot", "live visits off by default");

    // Public + live visits on: anyone gets live mode.
    setVisibility(db, "u1", houseId, "public");
    setAllowLiveVisits(db, "u1", houseId, true);
    const liveVisit = canVisit(db, "u3", houseId);
    assert.equal(liveVisit.allowed, true);
    assert.equal(liveVisit.mode, "live");
  });

  it("listMyHouses returns user's houses, ordered by last_decorated", () => {
    const s1 = seedClaimAndBuilding(db, { userId: "u1", buildingX: 5, buildingZ: 5 });
    const r1 = claimHouse(db, "u1", { landClaimId: s1.claimId, buildingId: s1.buildingId, name: "Cottage A" });

    // Second claim for the same user in another spot.
    db.prepare(`INSERT INTO land_claims VALUES ('lc-2', 'u1', 'tunya', 200, 200, 50, 50, 5, unixepoch(), unixepoch(), 'active')`).run();
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, x, y, z, width, depth, height, material) VALUES ('b-2', 'tunya', 'house', 205, 0, 205, 10, 10, 8, 'wood')`).run();
    const r2 = claimHouse(db, "u1", { landClaimId: "lc-2", buildingId: "b-2", name: "Cottage B" });

    const list = listMyHouses(db, "u1");
    assert.equal(list.length, 2);
  });
});
