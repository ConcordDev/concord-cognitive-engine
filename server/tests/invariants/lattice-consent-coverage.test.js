// Invariant: every table designated as a Lattice training-data source
// MUST carry the `train_consented` column. Migration 108 adds it; this
// test prevents future schema drift from silently dropping the column
// on a table-recreate (the same kind of drift that broke evo_assets in
// migration 100). When training kicks on, missing-column failures are
// silent (the row gets excluded from corpus instead of failing loudly),
// so the test is the only line of defense.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../../migrate.js";
import {
  listConsentTables,
  setDtuTrainConsent,
  setAllDtusTrainConsent,
  getCorpusStats,
} from "../../lib/training-consent.js";

let db;
beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  await runMigrations(db);
});

function columnExists(table, col) {
  const rows = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table);
  return rows.some((r) => r.name === col);
}

test("every user-authored consent table has train_consented column with default 0", () => {
  const { userAuthored } = listConsentTables();
  for (const table of userAuthored) {
    assert.ok(columnExists(table, "train_consented"),
      `${table} missing train_consented column`);
    // Insert with no explicit value → must default to 0 (opt-in required).
    // Use a minimal-shape insert per table.
    if (table === "dtus") {
      db.prepare(`INSERT INTO dtus (id, type, title) VALUES ('test-default-0', 'test', 'test')`).run();
      const row = db.prepare(`SELECT train_consented FROM dtus WHERE id = ?`).get("test-default-0");
      assert.strictEqual(row.train_consented, 0,
        "dtus default must be 0 (user opt-in required)");
    }
  }
});

test("every platform-generated consent table has train_consented column with default 1", () => {
  const { platform } = listConsentTables();
  for (const table of platform) {
    assert.ok(columnExists(table, "train_consented"),
      `${table} missing train_consented column`);
    // Verify the column default via pragma_table_info.
    const colInfo = db.prepare(`SELECT * FROM pragma_table_info(?)`).all(table)
      .find((r) => r.name === "train_consented");
    assert.ok(colInfo, `train_consented info missing for ${table}`);
    assert.strictEqual(String(colInfo.dflt_value), "1",
      `${table}.train_consented must default to 1 (platform-consented)`);
  }
});

test("dtus also has train_quality_score column for filter pipeline", () => {
  assert.ok(columnExists("dtus", "train_quality_score"),
    "dtus.train_quality_score is required for the corpus filter");
});

test("setDtuTrainConsent: owner can flip consent", () => {
  db.prepare(`INSERT INTO dtus (id, creator_id, type, title) VALUES (?, ?, 'note', 'test')`)
    .run("dtu-1", "user-A");
  const r = setDtuTrainConsent(db, "dtu-1", "user-A", true);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.consented, true);
  const row = db.prepare(`SELECT train_consented FROM dtus WHERE id = ?`).get("dtu-1");
  assert.strictEqual(row.train_consented, 1);
});

test("setDtuTrainConsent: non-owner gets not_owner error", () => {
  db.prepare(`INSERT INTO dtus (id, creator_id, type, title) VALUES (?, ?, 'note', 'test')`)
    .run("dtu-2", "user-A");
  const r = setDtuTrainConsent(db, "dtu-2", "user-B", true);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "not_owner");
});

test("setDtuTrainConsent: missing dtu yields dtu_not_found", () => {
  const r = setDtuTrainConsent(db, "no-such-dtu", "user-A", true);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "dtu_not_found");
});

test("setAllDtusTrainConsent: bulk flips every DTU owned by user", () => {
  db.prepare(`INSERT INTO dtus (id, creator_id, type, title) VALUES (?, ?, 'note', 'a')`).run("dtu-bulk-1", "user-X");
  db.prepare(`INSERT INTO dtus (id, creator_id, type, title) VALUES (?, ?, 'note', 'b')`).run("dtu-bulk-2", "user-X");
  db.prepare(`INSERT INTO dtus (id, creator_id, type, title) VALUES (?, ?, 'note', 'c')`).run("dtu-bulk-3", "user-Y"); // not owned
  const r = setAllDtusTrainConsent(db, "user-X", true);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.updated, 2);
  const userX = db.prepare(`SELECT id, train_consented FROM dtus WHERE creator_id = 'user-X'`).all();
  for (const d of userX) assert.strictEqual(d.train_consented, 1);
  const userY = db.prepare(`SELECT train_consented FROM dtus WHERE creator_id = 'user-Y'`).get();
  assert.strictEqual(userY.train_consented, 0, "must NOT touch other users' DTUs");
});

test("getCorpusStats: returns counts per table partitioned by regime", () => {
  // Seed some data
  db.prepare(`INSERT INTO dtus (id, creator_id, type, title, train_consented) VALUES (?, ?, 'note', 'x', 1)`)
    .run("dtu-stats-1", "user-S");
  db.prepare(`INSERT INTO dtus (id, creator_id, type, title, train_consented) VALUES (?, ?, 'note', 'y', 0)`)
    .run("dtu-stats-2", "user-S");

  const stats = getCorpusStats(db);
  assert.ok(Array.isArray(stats.tables), "tables must be array");
  const dtuRow = stats.tables.find((t) => t.name === "dtus");
  assert.ok(dtuRow, "dtus row missing from stats");
  assert.strictEqual(dtuRow.regime, "user_opt_in");
  assert.ok(dtuRow.total >= 2);
  assert.ok(dtuRow.consented >= 1);
  assert.ok(dtuRow.ratio >= 0 && dtuRow.ratio <= 1);

  const platformRow = stats.tables.find((t) => t.name === "world_events_log");
  assert.ok(platformRow, "world_events_log row missing from stats");
  assert.strictEqual(platformRow.regime, "platform_default_in");
});
