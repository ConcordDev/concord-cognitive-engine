/**
 * Program C, Stage 5 — parametric asset generation wired into the
 * evo-asset pipeline end-to-end.
 *
 * Covers:
 *   1. generateValidatedAsset: params → optimizeToPass (Stage 4) →
 *      generateSwordMeshWithNormals (Stage 2) → massProperties (Stage 3) →
 *      packGLB — a real .glb on disk that round-trips through
 *      glb-bridge.js#extractMeshData.
 *   2. Honesty gate: an impossible spec (huge tip load, tiny iteration
 *      budget) converges never — ok:false, reason:'fea_did_not_converge',
 *      and NO .glb file is ever written.
 *   3. Scheduler wiring: runAssetGenerationTick (the thin hook
 *      server/lib/evo-asset/scheduler.js calls) registers + gates +
 *      promotes a generated asset through the REAL registry (in-memory
 *      migrated DB, same pattern as the existing evo-asset tests), and the
 *      promoted asset resolves via resolveCurrentBest — the same function
 *      backing /api/evo-asset/resolve.
 *   4. Kill-switch: CONCORD_ASSET_GEN_ENABLED=0 disables the hook cleanly
 *      (no rows written, no errors).
 *
 * All glb test artifacts are written to a tmpdir, never into the repo.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { up as up073 } from "../migrations/073_evo_assets.js";
import { up as up084 } from "../migrations/084_evo_asset_cdn_urls.js";
import { up as up100 } from "../migrations/100_evo_assets_gameplay_kinds.js";
import { up as up202 } from "../migrations/202_evo_assets_blueprint_kind.js";

import { extractMeshData } from "../lib/evo-asset/glb-bridge.js";
import { resolveCurrentBest, promoteVersion } from "../lib/evo-asset/registry.js";
import {
  generateValidatedAsset,
  registerGeneratedAsset,
  runAssetGenerationTick,
  targetSourceId,
  GENERATION_TARGETS,
} from "../lib/asset-gen/generate-asset.js";

function setupDb() {
  const db = new Database(":memory:");
  for (const up of [up073, up084, up100, up202]) {
    try { up(db); } catch { /* later migrations may add optional cols only */ }
  }
  return db;
}

let tmpDir;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-asset-gen-test-"));
});
after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
});

describe("generateValidatedAsset — end-to-end chain", () => {
  it("a robust sword spec converges, packs a real .glb, and round-trips through extractMeshData", async () => {
    const outDir = fs.mkdtempSync(path.join(tmpDir, "robust-"));
    const result = await generateValidatedAsset({
      archetype: "sword",
      params: { bladeBaseThickness: 0.012 }, // known-robust per fea-gate.test.js
      outDir,
    });

    assert.equal(result.ok, true, `expected ok:true, got ${JSON.stringify({ reason: result.reason, error: result.error })}`);
    assert.equal(typeof result.glbPath, "string");
    assert.ok(fs.existsSync(result.glbPath), "generateValidatedAsset must actually write the .glb to disk");

    // Real geometry — round-trips through the same bridge every refinement
    // pass uses, not a fabricated/empty file.
    const extracted = await extractMeshData(result.glbPath);
    assert.ok(extracted.positions.length > 0, "extracted mesh must have vertex positions");
    assert.equal(extracted.positions.length % 3, 0);
    assert.ok(extracted.indices.length > 0, "extracted mesh must have triangle indices");
    assert.equal(extracted.indices.length % 3, 0);
    const vertCount = extracted.positions.length / 3;
    for (let i = 0; i < extracted.indices.length; i++) {
      assert.ok(extracted.indices[i] < vertCount, "every index must reference a real vertex");
    }
    assert.ok(extracted.normals && extracted.normals.length === extracted.positions.length, "normals must be packed");

    // Mass properties are grounded in real SI physics — sane for a sword
    // (roughly 0.3kg-3kg for a hand weapon at these dimensions/steel density).
    assert.ok(Number.isFinite(result.massProps.mass_kg));
    assert.ok(result.massProps.mass_kg > 0.05 && result.massProps.mass_kg < 10,
      `mass_kg ${result.massProps.mass_kg} outside sane hand-weapon range`);
    assert.equal(result.massProps.material.key, "steel-a36");

    // FEA gate genuinely passed — not fabricated.
    assert.equal(result.feaResult.ok, true);
    assert.ok(result.feaResult.maxUtilization < 1);
  });

  it("defaults material to the archetype default (steel-a36) when unspecified", async () => {
    const outDir = fs.mkdtempSync(path.join(tmpDir, "defmat-"));
    const result = await generateValidatedAsset({
      archetype: "sword",
      params: { bladeBaseThickness: 0.012 },
      outDir,
    });
    assert.equal(result.ok, true);
    assert.equal(result.material, "steel-a36");
  });

  it("rejects an unknown archetype honestly, no file written", async () => {
    const outDir = fs.mkdtempSync(path.join(tmpDir, "badarch-"));
    const result = await generateValidatedAsset({ archetype: "spaceship", params: {}, outDir });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unknown_archetype");
    assert.deepEqual(fs.readdirSync(outDir), []);
  });
});

describe("generateValidatedAsset — honesty gate (never fabricates a structurally-invalid asset)", () => {
  it("an impossible spec (huge tip load, tiny iteration budget) never converges — ok:false, reason:'fea_did_not_converge', NO .glb written", async () => {
    const outDir = fs.mkdtempSync(path.join(tmpDir, "impossible-"));
    const result = await generateValidatedAsset({
      archetype: "sword",
      params: { bladeBaseThickness: 0.006 },
      tipLoadN: 100000, // absurd load — same value fea-gate.test.js uses to force non-convergence
      maxIters: 2,       // tiny budget — never reaches a passing thickness
      outDir,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "fea_did_not_converge");
    assert.ok(Array.isArray(result.history));
    assert.ok(result.history.every((h) => h.ok === false), "every attempt in the history must be an honest failure");

    // The load-bearing honesty assertion: no file was ever written.
    assert.deepEqual(fs.readdirSync(outDir), [], "no .glb may be written when FEA never converges");
  });

  it("a hard precondition failure (unknown material) is also reported honestly with no file written", async () => {
    const outDir = fs.mkdtempSync(path.join(tmpDir, "badmat-"));
    const result = await generateValidatedAsset({
      archetype: "sword",
      params: { bladeBaseThickness: 0.012 },
      material: "unobtainium-9000",
      outDir,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "fea_did_not_converge");
    assert.equal(result.optimizeReason, "cannot_converge");
    assert.deepEqual(fs.readdirSync(outDir), []);
  });
});

describe("registerGeneratedAsset + promoteVersion — real registry plumbing", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("registers a generated asset, appends a version, promotes it, and it resolves via resolveCurrentBest", async () => {
    const outDir = fs.mkdtempSync(path.join(tmpDir, "registry-"));
    const generated = await generateValidatedAsset({
      archetype: "sword",
      params: { bladeBaseThickness: 0.012 },
      outDir,
    });
    assert.equal(generated.ok, true);

    const sourceId = targetSourceId("sword", { bladeBaseThickness: 0.012 });
    const reg = registerGeneratedAsset(db, {
      archetype: "sword",
      params: { bladeBaseThickness: 0.012 },
      glbPath: generated.glbPath,
      massProps: generated.massProps,
      feaResult: generated.feaResult,
      sourceId,
    });
    assert.equal(reg.created, true);
    assert.equal(typeof reg.assetId, "string");
    assert.equal(typeof reg.versionId, "string");

    // Pre-promotion: resolveCurrentBest falls back to the base local_path
    // (no promoted version yet).
    const preResolve = resolveCurrentBest(db, { source: "evolved", sourceId });
    assert.ok(preResolve, "asset must be resolvable once registered, even before promotion");
    assert.equal(preResolve.qualityLevel, 0);

    promoteVersion(db, reg.versionId);

    const resolved = resolveCurrentBest(db, { source: "evolved", sourceId });
    assert.ok(resolved);
    assert.equal(resolved.canonicalPath, generated.glbPath, "promoted generated asset must resolve to its real GLB");
    assert.equal(resolved.qualityLevel, 1, "promotion bumps quality_level");
    assert.equal(resolved.pass, "authored_replacement");

    // The resolved path is a real, round-trippable GLB — not a stub.
    const extracted = await extractMeshData(resolved.canonicalPath);
    assert.ok(extracted.positions.length > 0);
  });

  it("registerAsset is idempotent on the same target sourceId (no duplicate registration)", async () => {
    const outDir = fs.mkdtempSync(path.join(tmpDir, "idempotent-"));
    const generated = await generateValidatedAsset({ archetype: "sword", params: { bladeBaseThickness: 0.012 }, outDir });
    const sourceId = targetSourceId("sword", { bladeBaseThickness: 0.012 });
    const first = registerGeneratedAsset(db, {
      archetype: "sword", params: { bladeBaseThickness: 0.012 },
      glbPath: generated.glbPath, massProps: generated.massProps, feaResult: generated.feaResult, sourceId,
    });
    const second = registerGeneratedAsset(db, {
      archetype: "sword", params: { bladeBaseThickness: 0.012 },
      glbPath: generated.glbPath, massProps: generated.massProps, feaResult: generated.feaResult, sourceId,
    });
    assert.equal(first.assetId, second.assetId, "same target must not create a second asset row");
    assert.equal(second.created, false);

    const count = db.prepare(`SELECT COUNT(*) AS c FROM evo_assets WHERE source_id = ?`).get(sourceId).c;
    assert.equal(count, 1);
  });
});

describe("runAssetGenerationTick — the scheduler hook, full chain (generate → register → gate → promote → resolve)", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  const verifiedDeps = {
    createAtlasDtu: () => ({ id: "dtu-fake-generated-1" }),
    runAutoPromoteGate: async () => ({ allowed: true }),
    promoteAtlasDtu: () => { /* no-op */ },
  };

  it("generates every missing GENERATION_TARGETS entry, gates it, and promotes on a VERIFIED verdict", async () => {
    assert.ok(GENERATION_TARGETS.length >= 1, "at least one generation target must be configured");

    const stats = await runAssetGenerationTick({}, db, verifiedDeps);
    assert.equal(stats.errors, 0, "the tick must not error on a clean DB");
    assert.equal(stats.checked, GENERATION_TARGETS.length);
    assert.equal(stats.generated, GENERATION_TARGETS.length, "every missing target should generate");
    assert.equal(stats.gated, GENERATION_TARGETS.length);
    assert.equal(stats.promoted, GENERATION_TARGETS.length, "a VERIFIED gate verdict must promote");

    const target = GENERATION_TARGETS[0];
    const sourceId = targetSourceId(target.archetype, target.params);
    const resolved = resolveCurrentBest(db, { source: "evolved", sourceId });
    assert.ok(resolved, "the generated+promoted asset must resolve");
    assert.equal(resolved.qualityLevel, 1);
    assert.ok(fs.existsSync(resolved.canonicalPath), "the resolved path must be a real file on disk");

    const extracted = await extractMeshData(resolved.canonicalPath);
    assert.ok(extracted.positions.length > 0, "the resolved asset is real, round-trippable geometry");
  });

  it("is idempotent — a second tick does not re-generate an already-registered target", async () => {
    await runAssetGenerationTick({}, db, verifiedDeps);
    const countAfterFirst = db.prepare(`SELECT COUNT(*) AS c FROM evo_assets`).get().c;

    const second = await runAssetGenerationTick({}, db, verifiedDeps);
    assert.equal(second.generated, 0, "already-registered targets must not regenerate");

    const countAfterSecond = db.prepare(`SELECT COUNT(*) AS c FROM evo_assets`).get().c;
    assert.equal(countAfterSecond, countAfterFirst, "no duplicate rows on a re-run");
  });

  it("leaves the version unpromoted when the gate verdict is not 'verified' (no deps → 'pending')", async () => {
    const stats = await runAssetGenerationTick({}, db, {}); // no gate deps supplied
    assert.equal(stats.generated, GENERATION_TARGETS.length);
    assert.equal(stats.promoted, 0, "a 'pending' verdict must never promote");

    const target = GENERATION_TARGETS[0];
    const sourceId = targetSourceId(target.archetype, target.params);
    const resolved = resolveCurrentBest(db, { source: "evolved", sourceId });
    assert.ok(resolved, "still resolvable pre-promotion, via the un-promoted local_path fallback");
    assert.equal(resolved.qualityLevel, 0, "quality_level must not bump without a real promotion");
  });

  it("never throws — a DB error inside the loop is caught and counted, not propagated", async () => {
    const brokenDb = { prepare() { throw new Error("boom"); } };
    const stats = await runAssetGenerationTick({}, brokenDb, verifiedDeps);
    assert.ok(stats.errors >= 1);
  });
});

describe("CONCORD_ASSET_GEN_ENABLED kill-switch", () => {
  let db;
  let prevEnv;
  beforeEach(() => {
    db = setupDb();
    prevEnv = process.env.CONCORD_ASSET_GEN_ENABLED;
  });
  after(() => {
    if (prevEnv === undefined) delete process.env.CONCORD_ASSET_GEN_ENABLED;
    else process.env.CONCORD_ASSET_GEN_ENABLED = prevEnv;
  });

  it("CONCORD_ASSET_GEN_ENABLED=0 disables the hook cleanly — no rows, no errors, zero stats", async () => {
    process.env.CONCORD_ASSET_GEN_ENABLED = "0";
    try {
      const stats = await runAssetGenerationTick({}, db, {
        createAtlasDtu: () => ({ id: "dtu-x" }),
        runAutoPromoteGate: async () => ({ allowed: true }),
        promoteAtlasDtu: () => {},
      });
      assert.deepEqual(stats, { checked: 0, generated: 0, gated: 0, promoted: 0, errors: 0 });
      const count = db.prepare(`SELECT COUNT(*) AS c FROM evo_assets`).get().c;
      assert.equal(count, 0, "kill-switch must prevent any registration");
    } finally {
      delete process.env.CONCORD_ASSET_GEN_ENABLED;
    }
  });

  it("re-enabling (unset or any non-'0' value) restores normal generation", async () => {
    delete process.env.CONCORD_ASSET_GEN_ENABLED;
    const stats = await runAssetGenerationTick({}, db, {
      createAtlasDtu: () => ({ id: "dtu-y" }),
      runAutoPromoteGate: async () => ({ allowed: true }),
      promoteAtlasDtu: () => {},
    });
    assert.equal(stats.generated, GENERATION_TARGETS.length);
  });
});

describe("scheduler.js wiring — runEvolutionTick calls the generation hook", () => {
  it("runEvolutionTick reports a non-zero 'generated' stat via the Stage-5 hook even with zero refinement candidates", async () => {
    const { runEvolutionTick } = await import("../lib/evo-asset/scheduler.js");
    const db = setupDb(); // empty registry — nothing to refine
    const stats = await runEvolutionTick({}, db, {
      createAtlasDtu: () => ({ id: "dtu-scheduler-1" }),
      runAutoPromoteGate: async () => ({ allowed: true }),
      promoteAtlasDtu: () => {},
    });
    // Note: because the Stage-5 hook runs BEFORE candidate selection inside
    // the same tick, the asset it just generated+promoted is immediately
    // visible to the refine-candidate query too (quality_level 1 < 10) — so
    // `checked` reflects that, not zero. This is correct emergent behavior,
    // not a bug: a freshly-created asset becomes refinable on its very next
    // eligible pass, same as any other registered asset would.
    assert.equal(stats.generated, GENERATION_TARGETS.length, "the Stage-5 generation hook must have fired inside runEvolutionTick");
    assert.equal(stats.errors, 0);

    const target = GENERATION_TARGETS[0];
    const sourceId = targetSourceId(target.archetype, target.params);
    const resolved = resolveCurrentBest(db, { source: "evolved", sourceId });
    assert.ok(resolved, "the asset generated by the hook inside runEvolutionTick must be registered and resolvable");
  });

  it("runEvolutionTick's kill-switch propagation: CONCORD_ASSET_GEN_ENABLED=0 leaves generated at 0 without breaking the refine loop", async () => {
    const { runEvolutionTick } = await import("../lib/evo-asset/scheduler.js");
    const db = setupDb();
    process.env.CONCORD_ASSET_GEN_ENABLED = "0";
    try {
      const stats = await runEvolutionTick({}, db, {});
      assert.equal(stats.generated, 0);
      assert.equal(stats.errors, 0);
      assert.equal(stats.checked, 0); // still no refinement candidates, loop ran fine
    } finally {
      delete process.env.CONCORD_ASSET_GEN_ENABLED;
    }
  });
});
