// server/migrations/451_evo_assets_meshy_tripo_source.js
//
// Admit 'meshy' and 'tripo' as evo_assets sources. Both are external
// text/image-to-3D services that now produce real Concordia assets
// (Models/Meshy/{fauna,bosses}/, Generated_Models/ via AuraForUnity's Tripo
// integration). Stamping them 'authored' or 'evolved' would misstate
// provenance — the same CHECK workaround 448 retired for HubKit.
//
// Same RENAME→CREATE→COPY shape as 448, with the ORDER changed, because
// runMigrations wraps up() in a transaction where PRAGMA foreign_keys and
// PRAGMA legacy_alter_table are silent no-ops:
//   - the RENAME rewrites both child FKs onto the transient evo_assets_v5;
//   - so DROPping evo_assets_v5 while children still point at it fires
//     ON DELETE CASCADE and deletes every child row (a dry run on a copy of
//     the live tables lost the one evo_asset_versions row exactly this way).
// So the children are re-pointed at the new evo_assets FIRST (275's
// idempotent repair, which copies every row whose asset exists — all of
// them, since the new table already holds every id), and only then is the
// transient table dropped, with nothing referencing it.

import { up as repairEvoAssetFks } from "./275_evo_asset_fk_repair.js";

const SOURCES = [
  "kenney", "polyhaven", "ambientcg", "os3a", "sketchfab",
  "authored", "evolved", "concordia", "github", "hubkit",
  "meshy", "tripo",
];

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

export function up(db) {
  if (!tableExists(db, "evo_assets")) return;
  if (acceptsSource(db, "meshy") && acceptsSource(db, "tripo")) return;

  const hasCdn = columnExists(db, "evo_assets", "cdn_url");
  const hasTrain = columnExists(db, "evo_assets", "train_consented");
  const sourceList = SOURCES.map((s) => `'${s}'`).join(", ");

  db.exec("ALTER TABLE evo_assets RENAME TO evo_assets_v5");
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
    FROM evo_assets_v5
  `);

  // 448 rebuilt evo_asset_interactions with a loosened schema (nullable
  // weight/action, no actor_kind CHECK). 275's repair restores the original
  // contract (NOT NULL + CHECK), so rows written under 448's looser shape
  // would abort the copy. Normalize them to the original defaults first.
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

  // Re-point both children at the new table BEFORE the drop (see header).
  repairEvoAssetFks(db);
  db.exec("DROP TABLE evo_assets_v5");

  db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_quality   ON evo_assets(quality_level DESC, interaction_points DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_kind      ON evo_assets(kind, archived_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_source    ON evo_assets(source, source_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_canonical ON evo_assets(canonical_dtu_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_train     ON evo_assets(train_consented) WHERE train_consented = 1`);
}

export function down() {
  // Forward-only: narrowing the CHECK back would reject existing meshy/tripo rows.
}

export const description = "Admit 'meshy' and 'tripo' as evo_assets sources; re-point both child FKs";
