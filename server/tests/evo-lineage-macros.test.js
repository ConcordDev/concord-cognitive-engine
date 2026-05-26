// server/tests/evo-lineage-macros.test.js
//
// Verifies the four evo-asset macros (asset-stats, list-variants,
// lineage-for, recent-promotions) return correctly-shaped responses
// against the schema declared in migrations 073 + 100. Before this
// commit no macros existed for the evo registry — the procgen + evo
// cycle was invisible to the frontend.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerEvoMacros from "../domains/evo.js";

let db, macros;

function register(domain, name, handler) {
  macros[`${domain}.${name}`] = handler;
}

function call(name, params) {
  const ctx = { db };
  return macros[name](ctx, null, params);
}

before(() => {
  db = new Database(":memory:");
  // Schema mirror — only the columns the macros read. Stays in sync with
  // migrations 073 + 100 (`evo_assets` + `evo_asset_versions`).
  db.exec(`
    CREATE TABLE evo_assets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT,
      local_path TEXT NOT NULL,
      category TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      quality_level INTEGER NOT NULL DEFAULT 0,
      evolution_score REAL NOT NULL DEFAULT 0,
      interaction_points INTEGER NOT NULL DEFAULT 0,
      last_evolved_at INTEGER,
      last_interacted_at INTEGER,
      canonical_dtu_id TEXT,
      archived_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE evo_asset_versions (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      pass_kind TEXT NOT NULL,
      local_path TEXT NOT NULL,
      promoted INTEGER NOT NULL DEFAULT 0,
      gate_dtu_id TEXT,
      gate_verdict TEXT,
      diff_summary TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      promoted_at INTEGER
    );
  `);
  macros = {};
  registerEvoMacros(register);

  // Seed: 2 authored seeds + 1 from polyhaven, 3 versions on one seed.
  db.prepare(`INSERT INTO evo_assets (id, kind, source, local_path, category) VALUES
    ('seed_oak',   'mesh',    'authored',  'content/.../oak.glb',   'tree'),
    ('seed_rock',  'mesh',    'authored',  'content/.../rock.glb',  'rock'),
    ('seed_grass', 'texture', 'polyhaven', 'content/.../grass.png', 'ground')
  `).run();
  db.prepare(`INSERT INTO evo_asset_versions (id, asset_id, version_number, pass_kind, local_path, promoted, promoted_at) VALUES
    ('v1', 'seed_oak', 1, 'detail_maps',         'content/.../oak.v1.glb', 1, 1000),
    ('v2', 'seed_oak', 2, 'procedural_wear',     'content/.../oak.v2.glb', 1, 2000),
    ('v3', 'seed_oak', 3, 'authored_replacement','content/.../oak.v3.glb', 0, NULL),
    ('v4', 'seed_rock', 1, 'subdivision',        'content/.../rock.v1.glb',1, 1500)
  `).run();
});

after(() => { db?.close(); });

describe("evo.asset-stats", () => {
  it("returns total + bySource + byKind + recentPromotions", () => {
    const r = call("evo.asset-stats", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 3);
    assert.deepEqual(r.result.bySource.map(x => x.source).sort(), ["authored", "polyhaven"]);
    assert.deepEqual(r.result.byKind.map(x => x.kind).sort(), ["mesh", "texture"]);
    assert.equal(r.result.recentPromotions.length, 3);
    // Most recent promotion first (v2 at promoted_at=2000)
    assert.equal(r.result.recentPromotions[0].version_id, "v2");
  });
});

describe("evo.list-variants", () => {
  it("returns all versions of one asset newest-first", () => {
    const r = call("evo.list-variants", { assetId: "seed_oak" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalVariants, 3);
    assert.equal(r.result.versions[0].version_number, 3);
    assert.equal(r.result.versions[2].version_number, 1);
    assert.equal(r.result.asset.id, "seed_oak");
  });

  it("rejects missing assetId", () => {
    const r = call("evo.list-variants", {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "assetId_required");
  });

  it("404s on unknown asset", () => {
    const r = call("evo.list-variants", { assetId: "does_not_exist" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "asset_not_found");
  });
});

describe("evo.lineage-for", () => {
  it("returns seed at depth 0 + promoted versions ordered by version_number", () => {
    const r = call("evo.lineage-for", { assetId: "seed_oak" });
    assert.equal(r.ok, true);
    // 2 promoted versions + 1 seed = 3 entries
    assert.equal(r.result.lineageDepth, 2);
    assert.equal(r.result.lineage.length, 3);
    assert.equal(r.result.lineage[0].isSeed, true);
    assert.equal(r.result.lineage[0].depth, 0);
    assert.equal(r.result.lineage[1].versionNumber, 1);
    assert.equal(r.result.lineage[2].versionNumber, 2);
    // Non-promoted v3 is omitted from lineage
    assert.ok(!r.result.lineage.some(x => x.versionNumber === 3));
  });

  it("seed with no promoted versions returns depth 0", () => {
    const r = call("evo.lineage-for", { assetId: "seed_grass" });
    assert.equal(r.ok, true);
    assert.equal(r.result.lineageDepth, 0);
    assert.equal(r.result.lineage[0].isSeed, true);
  });
});

describe("evo.recent-promotions", () => {
  it("returns globally-recent promoted versions ordered desc", () => {
    const r = call("evo.recent-promotions", { limit: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);
    // promoted_at desc: v2 (2000) → v4 (1500) → v1 (1000)
    assert.equal(r.result.promotions[0].version_id, "v2");
    assert.equal(r.result.promotions[1].version_id, "v4");
    assert.equal(r.result.promotions[2].version_id, "v1");
  });

  it("clamps limit to [1, 100]", () => {
    // Negative explicit limit clamps to 1.
    const tooSmall = call("evo.recent-promotions", { limit: -5 });
    assert.equal(tooSmall.result.count, 1);
    const tooLarge = call("evo.recent-promotions", { limit: 9999 });
    assert.equal(tooLarge.result.count, 3); // only 3 promoted exist
  });
});
