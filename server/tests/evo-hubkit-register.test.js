import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { registerHubKitEvo, hubKitManifestPath } from "../lib/evo-hubkit-register.js";

describe("registerHubKitEvo", () => {
  it("finds the committed HubKit manifest", () => {
    assert.ok(hubKitManifestPath());
  });

  it("inserts Kenney stems into evo_assets without a hubkit source tag", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE evo_assets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN (
          'kenney', 'polyhaven', 'ambientcg', 'os3a', 'sketchfab',
          'authored', 'evolved', 'concordia', 'github'
        )),
        source_id TEXT,
        local_path TEXT,
        category TEXT
      );
    `);
    const r = registerHubKitEvo(db);
    assert.equal(r.ok, true);
    assert.ok(r.inserted > 0);
    const row = db.prepare(`SELECT source, category FROM evo_assets WHERE id LIKE 'evo_hubkit_%' LIMIT 1`).get();
    assert.equal(row.source, "kenney");
    assert.equal(row.category, "hub");
    const again = registerHubKitEvo(db);
    assert.equal(again.inserted, 0);
    assert.ok(again.known > 0);
  });
});
