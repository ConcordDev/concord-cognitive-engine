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
import { selectEvolutionCandidates, resolveCurrentBest } from "../../lib/evo-asset/registry.js";

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
    // 7 terrain + 15 weapons + 8 buildings (3 universal + forge/tower +
    // 3 per-world variants: market__crime, archive__sovereign-ruins,
    // tavern__concord-link-frontier) + 6 vegetation + 4 creatures +
    // 11 hero archetypes (7 universal + undead/zombie/wraith/lich) +
    // 5 furniture props (table/rug/shelf/cabinet/armchair) +
    // 3 world-dressing props (market_barrel/crate/pallet) = 59
    assert.ok(stats.found >= 59, `expected >= 59 real files found on disk, got ${stats.found}`);
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

  it("registers exactly the 11 universal hero-archetype slots (7 living + 4 undead), not per-world palette variants", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    // Scoped to source='github' — the primary provenance registration this
    // test is about. The concordia-alias row (see the "resolution alias"
    // describe block below) also carries category='hero-archetype', so an
    // unscoped count would double and this assertion would be testing the
    // alias mechanism by accident instead of the hero-slot dedup logic.
    //
    // 2026-08-08: grew from 7 to 11 — the 4 new undead/zombie/wraith/lich
    // archetypes (KayKit-Character-Pack-Skeletons-1.0, CC0) are genuinely
    // NEW universal archetype slots, not per-world palette variants of an
    // existing archetype (those still stay unregistered here, unchanged
    // rationale — same underlying mesh reused across worlds, not distinct
    // assets worth separate evolution tracking).
    const heroRows = db.prepare(`SELECT * FROM evo_assets WHERE category = 'hero-archetype' AND source = 'github'`).all();
    assert.equal(heroRows.length, 11, "exactly the 11 universal archetype slots (7 living + 4 undead)");
    for (const row of heroRows) {
      assert.ok(!row.source_id.includes("__"), "per-world variant files (double-underscore suffix) must not be registered");
    }
  });

  it("registers the 4 new undead hero archetypes with real CC0 KayKit-Character-Pack-Skeletons provenance", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    for (const key of ["undead", "zombie", "wraith", "lich"]) {
      const row = db.prepare(`SELECT * FROM evo_assets WHERE source_id = ?`).get(`world-lens:meshes/heroes/_archetype_${key}.glb`);
      assert.ok(row, `${key} archetype should be registered`);
      assert.equal(row.category, "hero-archetype");
      const tags = JSON.parse(row.tags_json);
      assert.ok(tags.includes("cc0"));
      assert.ok(tags.includes("undead") || key === "undead", `${key} row should carry the undead tag`);
    }
  });

  it("registers the 3 new per-world building variants, distinct rows from their universal counterpart", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    const variant = db.prepare(`SELECT * FROM evo_assets WHERE source_id = 'world-lens:models/building/market__crime.glb'`).get();
    const universal = db.prepare(`SELECT * FROM evo_assets WHERE source_id = 'world-lens:models/building/market.glb'`).get();
    assert.ok(variant, "market__crime.glb should be registered as its own row");
    assert.ok(universal, "the pre-existing universal market.glb row is untouched");
    assert.notEqual(variant.id, universal.id, "the per-world variant is a distinct asset, not an alias of the universal one");
    assert.equal(variant.category, "building");
    const tags = JSON.parse(variant.tags_json);
    assert.ok(tags.includes("per-world-variant"));
    assert.ok(tags.includes("crime"));
  });

  it("registers the 5 new furniture props with real CC0 KayKit-Furniture-Bits provenance", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    for (const id of ["table", "rug", "shelf", "cabinet", "armchair"]) {
      const row = db.prepare(`SELECT * FROM evo_assets WHERE source_id = ?`).get(`world-lens:models/prop/furniture_${id}.glb`);
      assert.ok(row, `furniture_${id}.glb should be registered`);
      assert.equal(row.category, "prop");
      const tags = JSON.parse(row.tags_json);
      assert.ok(tags.includes("cc0"));
      assert.ok(tags.includes("furniture"));
    }
  });

  it("registers the 3 new market world-dressing props with real CC0 KayKit-Prototype-Bits provenance", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    for (const id of ["barrel", "crate", "pallet"]) {
      const row = db.prepare(`SELECT * FROM evo_assets WHERE source_id = ?`).get(`world-lens:models/prop/market_${id}.glb`);
      assert.ok(row, `market_${id}.glb should be registered`);
      assert.equal(row.category, "prop");
      const tags = JSON.parse(row.tags_json);
      assert.ok(tags.includes("cc0"));
      assert.ok(tags.includes("world-dressing"));
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
    assert.ok(result.worldLensAssets.registered >= 59, "world-lens assets should be part of the boot-time floor");
    assert.ok(result.total >= 59 + 3, "total should include both the primitive seed and the real world-lens assets");
  });

  it("real world-lens assets are real evolution candidates", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    const candidates = selectEvolutionCandidates(db, 65);
    assert.ok(candidates.length >= 59, "the scheduler should see the real assets as candidates");
  });
});

describe("evo-asset world-lens seed — frontend resolution alias (source/sourceId key mismatch fix)", () => {
  // Every real renderer call site (BuildingRenderer3D.tsx, creature-renderer.ts,
  // resource-node-renderer.ts, weapon-archetypes.ts) calls loadAsset() without
  // a `source` override, so concord-frontend/lib/world-lens/asset-loader.ts
  // defaults to source='concordia' and passes the bare filename (no
  // extension) as sourceId — e.g. {kind:'building', id:'tavern'} for
  // models/building/tavern.glb. The registration above only ever wrote
  // source='github', sourceId='world-lens:models/building/tavern.glb', a
  // completely different (source, sourceId) pair. resolveCurrentBest's exact
  // match meant a promoted evo-asset refinement of a world-lens GLB could
  // NEVER reach the renderer — the two halves of the pipeline were keyed in
  // different namespaces and never intersected. These tests pin the fix: a
  // second alias row under the exact key the frontend actually queries.

  it("registers a concordia-sourced alias row per asset, keyed by the bare filename (no extension)", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    const alias = db.prepare(`SELECT * FROM evo_assets WHERE source = 'concordia' AND source_id = 'tavern'`).get();
    assert.ok(alias, "a concordia/tavern alias row should exist for models/building/tavern.glb");
    assert.ok(alias.local_path.endsWith("models/building/tavern.glb"));
    assert.equal(alias.category, "building");
  });

  it("resolveCurrentBest now finds a match using the EXACT (source, sourceId) the frontend asset-loader queries — this is the observable fix", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    // Mirrors asset-loader.ts#resolveAssetReference's real call:
    // resolveAssetUrl({ source: ref.source ?? "concordia", sourceId: ref.id })
    // with ref = { kind: 'building', id: 'tavern' } — before this fix,
    // resolveCurrentBest(db, {source:'concordia', sourceId:'tavern'}) always
    // returned null (not_registered), so the frontend silently fell through
    // to the static /models/building/tavern.glb path — byte-identical output
    // today, but with zero path for a future promoted refinement to surface.
    const resolved = resolveCurrentBest(db, { source: "concordia", sourceId: "tavern" });
    assert.ok(resolved, "resolveCurrentBest should find the concordia alias row");
    assert.ok(resolved.canonicalPath.endsWith("models/building/tavern.glb"));
    assert.ok(resolved.qualityLevel >= 4);
  });

  it("does not disturb the existing github-sourced provenance row — both rows coexist, pointing at the same file", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    const githubRow = db.prepare(`SELECT * FROM evo_assets WHERE source = 'github' AND source_id = 'world-lens:models/building/tavern.glb'`).get();
    const aliasRow = db.prepare(`SELECT * FROM evo_assets WHERE source = 'concordia' AND source_id = 'tavern'`).get();
    assert.ok(githubRow, "the original github provenance row must still exist, unchanged");
    assert.ok(aliasRow);
    assert.notEqual(githubRow.id, aliasRow.id, "two distinct rows, not a mutation of the same row");
    assert.equal(githubRow.local_path, aliasRow.local_path, "both point at the same file on disk");
  });

  it("re-seeding is idempotent for the alias rows too — no duplicates on a second run", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    const before = db.prepare(`SELECT COUNT(*) AS n FROM evo_assets WHERE source = 'concordia'`).get().n;
    bootstrapWorldLensAssets(db);
    const after = db.prepare(`SELECT COUNT(*) AS n FROM evo_assets WHERE source = 'concordia'`).get().n;
    assert.equal(before, after);
    assert.ok(before >= 59, "one alias row per found asset");
  });

  it("aliases resolve correctly for the other asset kinds real renderers actually query (weapon, vegetation, creature)", () => {
    const db = setupDb();
    bootstrapWorldLensAssets(db);
    // weapon-archetypes.ts calls loadAsset({kind:'weapon', id}) for e.g. 'mace'
    assert.ok(resolveCurrentBest(db, { source: "concordia", sourceId: "mace" }), "weapon/mace.glb should resolve");
    // resource-node-renderer.ts calls loadAsset({kind:'vegetation', id:'bush_01'})
    assert.ok(resolveCurrentBest(db, { source: "concordia", sourceId: "bush_01" }), "vegetation/bush_01.glb should resolve");
    // creature-renderer.ts calls loadAsset({kind:'creature', id})
    assert.ok(resolveCurrentBest(db, { source: "concordia", sourceId: "quadruped_01" }), "creature/quadruped_01.glb should resolve");
  });
});
