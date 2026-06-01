/**
 * #F1 — lazy-table fresh-install hazard.
 *
 * ensureRuntimeTables(db) materialises every NON-interpolated runtime
 * `CREATE TABLE IF NOT EXISTS` at boot so a fresh box has a deterministic schema
 * (no `no such table` on the first JOIN against a table normally created only at
 * its first call site). Pins: it's additive (creates the known runtime tables),
 * idempotent (a second pass adds nothing), and never clobbers a migration-owned
 * table (IF NOT EXISTS).
 *
 * Run: node --test tests/ensure-runtime-tables.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { ensureRuntimeTables } from "../lib/ensure-runtime-tables.js";

const tableCount = (db) =>
  db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c;
const hasTable = (db, n) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);

async function migratedDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  await runMigrations(db);
  return db;
}

test("materialises known lazily-created runtime tables", async () => {
  const db = await migratedDb();
  const before = tableCount(db);
  const r = ensureRuntimeTables(db);
  assert.ok(r.tablesCreated > 0, "should create at least one runtime table");
  assert.ok(tableCount(db) > before, "table count must grow");
  for (const t of ["spell_cast_log", "world_forecasts", "communes", "world_vehicles"]) {
    assert.ok(hasTable(db, t), `expected runtime table ${t} to exist after ensure`);
  }
});

test("is idempotent — a second pass adds no tables", async () => {
  const db = await migratedDb();
  ensureRuntimeTables(db);
  const after1 = tableCount(db);
  ensureRuntimeTables(db);
  assert.equal(tableCount(db), after1, "second pass must be a no-op");
});

test("never clobbers a migration-owned table (IF NOT EXISTS)", async () => {
  const db = await migratedDb();
  // dtus is migration-owned; capture its column set, run ensure, assert unchanged.
  const cols = () => db.prepare("PRAGMA table_info(dtus)").all().map((c) => c.name).sort();
  const before = cols();
  ensureRuntimeTables(db);
  assert.deepEqual(cols(), before, "dtus schema must be untouched by ensureRuntimeTables");
});

test("returns a stable report shape and tolerates a null db", () => {
  const r = ensureRuntimeTables(null);
  assert.deepEqual(r, { tablesCreated: 0, indexesCreated: 0, scanned: 0, failed: 0, names: [] });
});
