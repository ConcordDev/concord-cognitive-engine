/**
 * Tests for the world-travel substrate.
 *
 * Covers:
 *   - getCurrentWorld defaults to 'concordia' for unknown users
 *   - travelTo rejects unknown destinations
 *   - travelTo no-ops same-world travel
 *   - travelTo updates current_world atomically + writes audit row
 *   - anchor_id mismatched against destination is rejected
 *   - listAvailableWorlds always includes the hub even with no registered metas
 *   - listRecentTravel returns rows newest-first
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  getCurrentWorld,
  travelTo,
  listAvailableWorlds,
  listRecentTravel,
  HUB_WORLD,
} from "../lib/world-travel.js";
import { registerWorldMeta } from "../lib/cross-world-effectiveness.js";
import { up as migrate077 } from "../migrations/077_users_current_world.js";
import { up as migrate076 } from "../migrations/076_concord_link.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, sparks INTEGER DEFAULT 0)`);
  migrate077(db);
  migrate076(db);
  return db;
}

describe("world-travel", () => {
  let db;
  beforeEach(() => {
    db = freshDb();
    db.prepare(`INSERT INTO users (id) VALUES ('alice')`).run();
    registerWorldMeta({ world_id: "concordia", name: "Concordia" });
    registerWorldMeta({ world_id: "test_fantasy", name: "Fantasy" });
    registerWorldMeta({ world_id: "test_cyber", name: "Cyber" });
  });

  it("defaults to the hub for a fresh user", () => {
    assert.equal(getCurrentWorld(db, "alice"), HUB_WORLD);
  });

  it("travels to a known world and updates current_world", () => {
    const r = travelTo(db, "alice", "test_fantasy");
    assert.equal(r.ok, true);
    assert.equal(r.fromWorld, "concordia");
    assert.equal(r.toWorld, "test_fantasy");
    assert.equal(getCurrentWorld(db, "alice"), "test_fantasy");
  });

  it("rejects unknown destinations and leaves current_world unchanged", () => {
    travelTo(db, "alice", "test_fantasy");
    const r = travelTo(db, "alice", "atlantis");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_world");
    assert.equal(getCurrentWorld(db, "alice"), "test_fantasy");
  });

  it("no-ops same-world travel without writing an audit row", () => {
    travelTo(db, "alice", "test_fantasy");
    const beforeCount = db.prepare(`SELECT COUNT(*) c FROM user_world_travel_log`).get().c;
    const r = travelTo(db, "alice", "test_fantasy");
    assert.equal(r.ok, true);
    assert.equal(r.noop, true);
    const afterCount = db.prepare(`SELECT COUNT(*) c FROM user_world_travel_log`).get().c;
    assert.equal(afterCount, beforeCount);
  });

  it("rejects anchor_id from a different world", () => {
    db.prepare(`
      INSERT INTO concord_link_anchors (id, world_id, name, access_method, description, controlled_by_faction, stability)
      VALUES ('anchor_in_cyber', 'test_cyber', 'X', 'test', 'desc', NULL, 1.0)
    `).run();
    const r = travelTo(db, "alice", "test_fantasy", { anchorId: "anchor_in_cyber" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "anchor_mismatch");
  });

  it("accepts anchor_id matching the destination world", () => {
    db.prepare(`
      INSERT INTO concord_link_anchors (id, world_id, name, access_method, description, controlled_by_faction, stability)
      VALUES ('anchor_in_cyber2', 'test_cyber', 'X', 'test', 'desc', NULL, 1.0)
    `).run();
    const r = travelTo(db, "alice", "test_cyber", { anchorId: "anchor_in_cyber2" });
    assert.equal(r.ok, true);
    assert.equal(getCurrentWorld(db, "alice"), "test_cyber");
  });

  it("listAvailableWorlds always includes the hub", () => {
    const worlds = listAvailableWorlds();
    assert.ok(worlds.some((w) => w.world_id === HUB_WORLD));
    assert.ok(worlds.find((w) => w.world_id === HUB_WORLD)?.is_hub);
  });

  it("listRecentTravel returns rows newest-first", async () => {
    travelTo(db, "alice", "test_fantasy");
    // Slight artificial gap so traveled_at differs deterministically. The
    // production code uses second-resolution timestamps; we manually update
    // one row to avoid flake on machines that complete both writes inside
    // the same wall-clock second.
    travelTo(db, "alice", "test_cyber");
    db.prepare(`
      UPDATE user_world_travel_log
         SET traveled_at = traveled_at - 60
       WHERE to_world = 'test_fantasy'
    `).run();

    const rows = listRecentTravel(db, "alice");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].to_world, "test_cyber");
    assert.equal(rows[1].to_world, "test_fantasy");
  });
});
