/**
 * bootstrapWorldLensAssets — registers the real, licensed World Lens assets
 * sourced this session (weapons/terrain/buildings/vegetation/creatures/hero
 * archetypes, see concord-frontend/public/models/CREDITS.md +
 * concord-frontend/public/meshes/heroes/CREDITS.md) into the evo-asset
 * registry, so the interaction-tracking + refinement-pass scheduler has real
 * reference material instead of only the 3 CC0 primitive placeholder meshes.
 *
 * Run: node --test tests/integration/evo-asset-world-lens-seed.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up073 } from "../../migrations/073_evo_assets.js";
import { up as up084 } from "../../migrations/084_evo_asset_cdn_urls.js";
import { up as up100 } from "../../migrations/100_evo_assets_gameplay_kinds.js";
import { up as up202 } from "../../migrations/202_evo_assets_blueprint_kind.js";
import { up as up373 } from "../../migrations/373_evo_assets_github_source.js";

import { bootstrapWorldLensAssets, bootstrapAllSources } from "../../lib/evo-asset/source-loaders.js";
import { selectEvolutionCandidates } from "../../lib/evo-asset/registry.js";

function setupDb() {
  const db = new Database(":memory:");
  for (const up of [up073, up084, up100, up202, up373]) {
    try { up(db); } catch { /* later migrations may add optional cols only */ }
  }
  return db;
}

describe("evo-asset world-lens seed", () => {
  it("registers the real terrain/weapon/building/vegetation/creature/hero assets with source='github'", () => {
    const db = setupDb();
    const stats = bootstrapWorldLensAssets(db);
    // 7 terrain + 15 weapons + 3 buildings + 6 vegetation + 4 creatures + 7 hero archetypes = 42
    assert.ok(stats.found >= 40, `expected >= 40 real files found on disk, got ${stats.found}`);
    assert.equal(stats.registered, stats.found, "every found file should register on a fresh DB");

    const rows = db.prepare(`SELECT * FROM evo_assets WHERE source = 'github'`).all();
    assert.equal(rows.length, stats.registered);
    for (const row of rows) {
      assert.ok(row.source_id.startsWith("world-lens:"), "sourceId should be namespaced world-lens:");
      assert.ok(row.quality_level >= 4, "real licensed assets should register above the CC0-primitive floor (1)");
      assert.ok(row.local_path.length > 0, "local_path must be populated");
    }
  });

  it("is idempotent — re-seeding registers nothing new", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    const second = bootstrapWorldLensAssets(db);
    assert.equal(second.registered, 0, "re-seed must not duplicate rows");
  });

  it("the club.glb CC-BY-3.0 asset carries an attribution-required tag, not silently dropped as CC0", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    const club = db.prepare(`SELECT * FROM evo_assets WHERE source_id = 'world-lens:models/weapon/club.glb'`).get();
    assert.ok(club, "club.glb should be registered");
    const tags = JSON.parse(club.tags_json);
    assert.ok(tags.includes("cc-by-3.0"));
    assert.ok(tags.includes("attribution-required"));
    assert.ok(!tags.includes("cc0"), "club.glb is NOT CC0 — must not be mislabeled");
  });

  it("registers only the 7 universal hero-archetype slots, not the ~46 per-world variants", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    const heroRows = db.prepare(`SELECT * FROM evo_assets WHERE category = 'hero-archetype'`).all();
    assert.equal(heroRows.length, 7, "exactly the 7 universal archetype slots");
    for (const row of heroRows) {
      assert.ok(!row.source_id.includes("__"), "per-world variant files (double-underscore suffix) must not be registered");
    }
  });

  it("gracefully returns an empty result when the manifest directory doesn't exist", () => {
    const db = setupDb();
    const stats = bootstrapWorldLensAssets(db, "/nonexistent/path/xyz");
    assert.deepEqual(stats, { found: 0, registered: 0 });
  });

  it("bootstrapAllSources folds world-lens assets into the total floor", async () => {
    const db = setupDb();
    const result = await bootstrapAllSources(db);
    assert.ok(result.worldLensAssets, "bootstrapAllSources should report a worldLensAssets stat");
    assert.ok(result.worldLensAssets.registered >= 40, "world-lens assets should be part of the boot-time floor");
    assert.ok(result.total >= 40 + 3, "total should include both the primitive seed and the real world-lens assets");
  });

  it("real world-lens assets are real evolution candidates", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    const candidates = selectEvolutionCandidates(db, 50);
    assert.ok(candidates.length >= 40, "the scheduler should see the real assets as candidates");
  });
});
