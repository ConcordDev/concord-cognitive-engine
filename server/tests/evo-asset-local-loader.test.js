// server/tests/evo-asset-local-loader.test.js
//
// Verifies the bootstrapAuthoredLocal scanner picks up dropped files
// under content/world/_shared/{models,textures,hdris}/ and registers
// them as `source='authored'` with the correct kind classification.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { bootstrapAuthoredLocal, bootstrapQuaterniusFromDir } from "../lib/evo-asset/source-loaders.js";

let TMP, db;

function fakeAsset(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "fake-binary-content");
}

before(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "concord-evo-loader-"));
  // Schema-only copy of the evo_assets table (matches migration 100).
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE evo_assets (
      id            TEXT PRIMARY KEY,
      kind          TEXT NOT NULL,
      source        TEXT NOT NULL,
      source_id     TEXT,
      local_path    TEXT NOT NULL,
      category      TEXT,
      tags_json     TEXT,
      quality_level INTEGER DEFAULT 0,
      interaction_points INTEGER DEFAULT 0,
      canonical_dtu_id TEXT,
      archived_at   INTEGER
    );
    CREATE INDEX idx_evo_assets_source ON evo_assets(source, source_id);
  `);
});

after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  db?.close();
});

describe("bootstrapAuthoredLocal", () => {
  it("registers a .glb under models/ as kind='mesh'", async () => {
    fakeAsset(path.join(TMP, "models", "trees", "oak.glb"));
    const r = await bootstrapAuthoredLocal(db, { dir: TMP });
    assert.equal(r.registered, 1);
    assert.equal(r.byKind.mesh, 1);
    const row = db.prepare(`SELECT * FROM evo_assets WHERE source = 'authored'`).get();
    assert.equal(row.kind, "mesh");
    assert.equal(row.category, "models");
    assert.ok(row.local_path.endsWith("oak.glb"));
    assert.ok(row.source_id.startsWith("local:"));
  });

  it("classifies textures, hdris correctly by directory + extension", async () => {
    fakeAsset(path.join(TMP, "textures", "stone", "cobble_albedo.png"));
    fakeAsset(path.join(TMP, "hdris", "sky", "clear_noon.hdr"));
    fakeAsset(path.join(TMP, "materials", "metal", "brass.json"));
    fakeAsset(path.join(TMP, "sprites", "particle.png"));
    const r = await bootstrapAuthoredLocal(db, { dir: TMP });
    // models/oak.glb already registered last test; new this run:
    // textures × 1, hdris × 1, sprites × 1. materials .json is skipped
    // (we don't classify .json by ext; materials must contain actual maps).
    assert.equal(r.byKind.texture, 1);
    assert.equal(r.byKind.hdri, 1);
    assert.equal(r.byKind.sprite, 1);
  });

  it("is idempotent — re-running does not duplicate", async () => {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM evo_assets`).get().n;
    const r = await bootstrapAuthoredLocal(db, { dir: TMP });
    const after = db.prepare(`SELECT COUNT(*) AS n FROM evo_assets`).get().n;
    assert.equal(before, after);
    assert.equal(r.registered, 0);
    assert.ok(r.skipped >= before);
  });

  it("ignores unknown extensions (e.g. .txt LICENSE files)", async () => {
    fakeAsset(path.join(TMP, "models", "LICENSE.txt"));
    const before = db.prepare(`SELECT COUNT(*) AS n FROM evo_assets`).get().n;
    const r = await bootstrapAuthoredLocal(db, { dir: TMP });
    const after = db.prepare(`SELECT COUNT(*) AS n FROM evo_assets`).get().n;
    assert.equal(after - before, 0, "LICENSE.txt should not register");
    // found doesn't count .txt (regex filters them out at walk time).
  });

  it("non-existent directory returns clean empty result", async () => {
    const r = await bootstrapAuthoredLocal(db, { dir: "/tmp/concord-nonexistent-asset-dir-xyz" });
    assert.equal(r.found, 0);
    assert.equal(r.registered, 0);
  });
});

describe("bootstrapQuaterniusFromDir", () => {
  it("registers .glb files with quaternius: source-id prefix", async () => {
    const qDir = path.join(TMP, "_quaternius");
    fakeAsset(path.join(qDir, "stylized", "tree.glb"));
    fakeAsset(path.join(qDir, "stylized", "rock.glb"));
    const r = await bootstrapQuaterniusFromDir(db, qDir);
    assert.equal(r.registered, 2);
    const rows = db.prepare(`SELECT * FROM evo_assets WHERE source_id LIKE 'quaternius:%'`).all();
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.kind, "mesh");
      assert.equal(row.source, "authored");
      const tags = JSON.parse(row.tags_json);
      assert.ok(tags.includes("cc0"));
      assert.ok(tags.includes("quaternius"));
    }
  });
});
