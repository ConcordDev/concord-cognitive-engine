// server/migrations/275_evo_asset_fk_repair.js
//
// Repair dangling foreign keys left by migration 202. That migration rebuilt
// `evo_assets` via RENAME→create-new→drop-old, but `PRAGMA legacy_alter_table`
// is a no-op inside the migration transaction, so the RENAME rewrote the FK
// targets in `evo_asset_interactions` and `evo_asset_versions` to the transient
// `evo_assets_v2` table — which 202 then dropped. The FKs now point at a
// non-existent table, so any INSERT into those tables throws
// "no such table: evo_assets_v2" whenever foreign_keys=ON.
//
// Fix: rebuild both child tables with the FK pointing back at `evo_assets`.
// Idempotent — skips a table whose FK already resolves correctly. Copies only
// rows whose asset_id still exists so the rebuild can't itself trip an FK.

function fkTarget(db, table) {
  try {
    const fks = db.pragma(`foreign_key_list(${table})`);
    const assetFk = fks.find((f) => f.from === "asset_id");
    return assetFk?.table ?? null;
  } catch { return null; }
}

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  // ── evo_assets.train_consented ──────────────────────────────────────────
  // Migration 108 added train_consented (platform default 1) to evo_assets,
  // but migration 202's table rebuild dropped it (its CREATE TABLE omitted the
  // column). Restore it idempotently so the lattice train-consent invariant
  // holds.
  if (tableExists(db, "evo_assets") && !columnExists(db, "evo_assets", "train_consented")) {
    db.exec(`ALTER TABLE evo_assets ADD COLUMN train_consented INTEGER NOT NULL DEFAULT 1`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evo_assets_train ON evo_assets(train_consented) WHERE train_consented = 1`);
  }

  // ── evo_asset_interactions ──────────────────────────────────────────────
  if (tableExists(db, "evo_asset_interactions") && fkTarget(db, "evo_asset_interactions") !== "evo_assets") {
    db.exec(`
      CREATE TABLE evo_asset_interactions_fix (
        id          TEXT PRIMARY KEY,
        asset_id    TEXT NOT NULL,
        actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('user', 'npc', 'system')),
        actor_id    TEXT,
        action      TEXT NOT NULL,
        weight      REAL NOT NULL DEFAULT 1.0,
        ts          INTEGER NOT NULL DEFAULT (unixepoch()),
        train_consented INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (asset_id) REFERENCES evo_assets(id) ON DELETE CASCADE
      );
      INSERT INTO evo_asset_interactions_fix
        (id, asset_id, actor_kind, actor_id, action, weight, ts, train_consented)
        SELECT id, asset_id, actor_kind, actor_id, action, weight, ts, train_consented
        FROM evo_asset_interactions
        WHERE asset_id IN (SELECT id FROM evo_assets);
      DROP TABLE evo_asset_interactions;
      ALTER TABLE evo_asset_interactions_fix RENAME TO evo_asset_interactions;
      CREATE INDEX IF NOT EXISTS idx_evo_asset_interactions_asset
        ON evo_asset_interactions(asset_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_evo_asset_interactions_train
        ON evo_asset_interactions(train_consented) WHERE train_consented = 1;
    `);
  }

  // ── evo_asset_versions ──────────────────────────────────────────────────
  if (tableExists(db, "evo_asset_versions") && fkTarget(db, "evo_asset_versions") !== "evo_assets") {
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
      );
      INSERT INTO evo_asset_versions_fix
        (id, asset_id, version_number, pass_kind, local_path, promoted,
         gate_dtu_id, gate_verdict, diff_summary, created_at, promoted_at, cdn_url)
        SELECT id, asset_id, version_number, pass_kind, local_path, promoted,
               gate_dtu_id, gate_verdict, diff_summary, created_at, promoted_at, cdn_url
        FROM evo_asset_versions
        WHERE asset_id IN (SELECT id FROM evo_assets);
      DROP TABLE evo_asset_versions;
      ALTER TABLE evo_asset_versions_fix RENAME TO evo_asset_versions;
      CREATE INDEX IF NOT EXISTS idx_evo_asset_versions_asset
        ON evo_asset_versions(asset_id, version_number DESC);
    `);
  }
}

export function down() {
  // Forward-only: the FK repair is strictly corrective; there is no sane
  // rollback to the dangling-FK state.
}
