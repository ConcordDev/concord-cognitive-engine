import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up448 } from "../migrations/448_evo_assets_hubkit_source.js";
import { up as up450 } from "../migrations/450_evo_asset_versions_fk_repair_448.js";
import { up as up451 } from "../migrations/451_evo_assets_meshy_tripo_source.js";
import { up as up452 } from "../migrations/452_evo_assets_trellis_source.js";
import { ensureEvoAssetSources } from "../migrations/_evo-assets-source-rebuild.js";

// Pre-448 live shape: no 'hubkit' in the CHECK, both children FK'd to evo_assets.
function seed(db) {
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

// runMigrations wraps each up() in db.transaction(); inside it PRAGMA
// foreign_keys / legacy_alter_table are no-ops. Tests must reproduce that
// or they pass while the live migration loses data.
const migrate = (db, up) => db.transaction(() => { up(db); })();
const fkTarget = (db, t) => db.pragma(`foreign_key_list(${t})`).find((f) => f.from === "asset_id")?.table;

function upTo450(db) {
  seed(db);
  migrate(db, up448);
  migrate(db, up450);
  db.prepare(`INSERT INTO evo_assets (id, kind, source, local_path, tags_json) VALUES ('a1','mesh','evolved','g.glb','["x"]')`).run();
  db.prepare(`INSERT INTO evo_asset_versions (id, asset_id, version_number, pass_kind, local_path) VALUES ('v1','a1',1,'authored_replacement','g.glb')`).run();
  db.prepare(`INSERT INTO evo_asset_interactions (id, asset_id, actor_kind, action) VALUES ('i1','a1','user','view')`).run();
}

describe("migration 451 meshy/tripo evo_assets sources", () => {
  it("admits meshy and tripo and keeps every existing source", () => {
    const db = new Database(":memory:");
    upTo450(db);
    migrate(db, up451);
    for (const source of ["meshy", "tripo", "hubkit", "github", "evolved"]) {
      db.prepare(`INSERT INTO evo_assets (id, kind, source, local_path) VALUES (?, 'mesh', ?, 'p')`).run(`n-${source}`, source);
    }
    assert.throws(() => db.prepare(`INSERT INTO evo_assets (id, kind, source, local_path) VALUES ('bad','mesh','made_up','p')`).run(), /CHECK/);
  });

  it("does not cascade-delete child rows when the transient table is dropped", () => {
    const db = new Database(":memory:");
    upTo450(db);
    migrate(db, up451);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM evo_asset_versions`).get().n, 1, "version row survives");
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM evo_asset_interactions`).get().n, 1, "interaction row survives");
    assert.deepEqual(db.prepare(`SELECT tags_json, local_path FROM evo_assets WHERE id='a1'`).get(), { tags_json: '["x"]', local_path: "g.glb" });
  });

  it("leaves both child FKs on evo_assets, no transient table, and is idempotent", () => {
    const db = new Database(":memory:");
    upTo450(db);
    migrate(db, up451);
    migrate(db, up451);
    assert.equal(fkTarget(db, "evo_asset_versions"), "evo_assets");
    assert.equal(fkTarget(db, "evo_asset_interactions"), "evo_assets");
    assert.equal(db.prepare(`SELECT name FROM sqlite_master WHERE name='evo_assets_v5'`).get(), undefined);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    assert.throws(() => db.prepare(`INSERT INTO evo_asset_versions (id, asset_id, version_number, pass_kind, local_path) VALUES ('orphan','nope',1,'authored_replacement','x')`).run(), /FOREIGN KEY/);
  });
});

describe("migration 452 trellis source (shared rebuild helper)", () => {
  it("admits trellis on top of 451 without losing rows or child rows", () => {
    const db = new Database(":memory:");
    upTo450(db);
    migrate(db, up451);
    db.prepare(`INSERT INTO evo_assets (id, kind, source, local_path) VALUES ('m1','mesh','meshy','m.glb')`).run();
    migrate(db, up452);
    db.prepare(`INSERT INTO evo_assets (id, kind, source, local_path) VALUES ('t1','mesh','trellis','t.glb')`).run();
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM evo_assets`).get().n, 3);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM evo_asset_versions`).get().n, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM evo_asset_interactions`).get().n, 1);
    assert.equal(fkTarget(db, "evo_asset_versions"), "evo_assets");
    assert.equal(db.prepare(`SELECT name FROM sqlite_master WHERE name='evo_assets_v6'`).get(), undefined);
    migrate(db, up452); // idempotent
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  });

  it("refuses a rebuild that would drop a source existing rows still use", () => {
    const db = new Database(":memory:");
    upTo450(db);
    migrate(db, up451);
    db.prepare(`INSERT INTO evo_assets (id, kind, source, local_path) VALUES ('m1','mesh','meshy','m.glb')`).run();
    assert.throws(
      () => db.transaction(() => ensureEvoAssetSources(db, ["evolved", "authored", "hubkit", "trellis"], "evo_assets_tmp"))(),
      /still in use: meshy/,
    );
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM evo_assets`).get().n, 2, "transaction rolled back, rows intact");
  });
});
