// server/migrations/202_evo_assets_blueprint_kind.js
//
// Phase II Wave 12 — extend the evo_assets CHECK constraint to admit
// 'blueprint' as a registerable kind so whiteboard.publish-as-blueprint
// can register player-authored interior layouts.
//
// Same idempotent table-rename approach as migration 100. Pre-existing
// rows are preserved; the only change is the kind enumeration accepts
// one more value.

export async function up(db) {
  // Skip if the new kind is already accepted (re-run safety)
  try {
    const probe = db.prepare(`
      INSERT INTO evo_assets (id, kind, source, source_id, local_path)
      VALUES ('__probe_blueprint__', 'blueprint', 'authored', '__probe_blueprint__', 'probe')
    `);
    probe.run();
    db.prepare(`DELETE FROM evo_assets WHERE id = '__probe_blueprint__'`).run();
    return; // CHECK already accepts blueprint; nothing to do
  } catch {
    // CHECK rejected — proceed with rename
  }

  const fkBefore  = db.pragma("foreign_keys", { simple: true });
  const altBefore = db.pragma("legacy_alter_table", { simple: true });
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");

  try {
    db.exec("ALTER TABLE evo_assets RENAME TO evo_assets_v2");

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
      FROM evo_assets_v2
    `);

    db.exec("DROP TABLE evo_assets_v2");

    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_quality   ON evo_assets(quality_level DESC, interaction_points DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_kind      ON evo_assets(kind, archived_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_source    ON evo_assets(source, source_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_canonical ON evo_assets(canonical_dtu_id)`);
  } finally {
    db.pragma(`legacy_alter_table = ${altBefore ? "ON" : "OFF"}`);
    db.pragma(`foreign_keys = ${fkBefore ? "ON" : "OFF"}`);
  }
}

export const description = "Phase II Wave 12 — admit 'blueprint' as an evo_assets kind for whiteboard publish path";
