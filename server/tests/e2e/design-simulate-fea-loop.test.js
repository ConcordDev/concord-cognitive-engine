/**
 * Tier-3 flagship E2E loop (R8/CL3, loop 4): "Design/simulate → real engine
 * result → visible proof."
 *
 * Exercises Program C's real generative pipeline end-to-end against the
 * ACTUAL engines (never a placeholder number):
 *
 *   1. compute-don't-guess sanity gate: an independent hand-computed
 *      Euler-Bernoulli bending stress (physics-compute.js#bendingStress) is
 *      cross-checked against fea-solver.js's own `runFEA` + `checkUtilization`
 *      output for the SAME simple cantilever — proving the low-level solver
 *      primitive this whole pipeline is built on is not fabricating numbers.
 *   2. parametric mesh (parametric-mesh.js#generateSwordMesh) → FEA
 *      structural gate (fea-gate.js#structuralCheck) discriminates a robust
 *      design from a brittle one using REAL computed utilization ratios.
 *   3. The full chain — optimizeToPass → generateSwordMeshWithNormals →
 *      massProperties → packGLB (generate-asset.js#generateValidatedAsset) —
 *      produces a real .glb on disk, which is then registered, gated,
 *      promoted, and resolved through the SAME evo-asset registry primitives
 *      /api/evo-asset/resolve uses. That resolved, round-trippable .glb path
 *      is the "visible proof" — not a log line, an artifact a lens/client can
 *      actually load.
 *
 * REAL GAP FOUND (reported, not papered over): `generateValidatedAsset` /
 * `runAssetGenerationTick` (server/lib/asset-gen/generate-asset.js) compose
 * correctly end-to-end when called directly (proven below), but grepping
 * server/domains/*.js and server/routes/*.js for callers of either function
 * turns up NONE — the only production caller is the fixed heartbeat
 * `GENERATION_TARGETS` list (one hardcoded "sword" target). There is no
 * macro or HTTP route that lets a player or ConKay trigger a CUSTOM
 * on-demand design generation with their own params; the pipeline can only
 * ever auto-generate the same pre-baked target once. The separate
 * `engineering` domain macros (`partMesh`/`meshGenerate`/`runFEA`/
 * `structuralCheck` — server/domains/engineering.js) are a parallel,
 * unconnected path for generic box/cylinder/i-beam primitives that never
 * touches parametric-mesh.js's sword generator or this module's optimizer —
 * so "generate my own bladed weapon and see if it passes" is not reachable
 * from the frontend today, only from a test or the heartbeat.
 *
 * Run: node --test tests/e2e/design-simulate-fea-loop.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { momentOfInertia, bendingStress } from "../../lib/compute/physics-compute.js";
import { runFEA, checkUtilization } from "../../lib/simulation/fea-solver.js";
import { generateSwordMesh } from "../../lib/asset-gen/parametric-mesh.js";
import { structuralCheck } from "../../lib/asset-gen/fea-gate.js";
import {
  generateValidatedAsset,
  registerGeneratedAsset,
  targetSourceId,
} from "../../lib/asset-gen/generate-asset.js";
import { extractMeshData } from "../../lib/evo-asset/glb-bridge.js";
import { resolveCurrentBest, promoteVersion } from "../../lib/evo-asset/registry.js";
import { submitAssetCandidateToGate } from "../../lib/evo-asset/quality-gate-bridge.js";

import { up as up073 } from "../../migrations/073_evo_assets.js";
import { up as up084 } from "../../migrations/084_evo_asset_cdn_urls.js";
import { up as up100 } from "../../migrations/100_evo_assets_gameplay_kinds.js";
import { up as up202 } from "../../migrations/202_evo_assets_blueprint_kind.js";

let tmpDir;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-e2e-fea-"));
});
after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
});

function setupDb() {
  const db = new Database(":memory:");
  for (const up of [up073, up084, up100, up202]) {
    try { up(db); } catch { /* later migrations may add optional cols only */ }
  }
  return db;
}

describe("Loop 4, Stage 1 — compute-don't-guess: hand-checked stress vs the real solver", () => {
  it("an independently hand-computed sigma=Mc/I matches checkUtilization's own combinedStress/allowable ratio", () => {
    // A plain rectangular cantilever — identical shape to fea-gate.test.js's
    // oracle model, built fresh here (not imported) so this test's expected
    // value comes from re-deriving the physics, not from trusting the other
    // test file's assertion.
    const L = 0.4;      // m
    const P = 150;      // N transverse tip load
    const base = 0.04, height = 0.012; // m
    const area = base * height;
    const I = momentOfInertia("rectangle", { base, height }).value;
    const c = height / 2;
    const E = 200e9; // Pa, steel

    const model = {
      nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: L, y: 0, z: 0 }],
      members: [{ id: "m1", nodeI: "A", nodeJ: "B", area, momentI: I, elasticModulus: E, depthIn: height, allowableStress: 150e6 }],
      supports: [{ nodeId: "A", type: "fixed" }],
      loads: [{ nodeId: "B", Fy: P }],
    };

    const res = runFEA(model);
    assert.equal(res.ok, true, "the real solver must converge on this simple model");

    const mf = res.memberForces[0];
    // Analytic Euler-Bernoulli cantilever: max moment at the fixed root = P*L.
    const expectedMoment = P * L;
    assert.ok(Math.abs(mf.maxMoment - expectedMoment) / expectedMoment < 1e-6,
      `solver maxMoment ${mf.maxMoment} vs hand-derived ${expectedMoment}`);

    // Hand-derived bending stress via the SAME independent oracle function
    // fea-gate.test.js uses (physics-compute.js#bendingStress — sigma=Mc/I),
    // never the solver's own internal formula re-typed here.
    const expectedStress = bendingStress({ moment: expectedMoment, momentI: I, distance: c }).value;
    const solverStress = res.stresses[0].bendingStress;
    assert.ok(Math.abs(solverStress - expectedStress) / expectedStress < 1e-6,
      `solver bendingStress ${solverStress} vs hand-derived ${expectedStress}`);

    // Now feed the solver's own stresses through checkUtilization and verify
    // the utilization ratio is EXACTLY combinedStress/allowable — a real
    // computed number, not a placeholder pass/fail flag.
    const util = checkUtilization(res.stresses, model.members);
    const expectedUtilization = res.stresses[0].combinedStress / model.members[0].allowableStress;
    assert.equal(util[0].utilization, expectedUtilization);
    assert.equal(util[0].pass, expectedUtilization <= 1.0);
    // Sanity: pin the actual hand-derived number (not just "some positive
    // value") so a silent unit-mixup (e.g. Pa vs MPa) in the solver would
    // fail this. combinedStress = P*L*c/I (bending only, no axial term here)
    // over the 150MPa allowable — computed once, independently, right here.
    const handStress = (P * L * c) / I;
    const handUtilization = handStress / model.members[0].allowableStress;
    assert.ok(Math.abs(util[0].utilization - handUtilization) / handUtilization < 1e-9,
      `checkUtilization ${util[0].utilization} vs fully-independent hand calc ${handUtilization}`);
    assert.ok(util[0].utilization > 0 && util[0].utilization < 1,
      `expected this section to pass (util < 1), got ${util[0].utilization}`);
  });
});

describe("Loop 4, Stage 2 — parametric mesh + FEA gate discriminate a real design space", () => {
  it("structuralCheck computes a REAL utilization ratio that fails a marginal blade and passes a thickened one", () => {
    const marginal = generateSwordMesh({ bladeBaseThickness: 0.006 });
    const marginalCheck = structuralCheck(marginal.beam, { totalLength: marginal.meta.totalLength });
    assert.equal(marginalCheck.ok, false);
    assert.ok(Number.isFinite(marginalCheck.maxUtilization) && marginalCheck.maxUtilization > 1);

    const robust = generateSwordMesh({ bladeBaseThickness: 0.012 });
    const robustCheck = structuralCheck(robust.beam, { totalLength: robust.meta.totalLength });
    assert.equal(robustCheck.ok, true);
    assert.ok(Number.isFinite(robustCheck.maxUtilization) && robustCheck.maxUtilization < 1);

    // The gate genuinely discriminates — not a coin flip or a fixed verdict.
    assert.ok(robustCheck.maxUtilization < marginalCheck.maxUtilization);
  });
});

describe("Loop 4, Stage 3 — the full chain becomes visible, resolvable proof", () => {
  let db;
  before(() => { db = setupDb(); });
  after(() => { try { db?.close(); } catch { /* best-effort */ } });

  it("generate → validate → register → gate → promote → resolve: a real .glb a lens could actually load", async () => {
    const outDir = fs.mkdtempSync(path.join(tmpDir, "loop4-"));
    const params = { bladeBaseThickness: 0.012 }; // known-robust per Stage 2 above

    // ── Design/simulate: real engine result ─────────────────────────────
    const generated = await generateValidatedAsset({ archetype: "sword", params, outDir });
    assert.equal(generated.ok, true, `expected convergence, got ${JSON.stringify({ reason: generated.reason, error: generated.error })}`);
    assert.ok(fs.existsSync(generated.glbPath), "a real .glb must exist on disk");
    assert.equal(generated.feaResult.ok, true);
    assert.ok(Number.isFinite(generated.feaResult.maxUtilization) && generated.feaResult.maxUtilization < 1,
      "the packed asset's own recorded FEA result must be a real passing utilization number");
    assert.ok(Number.isFinite(generated.massProps.mass_kg) && generated.massProps.mass_kg > 0.05 && generated.massProps.mass_kg < 10,
      `mass_kg ${generated.massProps.mass_kg} outside sane hand-weapon range`);

    // ── Visible proof: register, gate, promote, resolve ─────────────────
    const sourceId = targetSourceId("sword", params);
    const reg = registerGeneratedAsset(db, {
      archetype: "sword", params, glbPath: generated.glbPath,
      massProps: generated.massProps, feaResult: generated.feaResult, sourceId,
    });
    assert.equal(reg.created, true);

    const gateResult = await submitAssetCandidateToGate({}, {
      assetId: reg.assetId,
      passKind: "authored_replacement",
      localPath: generated.glbPath,
      diffSummary: `e2e loop4 generated sword mass=${generated.massProps.mass_kg.toFixed(3)}kg util=${generated.feaResult.maxUtilization.toFixed(3)}`,
      parentDtuId: null,
    }, {
      createAtlasDtu: () => ({ id: "dtu-e2e-loop4-generated" }),
      runAutoPromoteGate: async () => ({ allowed: true }),
      promoteAtlasDtu: () => { /* no-op */ },
    });
    assert.equal(gateResult.verdict, "verified", `expected a VERIFIED gate verdict, got ${JSON.stringify(gateResult)}`);

    promoteVersion(db, reg.versionId);

    const resolved = resolveCurrentBest(db, { source: "evolved", sourceId });
    assert.ok(resolved, "the generated, gated, promoted asset must be resolvable — the real /api/evo-asset/resolve path");
    assert.equal(resolved.canonicalPath, generated.glbPath);
    assert.equal(resolved.qualityLevel, 1);

    // The resolved artifact is real, round-trippable triangle geometry — not
    // an empty stub file standing in for "success".
    const extracted = await extractMeshData(resolved.canonicalPath);
    assert.ok(extracted.positions.length > 0);
    assert.equal(extracted.positions.length % 3, 0);
    assert.ok(extracted.indices.length > 0);
    assert.equal(extracted.indices.length % 3, 0);
    const vertCount = extracted.positions.length / 3;
    for (let i = 0; i < extracted.indices.length; i++) {
      assert.ok(extracted.indices[i] < vertCount, "every triangle index must reference a real vertex");
    }
  });

  it("honesty gate holds inside the same E2E flow: an impossible spec never reaches the registry", async () => {
    const outDir = fs.mkdtempSync(path.join(tmpDir, "loop4-impossible-"));
    const result = await generateValidatedAsset({
      archetype: "sword",
      params: { bladeBaseThickness: 0.006 },
      tipLoadN: 100000,
      maxIters: 2,
      outDir,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "fea_did_not_converge");
    assert.deepEqual(fs.readdirSync(outDir), [], "no .glb, hence nothing to register — no fabricated 'visible proof'");
  });
});
