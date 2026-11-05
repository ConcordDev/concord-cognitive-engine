// Housing full build (GB-1089 pair) — the lifecycle seam Review 3's
// first pass found PROBE-BLOCKED: the lens could convert a building on
// claimed land, but no web surface could create the claim. The claim
// machinery (lib/land-claims.js) and its macro domain always existed;
// the build wires claim creation into the lens (MineHousesPanel calls
// land_claims.claim). These tests pin the seam at the macro layer the
// panel actually uses: land_claims.claim -> land_claims.list_for_user
// -> housing.claim -> housing.mine, plus the overlap refusal the form
// surfaces.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerLandClaimsMacros from "../domains/land-claims.js";
import registerHousingMacros from "../domains/housing.js";

function collectMacros() {
  const map = new Map();
  const register = (domain, name, handler) => map.set(`${domain}.${name}`, handler);
  registerLandClaimsMacros(register);
  registerHousingMacros(register);
  return map;
}

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE land_claims (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, world_id TEXT NOT NULL,
      anchor_x REAL NOT NULL, anchor_z REAL NOT NULL, radius_m REAL NOT NULL,
      bond_sparks REAL, maintenance_per_day REAL,
      claimed_at INTEGER, last_maintained_at INTEGER,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE land_claim_invites (
      claim_id TEXT, user_id TEXT, role TEXT
    );
    CREATE TABLE land_claim_events (
      id TEXT PRIMARY KEY, claim_id TEXT, kind TEXT, actor_id TEXT,
      detail_json TEXT, occurred_at INTEGER
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
  // A seeded world building, the kind the world seeder places.
  db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, name, x, y, z)
              VALUES ('wb1', 'tunya', 'house', 'Cottage', 100, 0, 200)`).run();
  db.prepare(`INSERT INTO building_rooms (id, building_id, world_id, room_type, name)
              VALUES ('room1', 'wb1', 'tunya', 'living', 'Living Room')`).run();
  return db;
}

const ctxFor = (db, userId) => ({ db, actor: { userId } });

describe("housing full build — claim creation completes the lifecycle (F1/S-HO-1)", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("claim land via the macro -> list -> convert the building -> the house is mine", async () => {
    const ctx = ctxFor(db, "u-alice");
    const claimed = await macros.get("land_claims.claim")(ctx, { worldId: "tunya", x: 100, z: 200, radiusM: 25 });
    assert.equal(claimed.ok, true);
    assert.ok(claimed.claimId, "claim returns its id for the panel to select");

    const listed = await macros.get("land_claims.list_for_user")(ctx, {});
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.claims.map((c) => c.id), [claimed.claimId]);

    const house = await macros.get("housing.claim")(ctx, { landClaimId: claimed.claimId, buildingId: "wb1", name: "Home" });
    assert.equal(house.ok, true);
    assert.ok(house.houseId);

    const mine = await macros.get("housing.mine")(ctx, {});
    assert.equal(mine.ok, true);
    assert.deepEqual(mine.houses.map((h) => h.id), [house.houseId]);
  });

  it("an overlapping claim is refused with the reason the form prints", async () => {
    const alice = ctxFor(db, "u-alice");
    const first = await macros.get("land_claims.claim")(alice, { worldId: "tunya", x: 100, z: 200, radiusM: 25 });
    assert.equal(first.ok, true);
    const bob = ctxFor(db, "u-bob");
    const second = await macros.get("land_claims.claim")(bob, { worldId: "tunya", x: 110, z: 205, radiusM: 25 });
    assert.equal(second.ok, false);
    assert.equal(second.reason, "overlap");
  });

  it("a claim outside the building cannot convert it (the chain stays honest)", async () => {
    const ctx = ctxFor(db, "u-alice");
    const far = await macros.get("land_claims.claim")(ctx, { worldId: "tunya", x: 900, z: 900, radiusM: 25 });
    assert.equal(far.ok, true);
    const house = await macros.get("housing.claim")(ctx, { landClaimId: far.claimId, buildingId: "wb1" });
    assert.equal(house.ok, false);
    assert.equal(house.error, "building_outside_claim");
  });
});
