// server/migrations/513_vehicle_fare_log.js
//
// Canal-taxi fare ledger. lib/world-vehicles.js#mount records one row per
// paid player mount (vehicle_id, user_id, fare_cc) for later wallet
// reconciliation, but the table only ever existed via a lazy
// CREATE TABLE IF NOT EXISTS inside mount()'s best-effort try/catch — so
// on any DB where that DDL never ran (or failed silently), fares were not
// recorded and every reader hit "no such table: vehicle_fare_log".
// Declaring it here makes the ledger a real, migrated table.
//
// Schema matches the lazy DDL exactly (so re-running on a DB that already
// has the lazily-created table is a no-op), plus lookup indexes for the
// per-vehicle and per-user reconciliation reads.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicle_fare_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      fare_cc INTEGER NOT NULL,
      paid_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_vehicle_fare_log_vehicle ON vehicle_fare_log (vehicle_id, paid_at);
    CREATE INDEX IF NOT EXISTS idx_vehicle_fare_log_user ON vehicle_fare_log (user_id, paid_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_vehicle_fare_log_user;
    DROP INDEX IF EXISTS idx_vehicle_fare_log_vehicle;
    DROP TABLE IF EXISTS vehicle_fare_log;
  `);
}
