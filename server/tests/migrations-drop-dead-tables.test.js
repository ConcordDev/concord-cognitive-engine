/**
 * Tier-2 contract test for Phase 4 — drop-dead-tables migrations 120-124.
 *
 * Pins:
 *   - Empty dead tables get dropped, audit row written with action: "dropped"
 *   - Non-empty dead tables get RESCUED to data/dropped-tables/<name>.<ts>.json
 *     and SKIPPED with audit row action: "skipped"
 *   - CONCORD_ALLOW_DROP_NONEMPTY=1 overrides the rescue and drops anyway
 *   - CONCORD_DROP_DEAD_TABLES=0 short-circuits the entire phase
 *   - migration_drops audit table is created idempotently
 *
 * Skips if better-sqlite3 isn't installed in this environment.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { dropDeadTables } from "../migrations/_drop-with-rescue.js";

function setup(Database) {
  const db = new Database(":memory:");
  // Pretend two of the dead tables exist.
  db.exec(`CREATE TABLE wants (id TEXT PRIMARY KEY, content TEXT)`);
  db.exec(`CREATE TABLE want_audit_log (id TEXT PRIMARY KEY, content TEXT)`);
  return db;
}

describe("Phase 4 drop-dead-tables migrations", () => {
  let Database;
  it("loads better-sqlite3 fixture or skips", async (t) => {
    try { Database = (await import("better-sqlite3")).default; }
    catch { return t.skip("better-sqlite3 not installed"); }
  });

  it("drops empty dead tables and writes audit row", async (t) => {
    if (!Database) return t.skip("better-sqlite3 not installed");
    const db = setup(Database);
    delete process.env.CONCORD_ALLOW_DROP_NONEMPTY;
    delete process.env.CONCORD_DROP_DEAD_TABLES;

    const result = dropDeadTables(db, ["wants", "want_audit_log", "nonexistent_table"]);
    assert.equal(result.ok, true);
    assert.equal(result.dropped.length, 2);
    assert.equal(result.missing.length, 1);
    assert.equal(result.skipped.length, 0);
    // Tables gone
    assert.equal(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='wants'`).get(), undefined);
    // Audit rows present
    const audit = db.prepare(`SELECT * FROM migration_drops ORDER BY id`).all();
    assert.equal(audit.length, 2);
    assert.equal(audit[0].action, "dropped");
    db.close();
  });

  it("RESCUES non-empty tables (writes JSON, skips drop, audit action='skipped')", async (t) => {
    if (!Database) return t.skip("better-sqlite3 not installed");
    const db = setup(Database);
    db.prepare(`INSERT INTO wants (id, content) VALUES (?, ?)`).run("w1", "data");
    db.prepare(`INSERT INTO wants (id, content) VALUES (?, ?)`).run("w2", "more");
    delete process.env.CONCORD_ALLOW_DROP_NONEMPTY;
    delete process.env.CONCORD_DROP_DEAD_TABLES;

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "concord-rescue-"));
    const result = dropDeadTables(db, ["wants", "want_audit_log"], { repoRoot: tmpRoot });
    assert.equal(result.ok, true);
    assert.equal(result.dropped.length, 1, "empty table should still be dropped");
    assert.equal(result.skipped.length, 1, "non-empty table should be skipped");
    assert.equal(result.skipped[0].table, "wants");
    assert.equal(result.skipped[0].rowCount, 2);

    // The skipped table is still present
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='wants'`).get());

    // Rescue file exists
    const rescuePath = result.skipped[0].rescue;
    assert.ok(rescuePath && fs.existsSync(rescuePath), "rescue JSON should be written");
    const rescueData = JSON.parse(fs.readFileSync(rescuePath, "utf-8"));
    assert.equal(rescueData.rowCount, 2);
    assert.equal(rescueData.rows.length, 2);

    // Audit row present with action='skipped'
    const audit = db.prepare(`SELECT * FROM migration_drops WHERE table_name='wants'`).get();
    assert.equal(audit.action, "skipped");
    assert.ok(audit.rescue_path);
    db.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("CONCORD_ALLOW_DROP_NONEMPTY=1 overrides the rescue", async (t) => {
    if (!Database) return t.skip("better-sqlite3 not installed");
    const db = setup(Database);
    db.prepare(`INSERT INTO wants (id, content) VALUES (?, ?)`).run("w1", "data");
    process.env.CONCORD_ALLOW_DROP_NONEMPTY = "1";
    delete process.env.CONCORD_DROP_DEAD_TABLES;
    const result = dropDeadTables(db, ["wants"]);
    assert.equal(result.dropped.length, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='wants'`).get(), undefined);
    delete process.env.CONCORD_ALLOW_DROP_NONEMPTY;
    db.close();
  });

  it("CONCORD_DROP_DEAD_TABLES=0 short-circuits", async (t) => {
    if (!Database) return t.skip("better-sqlite3 not installed");
    const db = setup(Database);
    process.env.CONCORD_DROP_DEAD_TABLES = "0";
    const result = dropDeadTables(db, ["wants", "want_audit_log"]);
    assert.equal(result.ok, true);
    assert.equal(result.reason, "disabled_by_env");
    // Tables still present
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='wants'`).get());
    delete process.env.CONCORD_DROP_DEAD_TABLES;
    db.close();
  });
});
