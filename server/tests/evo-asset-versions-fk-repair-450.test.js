import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up448 } from "../migrations/448_evo_assets_hubkit_source.js";
import { up as up450 } from "../migrations/450_evo_asset_versions_fk_repair_448.js";

// Mirrors the pre-448 live schema: evo_assets without 'hubkit' in its CHECK,
// and both child tables FK'd to evo_assets.
function seedPre448(db) {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE evo_assets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('mesh','texture','material','hdri','sprite','creature','item','skill','drop','craft','species','blueprint')),
      source TEXT NOT NULL CHECK (source IN ('kenney','polyhaven','ambientcg','os3a','sketchfab','authored','evolved','concordia','github')),
      source_id TEXT, local_path TEXT, category TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      quality_level INTEGER NOT NULL DEFAULT 0,
      evolution_score REAL NOT NULL DEFAULT 0,
      interaction_points INTEGER NOT NULL DEFAULT 0,
      last_evolved_at INTEGER, last_interacted_at INTEGER, archived_at INTEGER,
      canonical_dtu_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      cdn_url TEXT,
      train_consented INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE evo_asset_interactions (
      id TEXT PRIMARY KEY, asset_id TEXT NOT NULL,
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','npc','system')),
      actor_id TEXT, action TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0,
      ts INTEGER NOT NULL DEFAULT (unixepoch()),
      train_consented INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (asset_id) REFERENCES evo_assets(id) ON DELETE CASCADE
    );
    CREATE TABLE evo_asset_versions (
      id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, version_number INTEGER NOT NULL,
      pass_kind TEXT NOT NULL CHECK (pass_kind IN ('subdivision','detail_maps','material_upgrade','procedural_wear','higher_lod','authored_replacement')),
      local_path TEXT NOT NULL, promoted INTEGER NOT NULL DEFAULT 0,
      gate_dtu_id TEXT, gate_verdict TEXT, diff_summary TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      promoted_at INTEGER, cdn_url TEXT,
      FOREIGN KEY (asset_id) REFERENCES evo_assets(id) ON DELETE CASCADE
    );
  `);
}

// runMigrations (server/migrate.js) wraps each up() in db.transaction(),
// which is what makes 448's legacy_alter_table pragma a no-op and lets the
// RENAME rewrite the child FK. Reproduce that exactly.
function runLikeMigrator(db, up) {
  db.transaction(() => { up(db); })();
}

function versionsFkTarget(db) {
  return db.pragma("foreign_key_list(evo_asset_versions)").find((f) => f.from === "asset_id")?.table;
}

function insertVersion(db, assetId) {
  db.prepare(`
    INSERT INTO evo_asset_versions (id, asset_id, version_number, pass_kind, local_path)
    VALUES (?, ?, 1, 'authored_replacement', 'data/evo-assets/generated/x.glb')
  `).run(`v-${assetId}`, assetId);
}

describe("migration 450 evo_asset_versions FK repair", () => {
  it("448 alone leaves evo_asset_versions pointing at the dropped evo_assets_v4", () => {
    const db = new Database(":memory:");
    seedPre448(db);
    runLikeMigrator(db, up448);
    db.prepare(`INSERT INTO evo_assets (id, kind, source, local_path) VALUES ('a1','mesh','authored','x')`).run();
    assert.equal(versionsFkTarget(db), "evo_assets_v4");
    assert.throws(() => insertVersion(db, "a1"), /evo_assets_v4/);
  });

  it("450 re-points the FK at evo_assets so a generated asset version registers", () => {
    const db = new Database(":memory:");
    seedPre448(db);
    runLikeMigrator(db, up448);
    runLikeMigrator(db, up450);
    db.prepare(`INSERT INTO evo_assets (id, kind, source, local_path) VALUES ('a1','mesh','authored','x')`).run();
    assert.equal(versionsFkTarget(db), "evo_assets");
    insertVersion(db, "a1");
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM evo_asset_versions`).get().n, 1);
  });

  it("450 still enforces the FK (an orphan version is rejected) and is idempotent", () => {
    const db = new Database(":memory:");
    seedPre448(db);
    runLikeMigrator(db, up448);
    runLikeMigrator(db, up450);
    runLikeMigrator(db, up450);
    assert.throws(() => insertVersion(db, "missing"), /FOREIGN KEY/);
  });
});
