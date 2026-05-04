// server/migrations/100_evo_assets_gameplay_kinds.js
//
// Extend evo_assets CHECK constraints to admit gameplay-derived assets.
//
// Migration 073 created evo_assets with:
//   kind   IN ('mesh', 'texture', 'material', 'hdri', 'sprite')
//   source IN ('kenney', 'polyhaven', 'ambientcg', 'os3a', 'sketchfab', 'authored', 'evolved')
//
// The user's design intent (server/lib/gameplay-asset-bridge.js header):
//   "assets in Concordia are NOT pre-produced; they grow organically from
//    NPC, emergent, and user gameplay. A blacksmith forging a unique sword
//    produces a candidate evo-asset; an NPC defeating a rare creature drops
//    loot that becomes a new evo-asset; a creature lineage stabilizing into
//    a new species crystallizes its blueprint as an asset."
//
// The bridge tries to register kinds 'creature' / 'item' / 'skill' / 'drop' /
// 'craft' / 'species' from source 'concordia' — all of which the original
// CHECK rejected. Every gameplay event was silently dropped. Worse, the
// bridge does not pass `local_path` (NOT NULL), so the registry threw
// before it even reached the CHECK.
//
// This migration:
//   1. Recreates evo_assets with both art and gameplay kinds + sources.
//   2. Allows local_path to be null, since gameplay kinds are virtual
//      blueprints not file paths.
//   3. Preserves every existing row.
//
// Append-only per CLAUDE.md invariant; the original 073 file is untouched.

export function up(db) {
  // SQLite cannot ALTER a CHECK constraint, so we recreate the table.
  // Wrap in a transaction so a partial failure doesn't strand the schema.
  //
  // legacy_alter_table=ON stops SQLite from rewriting FK references in
  // child tables (evo_asset_interactions, evo_asset_versions) to point at
  // the renamed evo_assets_v1 — without it, dropping evo_assets_v1 leaves
  // those FKs dangling and every subsequent INSERT into the child table
  // fails with "no such table: main.evo_assets_v1".
  const fkBefore = db.pragma("foreign_keys", { simple: true });
  const altBefore = db.pragma("legacy_alter_table", { simple: true });
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  db.exec("BEGIN");
  try {
    // 1) Rename existing table out of the way
    db.exec("ALTER TABLE evo_assets RENAME TO evo_assets_v1");

    // 2) New table with extended CHECK + nullable local_path
    db.exec(`
      CREATE TABLE evo_assets (
        id                  TEXT PRIMARY KEY,
        kind                TEXT NOT NULL
                              CHECK (kind IN (
                                'mesh', 'texture', 'material', 'hdri', 'sprite',
                                'creature', 'item', 'skill', 'drop', 'craft', 'species'
                              )),
        source              TEXT NOT NULL
                              CHECK (source IN (
                                'kenney', 'polyhaven', 'ambientcg', 'os3a', 'sketchfab',
                                'authored', 'evolved', 'concordia'
                              )),
        source_id           TEXT,
        local_path          TEXT,
        category            TEXT,
        tags_json           TEXT NOT NULL DEFAULT '[]',
        quality_level       INTEGER NOT NULL DEFAULT 0
                              CHECK (quality_level BETWEEN 0 AND 10),
        evolution_score     REAL NOT NULL DEFAULT 0,
        interaction_points  INTEGER NOT NULL DEFAULT 0,
        last_evolved_at     INTEGER,
        last_interacted_at  INTEGER,
        archived_at         INTEGER,
        canonical_dtu_id    TEXT,
        created_at          INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);

    // 3) Copy every row (CHECK on the new table accepts the old values).
    db.exec(`
      INSERT INTO evo_assets (
        id, kind, source, source_id, local_path, category, tags_json,
        quality_level, evolution_score, interaction_points,
        last_evolved_at, last_interacted_at, archived_at,
        canonical_dtu_id, created_at
      )
      SELECT
        id, kind, source, source_id, local_path, category, tags_json,
        quality_level, evolution_score, interaction_points,
        last_evolved_at, last_interacted_at, archived_at,
        canonical_dtu_id, created_at
      FROM evo_assets_v1
    `);

    // 4) Drop the legacy table.
    db.exec("DROP TABLE evo_assets_v1");

    // 5) Re-create the indexes from migration 073.
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_quality   ON evo_assets(quality_level DESC, interaction_points DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_kind      ON evo_assets(kind, archived_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_source    ON evo_assets(source, source_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_canonical ON evo_assets(canonical_dtu_id)`);

    // 6) Re-create the CDN URLs index from migration 084 if its column exists.
    // (084 added cdn_url_json — leave the existing index intact via its own
    // migration's CREATE IF NOT EXISTS pattern.)

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    // Restore prior pragma state.
    db.pragma(`legacy_alter_table = ${altBefore ? "ON" : "OFF"}`);
    db.pragma(`foreign_keys = ${fkBefore ? "ON" : "OFF"}`);
  }
}
