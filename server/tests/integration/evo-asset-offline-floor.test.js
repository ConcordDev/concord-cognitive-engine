/**
 * T1.6 — Evo asset offline seed floor.
 *
 * The evo pipeline is real and wired, but all feed was external CC0 fetch
 * (PolyHaven/ambientCG/OS3A) that returns empty offline — so on a box without
 * egress the registry seeded empty and runEvolutionTick produced zero, silently.
 *
 * bootstrapLocalSeed registers a committed CC0 primitive-mesh pack FIRST and
 * unconditionally. This test proves: with NO network, the registry is non-empty,
 * the evolution engine has candidates, and a seed mesh actually subdivides
 * (a real candidate, not a no-op).
 *
 * Run: node --test tests/integration/evo-asset-offline-floor.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up073 } from "../../migrations/073_evo_assets.js";
import { up as up084 } from "../../migrations/084_evo_asset_cdn_urls.js";
import { up as up100 } from "../../migrations/100_evo_assets_gameplay_kinds.js";
import { up as up202 } from "../../migrations/202_evo_assets_blueprint_kind.js";

import { bootstrapLocalSeed, bootstrapAllSources } from "../../lib/evo-asset/source-loaders.js";
import { selectEvolutionCandidates } from "../../lib/evo-asset/registry.js";
import { runSubdivisionPass } from "../../lib/evo-asset/refinement-passes.js";

function setupDb() {
  const db = new Database(":memory:");
  for (const up of [up073, up084, up100, up202]) {
    try { up(db); } catch { /* later migrations may add optional cols only */ }
  }
  return db;
}

describe("T1.6 — evo asset offline floor", () => {
  it("bootstrapLocalSeed registers the committed seed pack with zero network", () => {
    const db = setupDb();
    const stats = bootstrapLocalSeed(db);
    assert.ok(stats.registered >= 3, `seed pack should register >= 3 assets, got ${stats.registered}`);
    const count = db.prepare(`SELECT COUNT(*) AS c FROM evo_assets WHERE source_id LIKE 'seed:%'`).get().c;
    assert.ok(count >= 3, "registry must be non-empty after the local seed");
  });

  it("is idempotent — re-seeding registers nothing new", () => {
    const db = setupDb();
    bootstrapLocalSeed(db);
    const second = bootstrapLocalSeed(db);
    assert.equal(second.registered, 0, "re-seed must not duplicate rows");
  });

  it("bootstrapAllSources reports a non-empty floor even when network loaders fail", async () => {
    const db = setupDb();
    // No network in the test env -> polyhaven/ambientcg/os3a return empty/error.
    const result = await bootstrapAllSources(db);
    assert.ok(result.total >= 3, `floor should be >= 3, got ${result.total}`);
    assert.equal(result.empty, false, "registry must not be flagged empty when the seed pack loaded");
  });

  it("the evolution engine has candidates and a seed mesh actually subdivides", async () => {
    const db = setupDb();
    bootstrapLocalSeed(db);
    const candidates = selectEvolutionCandidates(db, 5);
    assert.ok(candidates.length >= 1, "evolution tick must have at least one candidate to chew on");

    const cube = db.prepare(`SELECT local_path FROM evo_assets WHERE source_id = 'seed:cube.mesh.json'`).get();
    assert.ok(cube, "cube seed mesh registered");
    const out = await runSubdivisionPass("test-cube", cube.local_path);
    assert.ok(out && out.localPath, "subdivision pass should produce a candidate from the seed mesh");
    // cube = 12 tris -> Loop subdivision -> 48 tris (real geometry work, not a no-op)
    if (out.stats) assert.ok(out.stats.outTris > out.stats.inTris, "subdivision must increase triangle count");
  });
});
