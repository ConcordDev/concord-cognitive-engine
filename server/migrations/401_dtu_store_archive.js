// server/migrations/401_dtu_store_archive.js
//
// Sprint 32 — DTU memory-pressure relief.
//
// Why this migration exists:
// Concord has been growing the dtu_store table at ~1,429 rows/hour in the
// first 16h of operation (operator-measured, 2026-08-12). At that rate the
// DTU_MEMORY_CEILING=170_000 cap is reachable in ~4 days, before any user
// has logged in. Forgetting runs once per 6 hours with MAX_FORGET_PER_CYCLE=50,
// so even at full capacity the engine can free ~200 DTUs/day vs ~34,000
// created/day — a 170:1 deficit. Forgetting protects IMPORTANT knowledge; it
// cannot keep up with raw volume. The right answer is to move low-utility
// cold DTUs off the hot path entirely.
//
// What this migration does:
//   1. Creates dtu_store_archive with the same shape as dtu_store plus an
//      `archived_at` timestamp + an `archive_reason` text. Both are NOT NULL
//      so future migrations can rely on them. The index on `archived_at`
//      supports the rolling restore path (e.g. operator restores the last
//      week for a recovery request).
//   2. Creates dtu_archive_runs — a tiny bookkeeping table that records
//      each archive sweep: when it ran, how many rows moved, the threshold
//      used. Lets the operator see the trend and tune CONCORD_DTU_ARCHIVE_AGE_MS.
//   3. Adds idx_dtu_store_updated_at to the LIVE table (was missing in the
//      original schema; the archive boot hook uses it to walk old rows in
//      id-ordered batches without scanning the whole table).
//
// What this migration does NOT do:
//   - It does NOT move any rows. Migration files are SQL/structure only —
//     the migration runner applies them idempotently and the archive boot
//     hook (`server/lib/dtu-archive.js#archiveOldDtuStore`) does the actual
//     row movement so it can yield + be paused + be tuned without a
//     migration.
//   - It does NOT touch the in-memory `STATE.dtus` Map; that map is owned
//     by server.js's createDTUStore and pruned by the boot hook via the
//     store's `delete()` method.
//
// Failure mode: append-only. down() intentionally drops nothing — rolling
// back this migration must not strand archived knowledge. If you ever
// need to recover the archive table itself, the data is in SQLite and can
// be promoted back into dtu_store with a one-off INSERT...SELECT.

const ARCHIVE_TABLE = "dtu_store_archive";
const RUNS_TABLE = "dtu_archive_runs";

export function up(db) {
  // ── (1) Archive table ────────────────────────────────────────────────
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ${ARCHIVE_TABLE} (
      id              TEXT PRIMARY KEY,
      title           TEXT,
      tier            TEXT DEFAULT 'regular',
      scope           TEXT DEFAULT 'global',
      tags            TEXT DEFAULT '[]',
      source          TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      archived_at     TEXT NOT NULL DEFAULT (datetime('now')),
      archive_reason  TEXT NOT NULL DEFAULT 'cold_age',
      content_hash    TEXT,
      compressed_size INTEGER DEFAULT 0,
      rights_id       TEXT,
      data            TEXT NOT NULL DEFAULT '{}'
    )
  `).run();

  // Operational indexes. archived_at DESC supports "restore the most
  // recent N days" without scanning the whole archive. created_at is the
  // original DTU birth time — useful for the retention-scorer to look at
  // archived DTUs without ever loading them into RAM.
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_dtu_archive_archived_at
                 ON ${ARCHIVE_TABLE}(archived_at DESC)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_dtu_archive_created_at
                 ON ${ARCHIVE_TABLE}(created_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_dtu_archive_tier
                 ON ${ARCHIVE_TABLE}(tier)`).run();

  // ── (2) Run bookkeeping ─────────────────────────────────────────────
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ${RUNS_TABLE} (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ran_at          TEXT NOT NULL DEFAULT (datetime('now')),
      age_threshold_ms INTEGER NOT NULL,
      rows_archived   INTEGER NOT NULL DEFAULT 0,
      rows_remaining  INTEGER NOT NULL DEFAULT 0,
      duration_ms     INTEGER NOT NULL DEFAULT 0,
      interrupted     INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  // ── (3) Index on the LIVE table that the archive hook needs ─────────
  // The archive hook walks the live table in id-ordered batches by
  // updated_at, so an index on updated_at is the difference between an
  // O(N log N) walk and a full table scan every boot. Schema did not have
  // it; add it now. CREATE INDEX IF NOT EXISTS is safe on re-run.
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_dtu_store_updated_at
                 ON dtu_store(updated_at)`).run();
}

export function down(_db) {
  // Append-only. Do not drop the archive table on downgrade — that would
  // strand data we just moved. If a real rollback is needed, the operator
  // can run `INSERT INTO dtu_store SELECT * FROM dtu_store_archive`
  // manually after dropping this migration entry.
}