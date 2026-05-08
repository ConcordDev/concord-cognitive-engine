/**
 * Tier-2 contract tests for the world-invites migration + helpers.
 *
 * Pins the schema shape and the canonical state transitions
 * (pending → accepted | declined | expired) on a temp in-memory DB,
 * isolated from the live DB.
 *
 * Run: node --test tests/world-invites.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import Database from "better-sqlite3";
import { up as upInvites, down as downInvites } from "../migrations/119_world_invites.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  upInvites(db);
});

function insert(id, fromUser, toUser, worldId, worldName, status = "pending") {
  db.prepare(`
    INSERT INTO world_invites (id, from_user_id, to_user_id, world_id, world_name, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, fromUser, toUser, worldId, worldName, status);
}

describe("world_invites migration", () => {
  it("creates the table with default pending status + 7-day TTL", () => {
    insert("i1", "u-from", "u-to", "world-a", "World Alpha");
    const row = db.prepare("SELECT * FROM world_invites WHERE id = ?").get("i1");
    assert.equal(row.status, "pending");
    assert.equal(row.responded_at, null);

    // expires_at should be roughly 7 days after created_at.
    const created = new Date(row.created_at).getTime();
    const expires = new Date(row.expires_at).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const delta = Math.abs(expires - created - sevenDaysMs);
    assert.ok(delta < 60 * 1000, `TTL not ~7d: delta=${delta}ms`);
  });

  it("CHECK constraint rejects unknown statuses", () => {
    assert.throws(
      () => insert("i1", "u-from", "u-to", "world-a", "World Alpha", "haunted"),
      /CHECK constraint failed/i,
    );
  });

  it("idx_world_invites_to_pending covers the list-pending query", () => {
    insert("i1", "f", "u-to", "w1", "World 1");
    insert("i2", "f", "u-to", "w2", "World 2");
    insert("i3", "f", "u-other", "w1", "World 1");
    insert("i4", "f", "u-to", "w1", "World 1", "declined");

    const rows = db.prepare(`
      SELECT id FROM world_invites
      WHERE to_user_id = ? AND status = 'pending'
      ORDER BY created_at DESC
    `).all("u-to");

    const ids = rows.map((r) => r.id).sort();
    assert.deepEqual(ids, ["i1", "i2"]);

    // Confirm the planner uses our index (sqlite-specific; tolerates
    // future-version output changes by just looking for the index name).
    const plan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT id FROM world_invites WHERE to_user_id = ? AND status = 'pending'
    `).all("u-to");
    const planText = plan.map((r) => r.detail).join(" ");
    assert.ok(/idx_world_invites_to_pending/.test(planText), `plan: ${planText}`);
  });

  it("accept transitions pending → accepted with responded_at stamped", () => {
    insert("i1", "f", "u-to", "w1", "World 1");
    const r = db.prepare(`
      UPDATE world_invites
      SET status = 'accepted', responded_at = datetime('now')
      WHERE id = ? AND to_user_id = ? AND status = 'pending'
    `).run("i1", "u-to");
    assert.equal(r.changes, 1);

    const row = db.prepare("SELECT status, responded_at FROM world_invites WHERE id = ?").get("i1");
    assert.equal(row.status, "accepted");
    assert.notEqual(row.responded_at, null);
  });

  it("accept is idempotent — second attempt no-ops (changes = 0)", () => {
    insert("i1", "f", "u-to", "w1", "World 1");
    db.prepare(`UPDATE world_invites SET status='accepted' WHERE id=?`).run("i1");

    // Second accept must not re-stamp responded_at — the WHERE clause
    // requires status='pending' which no longer matches.
    const r = db.prepare(`
      UPDATE world_invites
      SET status = 'accepted', responded_at = datetime('now')
      WHERE id = ? AND to_user_id = ? AND status = 'pending'
    `).run("i1", "u-to");
    assert.equal(r.changes, 0);
  });

  it("decline transitions pending → declined with responded_at stamped", () => {
    insert("i1", "f", "u-to", "w1", "World 1");
    const r = db.prepare(`
      UPDATE world_invites
      SET status = 'declined', responded_at = datetime('now')
      WHERE id = ? AND to_user_id = ? AND status = 'pending'
    `).run("i1", "u-to");
    assert.equal(r.changes, 1);
  });

  it("expire sweep transitions stale pending → expired", () => {
    // Manually backdate one row so it's expired.
    insert("i1", "f", "u-to", "w1", "World 1");
    db.prepare(`UPDATE world_invites SET expires_at = datetime('now', '-1 hour') WHERE id = ?`).run("i1");
    insert("i2", "f", "u-to", "w2", "World 2");

    const r = db.prepare(`
      UPDATE world_invites
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= datetime('now')
    `).run();
    assert.equal(r.changes, 1);

    const row1 = db.prepare("SELECT status FROM world_invites WHERE id = ?").get("i1");
    const row2 = db.prepare("SELECT status FROM world_invites WHERE id = ?").get("i2");
    assert.equal(row1.status, "expired");
    assert.equal(row2.status, "pending");
  });

  it("down() removes the table cleanly", () => {
    downInvites(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    assert.ok(!tables.includes("world_invites"));
  });
});
