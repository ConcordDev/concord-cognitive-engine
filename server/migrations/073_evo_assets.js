// server/migrations/073_evo_assets.js
// EvoAsset Engine — assets that improve the longer the world runs.
//
// Three tables:
//   evo_assets             — registry of every mesh/texture/material/hdri.
//                            qualityLevel 0-10, evolutionScore, interactionPoints.
//                            Each row is a candidate; canonical state is in
//                            the linked Atlas DTU once promoted through the
//                            5-stage quality pipeline.
//   evo_asset_interactions — append-only usage log (player+npc).
//   evo_asset_versions     — every refinement pass writes a new version row;
//                            old versions archived (not deleted) for lineage
//                            and rollback if a refinement is later disputed.

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS evo_assets (
        id                  TEXT PRIMARY KEY,
        kind                TEXT NOT NULL
                              CHECK (kind IN ('mesh', 'texture', 'material', 'hdri', 'sprite')),
        source              TEXT NOT NULL
                              CHECK (source IN ('kenney', 'polyhaven', 'ambientcg', 'os3a', 'sketchfab', 'authored', 'evolved')),
        source_id           TEXT,
        local_path          TEXT NOT NULL,
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
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_quality ON evo_assets(quality_level DESC, interaction_points DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_kind ON evo_assets(kind, archived_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_source ON evo_assets(source, source_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_canonical ON evo_assets(canonical_dtu_id)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS evo_asset_interactions (
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
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_interactions_asset ON evo_asset_interactions(asset_id, ts DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_interactions_actor ON evo_asset_interactions(actor_kind, actor_id)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS evo_asset_versions (
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
        FOREIGN KEY (asset_id) REFERENCES evo_assets(id) ON DELETE CASCADE
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_versions_asset ON evo_asset_versions(asset_id, version_number DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_versions_promoted ON evo_asset_versions(promoted, asset_id)`);
  } catch (e) {
    if (!e?.message?.includes("already exists")) throw e;
  }
}
