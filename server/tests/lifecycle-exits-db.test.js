// Audit sweep CB-0475 — the DB-backed lifecycle exits:
//   housing rename + unclaim (FIX-housing-001) · fishing catch-delete +
//   catch-annotate (FIX-fishing-004 delete/annotate leg).
// Mirrors the shipped housing-domain-macros / fishing-domain-macros
// in-memory sqlite patterns. Runs in the desk's batch checks / CI
// (better-sqlite3 does not build in the Muse VM).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerHousingMacros from "../domains/housing.js";
import registerFishingMacros from "../domains/fishing.js";
import { claimHouse } from "../lib/player-housing.js";

function collect(registerFn) {
  const map = new Map();
  registerFn((_domain, name, handler) => { map.set(name, handler); });
  return map;
}
function ctxFor(db, userId) {
  return { db, actor: { userId } };
}

// ── housing ──────────────────────────────────────────────────────────

function freshHousingDb() {
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

function seedHouse(db, userId) {
  db.prepare(`INSERT INTO land_claims (id, owner_user_id, world_id, anchor_x, anchor_z, radius_m, status)
              VALUES ('lc1', ?, 'tunya', 0, 0, 50, 'active')`).run(userId);
  db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, name, x, y, z)
              VALUES ('wb1', 'tunya', 'house', 'Cottage', 5, 0, 5)`).run();
  db.prepare(`INSERT INTO building_rooms (id, building_id, world_id, room_type, name)
              VALUES ('room1', 'wb1', 'tunya', 'living', 'Living Room')`).run();
  const claimed = claimHouse(db, userId, { landClaimId: "lc1", buildingId: "wb1", name: "Home" });
  assert.equal(claimed.ok, true);
  return claimed.houseId;
}

describe("housing rename + unclaim (FIX-housing-001)", () => {
  let db, macros;
  beforeEach(() => { db = freshHousingDb(); macros = collect(registerHousingMacros); });

  it("rename round-trips through mine; blank names refused", async () => {
    const houseId = seedHouse(db, "alice");
    const blank = await macros.get("rename")(ctxFor(db, "alice"), { houseId, name: "  " });
    assert.equal(blank.ok, false);
    const r = await macros.get("rename")(ctxFor(db, "alice"), { houseId, name: "Lake House" });
    assert.equal(r.ok, true);
    assert.equal(r.name, "Lake House");
    const mine = await macros.get("mine")(ctxFor(db, "alice"), {});
    assert.equal(mine.houses[0].name, "Lake House");
  });

  it("rename and unclaim are owner-only", async () => {
    const houseId = seedHouse(db, "alice");
    const ren = await macros.get("rename")(ctxFor(db, "bob"), { houseId, name: "Bob's" });
    assert.equal(ren.ok, false);
    assert.equal(ren.error, "not_owner");
    const unc = await macros.get("unclaim")(ctxFor(db, "bob"), { houseId });
    assert.equal(unc.ok, false);
    assert.equal(unc.error, "not_owner");
  });

  it("unclaim deletes the join row; the building can be claimed again", async () => {
    const houseId = seedHouse(db, "alice");
    const u = await macros.get("unclaim")(ctxFor(db, "alice"), { houseId });
    assert.equal(u.ok, true);
    const mine = await macros.get("mine")(ctxFor(db, "alice"), {});
    assert.equal(mine.houses.length, 0);
    const again = claimHouse(db, "alice", { landClaimId: "lc1", buildingId: "wb1", name: "Home Again" });
    assert.equal(again.ok, true);
    assert.notEqual(again.houseId, houseId);
  });
});

// ── fishing ──────────────────────────────────────────────────────────

function freshFishingDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_inventory (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      world_id    TEXT NOT NULL DEFAULT 'concordia-hub',
      item_type   TEXT NOT NULL DEFAULT 'material',
      item_id     TEXT NOT NULL,
      item_name   TEXT NOT NULL DEFAULT '',
      quantity    INTEGER NOT NULL DEFAULT 1,
      schema_id   TEXT,
      acquired_at INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata    TEXT
    );
  `);
  db.prepare(`INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, metadata)
              VALUES ('catch1', 'alice', 'raw_fish', 'trout', 'Rainbow Trout', '{}')`).run();
  db.prepare(`INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, metadata)
              VALUES ('catch2', 'bob', 'raw_fish', 'bass', 'Largemouth Bass', '{}')`).run();
  return db;
}

describe("fishing catch-delete + catch-annotate (FIX-fishing-004)", () => {
  let db, macros;
  beforeEach(() => { db = freshFishingDb(); macros = collect(registerFishingMacros); });

  it("annotate merges a note into the catch metadata; blank clears it", async () => {
    const a = await macros.get("catch-annotate")(ctxFor(db, "alice"), { catchId: "catch1", note: "personal best" });
    assert.equal(a.ok, true);
    assert.equal(a.note, "personal best");
    const list = await macros.get("catches")(ctxFor(db, "alice"), {});
    assert.equal(list.catches.length, 1);
    assert.equal(JSON.parse(list.catches[0].meta_json).note, "personal best");
    const cleared = await macros.get("catch-annotate")(ctxFor(db, "alice"), { catchId: "catch1", note: "" });
    assert.equal(cleared.note, null);
  });

  it("delete removes only the caller's own catch", async () => {
    const other = await macros.get("catch-delete")(ctxFor(db, "alice"), { catchId: "catch2" });
    assert.equal(other.ok, false);
    assert.equal(other.reason, "catch_not_found");
    const own = await macros.get("catch-delete")(ctxFor(db, "alice"), { catchId: "catch1" });
    assert.equal(own.ok, true);
    const list = await macros.get("catches")(ctxFor(db, "alice"), {});
    assert.equal(list.catches.length, 0);
    const bobList = await macros.get("catches")(ctxFor(db, "bob"), {});
    assert.equal(bobList.catches.length, 1);
  });
});
