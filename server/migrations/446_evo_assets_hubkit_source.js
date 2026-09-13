// server/migrations/446_evo_assets_hubkit_source.js
//
// Admit 'hubkit' as an evo_assets source. HubKit stems are a committed
// StreamingAssets catalog (MANIFEST.json), not Kenney CC0, not Concord-authored
// geometry. Stamping them as 'kenney' was a CHECK workaround. Same
// RENAME→CREATE→DROP shape as 373, but the CREATE keeps cdn_url +
// train_consented so this rebuild does not repeat 373's column drops.
// Child FKs that SQLite rewrites onto evo_assets_v4 are repaired in-file.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

function fkTarget(db, table) {
  try {
    const fks = db.pragma(`foreign_key_list(${table})`);
    const assetFk = fks.find((f) => f.from === "asset_id");
    return assetFk?.table ?? null;
  } catch { return null; }
}

export async function up(db) {
  if (!tableExists(db, "evo_assets")) return;

  try {
    const probe = db.prepare(`
      INSERT INTO evo_assets (id, kind, source, source_id, local_path)
      VALUES ('__probe_hubkit__', 'mesh', 'hubkit', '__probe_hubkit__', 'probe')
    `);
    probe.run();
    db.prepare(`DELETE FROM evo_assets WHERE id = '__probe_hubkit__'`).run();
    return;
  } catch {
    // CHECK rejected — rebuild
  }

  const hasCdn = columnExists(db, "evo_assets", "cdn_url");
  const hasTrain = columnExists(db, "evo_assets", "train_consented");

  const fkBefore = db.pragma("foreign_keys", { simple: true });
  const altBefore = db.pragma("legacy_alter_table", { simple: true });
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");

  try {
    db.exec("ALTER TABLE evo_assets RENAME TO evo_assets_v4");

    db.exec(`
      CREATE TABLE evo_assets (
        id                  TEXT PRIMARY KEY,
        kind                TEXT NOT NULL
                              CHECK (kind IN (
                                'mesh', 'texture', 'material', 'hdri', 'sprite',
                                'creature', 'item', 'skill', 'drop', 'craft', 'species',
                                'blueprint'
                              )),
        source              TEXT NOT NULL
                              CHECK (source IN (
                                'kenney', 'polyhaven', 'ambientcg', 'os3a', 'sketchfab',
                                'authored', 'evolved', 'concordia', 'github', 'hubkit'
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
        created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
        cdn_url             TEXT,
        train_consented     INTEGER NOT NULL DEFAULT 1
      )
    `);

    const cdnSelect = hasCdn ? "cdn_url" : "NULL";
    const trainSelect = hasTrain ? "train_consented" : "1";
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
        canonical_dtu_id, created_at, ${cdnSelect}, ${trainSelect}
      FROM evo_assets_v4
    `);

    db.exec("DROP TABLE evo_assets_v4");

    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_quality   ON evo_assets(quality_level DESC, interaction_points DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_kind      ON evo_assets(kind, archived_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_source    ON evo_assets(source, source_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_canonical ON evo_assets(canonical_dtu_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_train     ON evo_assets(train_consented) WHERE train_consented = 1`);
  } finally {
    db.pragma(`legacy_alter_table = ${altBefore ? "ON" : "OFF"}`);
    db.pragma(`foreign_keys = ${fkBefore ? "ON" : "OFF"}`);
  }

  if (tableExists(db, "evo_asset_interactions") && fkTarget(db, "evo_asset_interactions") !== "evo_assets") {
    const hasTs = columnExists(db, "evo_asset_interactions", "ts");
    const hasTrainI = columnExists(db, "evo_asset_interactions", "train_consented");
    db.exec(`
      CREATE TABLE evo_asset_interactions_fix (
        id          TEXT PRIMARY KEY,
        asset_id    TEXT NOT NULL,
        actor_kind  TEXT,
        actor_id    TEXT,
        action      TEXT,
        weight      REAL,
        ts          INTEGER NOT NULL DEFAULT (unixepoch()),
        train_consented INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (asset_id) REFERENCES evo_assets(id) ON DELETE CASCADE
      );
      INSERT INTO evo_asset_interactions_fix
        (id, asset_id, actor_kind, actor_id, action, weight, ts, train_consented)
        SELECT id, asset_id, actor_kind, actor_id, action, weight,
               ${hasTs ? "ts" : "unixepoch()"},
               ${hasTrainI ? "train_consented" : "1"}
        FROM evo_asset_interactions
        WHERE asset_id IN (SELECT id FROM evo_assets);
      DROP TABLE evo_asset_interactions;
      ALTER TABLE evo_asset_interactions_fix RENAME TO evo_asset_interactions;
    `);
  }
}

export const description = "Admit 'hubkit' as an evo_assets source for committed HubKit MANIFEST stems";
