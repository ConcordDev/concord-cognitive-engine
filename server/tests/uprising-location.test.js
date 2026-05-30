/**
 * WS2.7 — listActiveUprisingsWithLocation: an uprising renders where its NPC
 * members actually stand (their position centroid), not at an abstract target.
 *
 * Run: node --test tests/uprising-location.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { listActiveUprisingsWithLocation } from "../lib/uprising.js";

const W = "concordia-hub";
function mkDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE movements (
      id TEXT PRIMARY KEY, world_id TEXT, status TEXT, target_kind TEXT, target_id TEXT,
      grievance_severity INTEGER DEFAULT 0
    );
    CREATE TABLE movement_uprisings (
      movement_id TEXT PRIMARY KEY, world_id TEXT, target_kind TEXT, target_id TEXT,
      member_count INTEGER, strategy_log_id TEXT, world_event_id TEXT
    );
    CREATE TABLE movement_members (
      movement_id TEXT, member_kind TEXT, member_id TEXT, left_at INTEGER
    );
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, current_location TEXT);
  `);
  return db;
}

describe("WS2.7 — uprising located at member centroid", () => {
  it("centroid of NPC members' positions is returned", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO movements (id, world_id, status, target_kind, target_id, grievance_severity) VALUES ('m1', ?, 'acting', 'faction', 'fac1', 7)`).run(W);
    db.prepare(`INSERT INTO movement_uprisings (movement_id, world_id, target_kind, target_id, member_count) VALUES ('m1', ?, 'faction', 'fac1', 2)`).run(W);
    db.prepare(`INSERT INTO world_npcs (id, current_location) VALUES ('n1', ?), ('n2', ?)`)
      .run(JSON.stringify({ x: 10, z: 20 }), JSON.stringify({ x: 30, z: 40 }));
    db.prepare(`INSERT INTO movement_members (movement_id, member_kind, member_id, left_at) VALUES ('m1','npc','n1',NULL), ('m1','npc','n2',NULL)`).run();

    const out = listActiveUprisingsWithLocation(db, W);
    assert.equal(out.length, 1);
    assert.equal(out[0].movementId, "m1");
    assert.equal(out[0].memberCount, 2);
    assert.equal(out[0].grievance, 7);
    assert.ok(Math.abs(out[0].x - 20) < 0.001, `x centroid ${out[0].x}`);
    assert.ok(Math.abs(out[0].z - 30) < 0.001, `z centroid ${out[0].z}`);
  });

  it("only 'acting' movements count (recruiting ones are excluded)", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO movements (id, world_id, status, target_kind, target_id) VALUES ('m2', ?, 'recruiting', 'faction', 'f')`).run(W);
    db.prepare(`INSERT INTO movement_uprisings (movement_id, world_id, target_kind, target_id, member_count) VALUES ('m2', ?, 'faction', 'f', 1)`).run(W);
    assert.equal(listActiveUprisingsWithLocation(db, W).length, 0);
  });

  it("an uprising with no positioned members returns x/z=null (no fake crowd)", () => {
    const db = mkDb();
    db.prepare(`INSERT INTO movements (id, world_id, status, target_kind, target_id) VALUES ('m3', ?, 'acting', 'faction', 'f')`).run(W);
    db.prepare(`INSERT INTO movement_uprisings (movement_id, world_id, target_kind, target_id, member_count) VALUES ('m3', ?, 'faction', 'f', 5)`).run(W);
    const out = listActiveUprisingsWithLocation(db, W);
    assert.equal(out.length, 1);
    assert.equal(out[0].x, null);
    assert.equal(out[0].z, null);
  });

  it("never throws on a minimal/absent-table build", () => {
    const db = new Database(":memory:");
    assert.deepEqual(listActiveUprisingsWithLocation(db, W), []);
    assert.deepEqual(listActiveUprisingsWithLocation(null, W), []);
  });
});
