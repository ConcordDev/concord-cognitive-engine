// server/migrations/107_evo_assets_fk_repair.js
//
// NOTE (Phase 3.5.5 archival, May 2026):
//   The `evo_asset_interactions_fix` and `evo_asset_versions_fix` tables
//   created here are STAGING tables — they're renamed back to the
//   live names (`evo_asset_interactions`, `evo_asset_versions`) within
//   the same migration. Cartographer flags them as "dead" because no
//   SELECT references the *_fix names; that's correct and intentional.
//   These are not dead tables; they're transient.
//   STAGING_NOT_DEAD: rename happens at DROP+ALTER inside this migration.
//
// Repair dangling FK references on evo_asset_interactions and
// evo_asset_versions left over from migration 100.
//
// Migration 100 set `legacy_alter_table = ON` before renaming evo_assets
// → evo_assets_v1, intending to keep child FK references pointing at the
// original "evo_assets" name. But the runner wraps each migration in
// db.transaction(), and `PRAGMA legacy_alter_table` set inside a
// transaction does NOT take effect for the ALTER TABLE that follows —
// SQLite still rewrote the child FK clauses to "evo_assets_v1". When 100
// then dropped evo_assets_v1, both child tables ended up with FK
// references to a non-existent table.
//
// Symptom: every recordInteraction() call (and every appendVersion call)
// throws `no such table: main.evo_assets_v1`. The gameplay-asset-bridge's
// _safe() wrapper catches the throw and logs a warning, so production
// silently dropped every gameplay-derived interaction since 100 landed —
// a textbook silent-failure load-bearing bug.
//
// This migration rebuilds both child tables with FK references pointing
// at "evo_assets" (the live table). All existing data is preserved.
//
// Caught by the new tests/invariants/gameplay-asset-bridge-persistence
// invariant. The schema check below proves the bug existed by detecting
// the dangling reference; if no dangling reference is found (e.g. fresh
// install where 100 happened to land in a connection state where the
// pragma DID work), the migration short-circuits and is a no-op.

export function up(db) {
  // Find tables that still reference evo_assets_v1 in their FK clauses.
  const broken = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND sql LIKE '%evo_assets_v1%'
  `).all();
  if (broken.length === 0) return; // schema already clean

  // Foreign-key enforcement must be relaxed during the rebuild so the
  // interim state (data copied to staging table) doesn't trip CASCADE
  // checks. PRAGMA foreign_keys is a no-op inside a transaction — but
  // PRAGMA defer_foreign_keys = ON applies to the current transaction
  // and defers FK validation until commit, which is exactly what we
  // want: we'll have rebuilt valid references by then.
  db.pragma("defer_foreign_keys = ON");

  for (const { name } of broken) {
    if (name === "evo_asset_interactions") {
      _rebuildInteractions(db);
    } else if (name === "evo_asset_versions") {
      _rebuildVersions(db);
    }
    // No else — only these two tables had child FKs to evo_assets pre-100.
  }
}

function _rebuildInteractions(db) {
  // 1) Stage table with correct FK pointing at "evo_assets".
  db.exec(`
    CREATE TABLE evo_asset_interactions_fix (
      id          TEXT PRIMARY KEY,
      asset_id    TEXT NOT NULL,
      actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('user', 'npc', 'system')),
      actor_id    TEXT,
      action      TEXT NOT NULL,
      weight      REAL NOT NULL DEFAULT 1.0,
      ts          INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (asset_id) REFERENCES evo_assets(id) ON DELETE CASCADE
    )
  `);
  // 2) Copy every row.
  db.exec(`
    INSERT INTO evo_asset_interactions_fix
      (id, asset_id, actor_kind, actor_id, action, weight, ts)
    SELECT id, asset_id, actor_kind, actor_id, action, weight, ts
    FROM evo_asset_interactions
  `);
  // 3) Drop broken table.
  db.exec(`DROP TABLE evo_asset_interactions`);
  // 4) Rename staging in place.
  db.exec(`ALTER TABLE evo_asset_interactions_fix RENAME TO evo_asset_interactions`);
  // 5) Recreate the index from migration 073.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_evo_asset_interactions_asset
      ON evo_asset_interactions(asset_id, ts DESC)
  `);
}

function _rebuildVersions(db) {
  db.exec(`
    CREATE TABLE evo_asset_versions_fix (
      id              TEXT PRIMARY KEY,
      asset_id        TEXT NOT NULL,
      version_number  INTEGER NOT NULL,
      pass_kind       TEXT NOT NULL
                        CHECK (pass_kind IN (
                          'subdivision', 'detail_maps', 'material_upgrade',
                          'procedural_wear', 'higher_lod', 'authored_replacement'
                        )),
      local_path      TEXT NOT NULL,
      promoted        INTEGER NOT NULL DEFAULT 0,
      gate_dtu_id     TEXT,
      gate_verdict    TEXT,
      diff_summary    TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      promoted_at     INTEGER,
      cdn_url         TEXT,
      FOREIGN KEY (asset_id) REFERENCES evo_assets(id) ON DELETE CASCADE
    )
  `);
  db.exec(`
    INSERT INTO evo_asset_versions_fix
      (id, asset_id, version_number, pass_kind, local_path, promoted,
       gate_dtu_id, gate_verdict, diff_summary, created_at, promoted_at, cdn_url)
    SELECT
       id, asset_id, version_number, pass_kind, local_path, promoted,
       gate_dtu_id, gate_verdict, diff_summary, created_at, promoted_at, cdn_url
    FROM evo_asset_versions
  `);
  db.exec(`DROP TABLE evo_asset_versions`);
  db.exec(`ALTER TABLE evo_asset_versions_fix RENAME TO evo_asset_versions`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_evo_asset_versions_asset
      ON evo_asset_versions(asset_id, version_number DESC)
  `);
}
