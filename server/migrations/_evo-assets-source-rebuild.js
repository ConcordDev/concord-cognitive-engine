// server/migrations/_evo-assets-source-rebuild.js
//
// Shared helper (not a migration — migrate.js only runs `NNN_*.js`) for
// widening evo_assets.source's CHECK list. Extracted from 451 so each new
// generator source is one line instead of another hand-copied table rebuild;
// 451 itself stays as applied (migrations are append-only).
//
// The ordering here is load-bearing, learned the hard way (see 450/451):
// runMigrations wraps up() in a transaction, where PRAGMA foreign_keys and
// legacy_alter_table are silent no-ops. So the RENAME rewrites both child
// FKs onto the transient table, and DROPping it while they still point at it
// fires ON DELETE CASCADE and deletes every child row. Children are
// re-pointed at the new evo_assets (275's idempotent repair) BEFORE the drop.

import { up as repairEvoAssetFks } from "./275_evo_asset_fk_repair.js";

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

function acceptsSource(db, source) {
  const id = `__probe_${source}__`;
  try {
    db.prepare(`INSERT INTO evo_assets (id, kind, source, source_id, local_path) VALUES (?, 'mesh', ?, ?, 'probe')`)
      .run(id, source, id);
    db.prepare(`DELETE FROM evo_assets WHERE id = ?`).run(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rebuild evo_assets so its source CHECK is exactly `sources`, preserving
 * every row and both child tables. No-op when every source is already
 * accepted. `sources` must be a superset of what existing rows use.
 */
export function ensureEvoAssetSources(db, sources, transientName) {
  if (!tableExists(db, "evo_assets")) return false;
  if (sources.every((s) => acceptsSource(db, s))) return false;
  if (!sources.every((s) => /^[a-z0-9_-]+$/.test(s))) throw new Error("evo_assets source ids must be [a-z0-9_-]");

  const inUse = db.prepare(`SELECT DISTINCT source FROM evo_assets`).all().map((r) => r.source);
  const dropped = inUse.filter((s) => !sources.includes(s));
  if (dropped.length) throw new Error(`refusing to drop sources still in use: ${dropped.join(", ")}`);

  const hasCdn = columnExists(db, "evo_assets", "cdn_url");
  const hasTrain = columnExists(db, "evo_assets", "train_consented");
  const sourceList = sources.map((s) => `'${s}'`).join(", ");

  db.exec(`ALTER TABLE evo_assets RENAME TO ${transientName}`);
  db.exec(`
    CREATE TABLE evo_assets (
      id                  TEXT PRIMARY KEY,
      kind                TEXT NOT NULL
                            CHECK (kind IN (
                              'mesh', 'texture', 'material', 'hdri', 'sprite',
                              'creature', 'item', 'skill', 'drop', 'craft', 'species',
                              'blueprint'
                            )),
      source              TEXT NOT NULL CHECK (source IN (${sourceList})),
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
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      cdn_url             TEXT,
      train_consented     INTEGER NOT NULL DEFAULT 1
    )
  `);
  db.exec(`
    INSERT INTO evo_assets (
      id, kind, source, source_id, local_path, category, tags_json,
      quality_level, evolution_score, interaction_points,
      last_evolved_at, last_interacted_at, archived_at,
      canonical_dtu_id, created_at, cdn_url, train_consented
    )
    SELECT
      id, kind, source, source_id, local_path, category, tags_json,
      quality_level, evolution_score, interaction_points,
      last_evolved_at, last_interacted_at, archived_at,
      canonical_dtu_id, created_at, ${hasCdn ? "cdn_url" : "NULL"}, ${hasTrain ? "train_consented" : "1"}
    FROM ${transientName}
  `);

  // Rows written under 448's loosened interactions schema would abort 275's
  // stricter copy; normalize them to the original contract first.
  if (tableExists(db, "evo_asset_interactions")) {
    db.exec(`
      UPDATE evo_asset_interactions SET weight = 1.0 WHERE weight IS NULL;
      UPDATE evo_asset_interactions SET action = 'unknown' WHERE action IS NULL;
      UPDATE evo_asset_interactions SET actor_kind = 'system'
        WHERE actor_kind IS NULL OR actor_kind NOT IN ('user', 'npc', 'system');
    `);
    if (columnExists(db, "evo_asset_interactions", "ts")) {
      db.exec(`UPDATE evo_asset_interactions SET ts = unixepoch() WHERE ts IS NULL`);
    }
  }

  repairEvoAssetFks(db); // re-point children BEFORE the drop
  db.exec(`DROP TABLE ${transientName}`);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_quality   ON evo_assets(quality_level DESC, interaction_points DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_kind      ON evo_assets(kind, archived_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_source    ON evo_assets(source, source_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_canonical ON evo_assets(canonical_dtu_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_train     ON evo_assets(train_consented) WHERE train_consented = 1`);
  return true;
}
