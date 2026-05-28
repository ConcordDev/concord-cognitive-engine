// Phase BA2 — house visit tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { claimHouse, placeFurniture, setVisibility, setAllowLiveVisits } from "../lib/player-housing.js";
import { requestVisit, captureSnapshot } from "../lib/house-visit.js";
import { up as upHouses } from "../migrations/232_player_houses.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE land_claims (id TEXT PRIMARY KEY, owner_user_id TEXT, world_id TEXT, anchor_x REAL, anchor_z REAL, radius_m REAL, bond_sparks REAL, maintenance_per_day REAL, claimed_at INTEGER, last_maintained_at INTEGER, status TEXT);
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, name TEXT, x REAL, y REAL, z REAL, width REAL, depth REAL, height REAL, material TEXT, owner_type TEXT, owner_id TEXT, state TEXT DEFAULT 'standing', health_pct REAL DEFAULT 1.0);
    CREATE TABLE building_rooms (id TEXT PRIMARY KEY, building_id TEXT, world_id TEXT, room_type TEXT, name TEXT, width REAL, depth REAL, height REAL, x_offset REAL, z_offset REAL, floor INTEGER, capacity INTEGER, owner_id TEXT, is_public INTEGER DEFAULT 1, furniture TEXT DEFAULT '[]', lock_tier INTEGER DEFAULT 0, lock_state TEXT DEFAULT 'open');
  `);
  upHouses(db);
  return db;
}

function seed(db, userId) {
  const claimId = `lc-${userId}`;
  db.prepare(`INSERT INTO land_claims VALUES (?, ?, 'tunya', 0, 0, 50, 50, 5, unixepoch(), unixepoch(), 'active')`)
    .run(claimId, userId);
  const buildingId = `b-${userId}`;
  db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, x, y, z, width, depth, height, material) VALUES (?, 'tunya', 'house', 5, 0, 5, 10, 10, 8, 'wood')`)
    .run(buildingId);
  const roomId = `r-${userId}`;
  db.prepare(`INSERT INTO building_rooms (id, building_id, world_id, room_type, name, width, depth, height, x_offset, z_offset, floor, capacity) VALUES (?, ?, 'tunya', 'bedroom', 'Bedroom', 5, 5, 3, 0, 0, 1, 2)`)
    .run(roomId, buildingId);
  return { claimId, buildingId, roomId };
}

describe("Phase BA2 — house visit", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("owner always gets live mode regardless of visibility", () => {
    const s = seed(db, "u1");
    const { houseId } = claimHouse(db, "u1", { landClaimId: s.claimId, buildingId: s.buildingId });
    setVisibility(db, "u1", houseId, "private");
    const v = requestVisit(db, "u1", houseId);
    assert.equal(v.ok, true);
    assert.equal(v.mode, "live");
    assert.equal(v.payload.owner, true);
  });

  it("private rejects all non-owner visits", () => {
    const s = seed(db, "u1");
    const { houseId } = claimHouse(db, "u1", { landClaimId: s.claimId, buildingId: s.buildingId });
    setVisibility(db, "u1", houseId, "private");
    const v = requestVisit(db, "stranger", houseId);
    assert.equal(v.ok, false);
    assert.equal(v.error, "private");
  });

  it("friends-only requires isFriend opt", () => {
    const s = seed(db, "u1");
    const { houseId } = claimHouse(db, "u1", { landClaimId: s.claimId, buildingId: s.buildingId });
    setVisibility(db, "u1", houseId, "friends");
    assert.equal(requestVisit(db, "stranger", houseId, { isFriend: false }).ok, false);
    assert.equal(requestVisit(db, "friend", houseId, { isFriend: true }).ok, true);
  });

  it("public + allow_live_visits=true returns live mode", () => {
    const s = seed(db, "u1");
    const { houseId } = claimHouse(db, "u1", { landClaimId: s.claimId, buildingId: s.buildingId });
    setVisibility(db, "u1", houseId, "public");
    setAllowLiveVisits(db, "u1", houseId, true);
    const v = requestVisit(db, "tourist", houseId);
    assert.equal(v.ok, true);
    assert.equal(v.mode, "live");
    assert.equal(v.payload.roomName, `house:${houseId}`);
  });

  it("public + allow_live_visits=false returns snapshot mode with cached blob", () => {
    const s = seed(db, "u1");
    const { houseId } = claimHouse(db, "u1", { landClaimId: s.claimId, buildingId: s.buildingId });
    placeFurniture(db, "u1", houseId, s.roomId, { itemId: "bed-1", x: 1, y: 0, z: 1, rot: 0 });
    setVisibility(db, "u1", houseId, "public");
    setAllowLiveVisits(db, "u1", houseId, false);
    captureSnapshot(db, houseId);

    const v = requestVisit(db, "tourist", houseId);
    assert.equal(v.ok, true);
    assert.equal(v.mode, "snapshot");
    assert.equal(v.payload.rooms.length, 1);
    assert.equal(v.payload.rooms[0].furniture.length, 1);
    assert.equal(v.payload.rooms[0].furniture[0].itemId, "bed-1");
  });

  it("captureSnapshot folds in building state + lock tiers", () => {
    const s = seed(db, "u1");
    const { houseId } = claimHouse(db, "u1", { landClaimId: s.claimId, buildingId: s.buildingId });
    // Simulate combat damage on the building.
    db.prepare(`UPDATE world_buildings SET health_pct = 0.5, state = 'damaged' WHERE id = ?`)
      .run(s.buildingId);
    db.prepare(`UPDATE building_rooms SET lock_tier = 3, lock_state = 'locked' WHERE id = ?`)
      .run(s.roomId);

    const r = captureSnapshot(db, houseId);
    assert.equal(r.ok, true);
    assert.equal(r.snapshot.building.health_pct, 0.5);
    assert.equal(r.snapshot.building.state, "damaged");
    assert.equal(r.snapshot.rooms[0].lockTier, 3);
    assert.equal(r.snapshot.rooms[0].lockState, "locked");
  });

  it("live visit emits house:visitor-arrived through io.to(room)", () => {
    const s = seed(db, "u1");
    const { houseId } = claimHouse(db, "u1", { landClaimId: s.claimId, buildingId: s.buildingId });
    setVisibility(db, "u1", houseId, "public");
    setAllowLiveVisits(db, "u1", houseId, true);

    const emits = [];
    const fakeIo = { to: (room) => ({ emit: (name, payload) => emits.push({ room, name, payload }) }) };
    requestVisit(db, "tourist", houseId, { io: fakeIo });
    assert.equal(emits.length, 1);
    assert.equal(emits[0].room, `house:${houseId}`);
    assert.equal(emits[0].name, "house:visitor-arrived");
    assert.equal(emits[0].payload.visitorId, "tourist");
  });
});
