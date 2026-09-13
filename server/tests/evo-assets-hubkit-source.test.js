import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up373 } from "../migrations/373_evo_assets_github_source.js";
import { up as up446 } from "../migrations/446_evo_assets_hubkit_source.js";

describe("migration 446 hubkit source", () => {
  it("admits hubkit without dropping github", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE evo_assets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('mesh','texture','material','hdri','sprite','creature','item','skill','drop','craft','species','blueprint')),
        source TEXT NOT NULL CHECK (source IN (
          'kenney', 'polyhaven', 'ambientcg', 'os3a', 'sketchfab',
          'authored', 'evolved', 'concordia', 'github'
        )),
        source_id TEXT,
        local_path TEXT,
        category TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        quality_level INTEGER NOT NULL DEFAULT 0,
        evolution_score REAL NOT NULL DEFAULT 0,
        interaction_points INTEGER NOT NULL DEFAULT 0,
        last_evolved_at INTEGER,
        last_interacted_at INTEGER,
        archived_at INTEGER,
        canonical_dtu_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
    db.prepare(`INSERT INTO evo_assets (id, kind, source, local_path) VALUES ('e1','mesh','github','x')`).run();
    await up373(db);
    await up446(db);
    db.prepare(`INSERT INTO evo_assets (id, kind, source, local_path) VALUES ('e2','mesh','hubkit','StreamingAssets/HubKit/a.glb')`).run();
    const github = db.prepare(`SELECT source FROM evo_assets WHERE id = 'e1'`).get();
    const hubkit = db.prepare(`SELECT source FROM evo_assets WHERE id = 'e2'`).get();
    assert.equal(github.source, "github");
    assert.equal(hubkit.source, "hubkit");
  });
});
