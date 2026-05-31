// WAVE WD — World Density (every door opens). Pins the backend cores:
//   Tier 2 — ensureInterior() never-empty guarantee (authored blueprint,
//            single-room fallback, idempotency, intentionally-empty types).
//   Tier 3 — the activity/dormancy gate (in-memory recency, persisted
//            cold-start fallback, NPC-occupant activation).
//
// Run: node --test tests/world-density.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  ensureInterior,
  isInteriorActive,
  recordInteriorActivity,
  hasOccupants,
  INTENTIONALLY_EMPTY,
  DEFAULT_ACTIVITY_TTL_MS,
  _testing,
} from "../lib/world-density.js";

const WORLD = "concordia-hub";

function mkBuilding(db, { type = "house", name = null } = {}) {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO world_buildings (id, world_id, building_type, name, x, y, z) VALUES (?, ?, ?, ?, 0, 0, 0)"
  ).run(id, WORLD, type, name);
  return id;
}

function roomCount(db, buildingId) {
  return db.prepare("SELECT COUNT(*) AS c FROM building_rooms WHERE building_id = ?").get(buildingId).c;
}

describe("WD Tier 2 — ensureInterior never-empty guarantee", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); _testing.reset(); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("seeds an authored blueprint (forge → smithy + store)", () => {
    const id = mkBuilding(db, { type: "forge" });
    const r = ensureInterior(db, { id, world_id: WORLD, building_type: "forge" });
    assert.equal(r.ok, true);
    assert.equal(r.seeded, true);
    assert.equal(r.roomCount, 2);
    assert.equal(roomCount(db, id), 2);
  });

  it("synthesizes ONE room when no blueprint exists (restaurant → fallback)", () => {
    const id = mkBuilding(db, { type: "restaurant", name: "The Brass Kettle" });
    const r = ensureInterior(db, { id, world_id: WORLD, building_type: "restaurant", name: "The Brass Kettle" });
    assert.equal(r.seeded, true);
    assert.equal(r.fallback, true);
    assert.equal(r.roomCount, 1);
    const rooms = db.prepare("SELECT room_type FROM building_rooms WHERE building_id = ?").all(id);
    assert.equal(rooms[0].room_type, "restaurant"); // template exists → matches type
  });

  it("falls back to a 'generic' room for an unknown building_type", () => {
    const id = mkBuilding(db, { type: "archive" }); // no template, no blueprint
    const r = ensureInterior(db, { id, world_id: WORLD, building_type: "archive" });
    assert.equal(r.fallback, true);
    const room = db.prepare("SELECT room_type FROM building_rooms WHERE building_id = ?").get(id);
    assert.equal(room.room_type, "generic");
  });

  it("is idempotent — a second call seeds nothing", () => {
    const id = mkBuilding(db, { type: "forge" });
    ensureInterior(db, { id, world_id: WORLD, building_type: "forge" });
    const again = ensureInterior(db, { id, world_id: WORLD, building_type: "forge" });
    assert.equal(again.seeded, false);
    assert.equal(again.roomCount, 2);
    assert.equal(roomCount(db, id), 2); // not doubled
  });

  it("leaves intentionally-empty types (well/generator) empty", () => {
    assert.ok(INTENTIONALLY_EMPTY.has("well"));
    const id = mkBuilding(db, { type: "well" });
    const r = ensureInterior(db, { id, world_id: WORLD, building_type: "well" });
    assert.equal(r.intentionallyEmpty, true);
    assert.equal(roomCount(db, id), 0);
  });
});

describe("WD Tier 3 — activity / dormancy gate", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); _testing.reset(); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("a fresh building is dormant; entry activates it; it goes dormant past TTL", () => {
    const id = mkBuilding(db, { type: "house" });
    assert.equal(isInteriorActive(db, id), false);

    const now = Date.now();
    recordInteriorActivity(db, id, now);
    assert.equal(isInteriorActive(db, id, { nowMs: now }), true);

    // past the TTL → dormant again
    assert.equal(isInteriorActive(db, id, { nowMs: now + DEFAULT_ACTIVITY_TTL_MS + 1 }), false);
  });

  it("survives a cold map via the persisted column (post-restart)", () => {
    const id = mkBuilding(db, { type: "house" });
    const now = Date.now();
    recordInteriorActivity(db, id, now);
    _testing.reset(); // simulate restart — in-memory Map cleared
    assert.equal(_testing.activitySize(), 0);
    // the persisted interior_last_activity_at keeps it active
    assert.equal(isInteriorActive(db, id, { nowMs: now + 1000 }), true);
  });

  it("an NPC home/job occupant keeps an interior active with no recent entry", () => {
    const id = mkBuilding(db, { type: "house" });
    const npcId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO world_npcs (id, world_id, home_building_id, is_dead) VALUES (?, ?, ?, 0)"
    ).run(npcId, WORLD, id);
    assert.equal(hasOccupants(db, id), true);
    assert.equal(isInteriorActive(db, id), true); // no recency, but occupied
  });
});
