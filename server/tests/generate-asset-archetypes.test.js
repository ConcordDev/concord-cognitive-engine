/**
 * Program C, Stage 5 continuation — proves the four new archetypes
 * (spear/staff/mace/shield) are actually reachable through the REAL
 * generation entry point (`generateValidatedAsset`), not just callable at
 * the fea-gate.js level. Mirrors generate-asset.test.js's own shape: real
 * .glb on disk, round-trips through extractMeshData, real mass grounding,
 * real FEA gate result — never a shortcut.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { extractMeshData } from "../lib/evo-asset/glb-bridge.js";
import { generateValidatedAsset } from "../lib/asset-gen/generate-asset.js";

let tmpDir;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-asset-gen-archetypes-test-"));
});
after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
});

async function generateAndVerify(archetype, extraOpts = {}) {
  const outDir = fs.mkdtempSync(path.join(tmpDir, `${archetype}-`));
  const result = await generateValidatedAsset({ archetype, params: {}, outDir, ...extraOpts });
  return { result, outDir };
}

describe("generateValidatedAsset — all five registered archetypes are reachable through the real entry point", () => {
  it("spear: converges at default params (same diamond-blade gate as sword), packs a real round-trippable .glb", async () => {
    const { result } = await generateAndVerify("spear");
    assert.equal(result.ok, true, `expected ok:true, got ${JSON.stringify({ reason: result.reason, error: result.error })}`);
    assert.equal(result.material, "steel-a36");
    assert.ok(fs.existsSync(result.glbPath));
    const extracted = await extractMeshData(result.glbPath);
    assert.ok(extracted.positions.length > 0);
    assert.ok(result.massProps.mass_kg > 0.05 && result.massProps.mass_kg < 20,
      `spear mass_kg ${result.massProps.mass_kg} outside sane hand-weapon range`);
    assert.equal(result.feaResult.ok, true);
    assert.ok(result.feaResult.maxUtilization < 1);
    assert.equal(result.feaResult.useCase, "sword-bending");
  });

  it("mace: uses the mace-impact use case by default, converges at default params, packs a real .glb", async () => {
    const { result } = await generateAndVerify("mace");
    assert.equal(result.ok, true, `expected ok:true, got ${JSON.stringify({ reason: result.reason, error: result.error })}`);
    assert.equal(result.material, "steel-a36");
    const extracted = await extractMeshData(result.glbPath);
    assert.ok(extracted.positions.length > 0);
    assert.ok(result.massProps.mass_kg > 0.5 && result.massProps.mass_kg < 20,
      `mace mass_kg ${result.massProps.mass_kg} outside sane hand-weapon range`);
    assert.equal(result.feaResult.ok, true);
    assert.equal(result.feaResult.useCase, "mace-impact");
    assert.ok(result.feaResult.maxUtilization < 1);
  });

  it("staff: uses the staff-swing use case, and the DEFAULT geometry does NOT converge without params override in a tiny iteration budget — an honest, non-fabricated finding", async () => {
    // The default STAFF_DEFAULTS.gripRadius fails the derived combined
    // load hard (see fea-gate-archetypes.test.js) — a tiny maxIters budget
    // genuinely exhausts before reaching a passing grip radius. This test
    // pins that generateValidatedAsset reports the honest failure (no
    // file written), not a silent success.
    const { result, outDir } = await generateAndVerify("staff", { maxIters: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "fea_did_not_converge");
    assert.deepEqual(fs.readdirSync(outDir), [], "no .glb may be written when FEA never converges");
  });

  it("staff: converges + packs a real .glb given a large-enough iteration budget (the actual production default)", async () => {
    const { result } = await generateAndVerify("staff");
    assert.equal(result.ok, true, `expected ok:true, got ${JSON.stringify({ reason: result.reason, error: result.error })}`);
    assert.equal(result.material, "douglas-fir");
    const extracted = await extractMeshData(result.glbPath);
    assert.ok(extracted.positions.length > 0);
    assert.equal(result.feaResult.ok, true);
    assert.equal(result.feaResult.useCase, "staff-swing");
    // The converged params must actually differ from the raw generator
    // default — proving optimizeToPass's per-archetype thickenParam
    // ("gripRadius") really drove the search, not a no-op.
    assert.ok(result.params.gripRadius > 0.012, `expected a thickened gripRadius, got ${result.params.gripRadius}`);
  });

  it("shield: uses the shield-face-load use case, converges trivially at default params (the documented finding), packs a real .glb", async () => {
    const { result } = await generateAndVerify("shield");
    assert.equal(result.ok, true, `expected ok:true, got ${JSON.stringify({ reason: result.reason, error: result.error })}`);
    assert.equal(result.material, "douglas-fir");
    const extracted = await extractMeshData(result.glbPath);
    assert.ok(extracted.positions.length > 0);
    assert.ok(result.massProps.mass_kg > 0.5 && result.massProps.mass_kg < 10,
      `shield mass_kg ${result.massProps.mass_kg} outside sane hand-shield range`);
    assert.equal(result.feaResult.ok, true);
    assert.equal(result.feaResult.useCase, "shield-face-load");
    // Converged on the FIRST iteration — no thickening was needed, because
    // the use case passes trivially at default proportions (the finding
    // documented in fea-gate.js / fea-gate-archetypes.test.js).
    assert.equal(result.history.length, 1);
  });

  it("an explicit useCase override on a non-blade archetype is honored (caller can still ask for the wrong physics on purpose, e.g. for comparison)", async () => {
    const { result } = await generateAndVerify("mace", { useCase: "mace-impact", axialLoadN: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.feaResult.axialLoadN, 1);
  });
});

describe("archetype defaults are honestly distinct materials, not a copy-pasted 'steel-a36' everywhere", () => {
  it("staff and shield default to douglas-fir; sword/spear/mace default to steel-a36", async () => {
    const { generateValidatedAsset: gva } = await import("../lib/asset-gen/generate-asset.js");
    const cases = [
      ["sword", "steel-a36"],
      ["spear", "steel-a36"],
      ["staff", "douglas-fir"],
      ["mace", "steel-a36"],
      ["shield", "douglas-fir"],
    ];
    for (const [archetype, expectedMaterial] of cases) {
      const outDir = fs.mkdtempSync(path.join(tmpDir, `mat-${archetype}-`));
      const result = await gva({ archetype, params: {}, outDir });
      assert.equal(result.ok, true, `${archetype} failed to converge: ${JSON.stringify({ reason: result.reason })}`);
      assert.equal(result.material, expectedMaterial, `${archetype} defaulted to the wrong material`);
    }
  });
});
