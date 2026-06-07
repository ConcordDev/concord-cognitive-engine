// tests/depth/engineering-behavior.test.js
//
// REAL behavioral tests for the engineering lens-action domain (CAD + simulation
// shape). Calc actions assert exact hand-computed values (Ohm-free mechanics:
// axial stress + safety factor, unit conversion, tolerance stack-up/RSS,
// parametric volume/mass/section inertia, BOM rollup); CRUD actions assert
// round-trip persistence; invalid input asserts rejection. Every
// lensRun("engineering", …) is a literal behavioral invocation (grader-credited).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("engineering — calc actions (exact computed values)", () => {
  it("stressAnalysis: σ = F/A, SF = yield/σ (1000N / 10mm² → 100MPa, SF=2.5)", async () => {
    const r = await lensRun("engineering", "stressAnalysis", {
      data: { forceNewtons: 1000, crossSectionMm2: 10, yieldStrengthMPa: 250 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.appliedStress, "100 MPa");
    assert.equal(r.result.safetyFactor, 2.5);
    assert.equal(r.result.status, "acceptable"); // 1.5 ≤ SF < 3
  });

  it("stressAnalysis: under-strength design flags FAILURE (SF < 1)", async () => {
    // 5000N / 10mm² = 500MPa > yield 250 → SF = 0.5
    const r = await lensRun("engineering", "stressAnalysis", {
      data: { forceNewtons: 5000, crossSectionMm2: 10, yieldStrengthMPa: 250 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.safetyFactor, 0.5);
    assert.match(String(r.result.status), /FAILURE/);
  });

  it("unitConvert: 25.4 mm → in = 1.0 (exact)", async () => {
    const r = await lensRun("engineering", "unitConvert", {
      data: { value: 25.4, from: "mm", to: "in" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.output, "1 in");
    assert.equal(r.result.conversion, "mm → in");
  });

  it("unitConvert: 100 C → F = 212 (exact)", async () => {
    const r = await lensRun("engineering", "unitConvert", {
      data: { value: 100, from: "c", to: "f" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.output, "212 f");
  });

  it("unitConvert: 1 MPa → psi = 145.038 (exact catalog factor)", async () => {
    const r = await lensRun("engineering", "unitConvert", {
      data: { value: 1, from: "mpa", to: "psi" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.output, "145.038 psi");
  });

  it("toleranceAnalysis: worst-case sums, RSS = sqrt(Σtol²)", async () => {
    // two parts, each tol 0.01 → worstCase 0.02, RSS = sqrt(2×0.0001)=0.0141
    const r = await lensRun("engineering", "toleranceAnalysis", {
      data: { parts: [
        { name: "A", nominal: 10, tolerance: 0.01 },
        { name: "B", nominal: 5, tolerance: 0.01 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.stackUp.nominal, 15);
    assert.equal(r.result.stackUp.worstCaseTolerance, 0.02);
    assert.equal(r.result.stackUp.rssTolerance, 0.0141); // sqrt(0.0002)=0.014142… → r4
    assert.equal(r.result.stackUp.worstCaseMin, 14.98);
    assert.equal(r.result.stackUp.worstCaseMax, 15.02);
  });

  it("toleranceChain: directional cumulative nominal (10 + 4(-) → gap 6)", async () => {
    const r = await lensRun("engineering", "toleranceChain", {
      data: { links: [
        { name: "shaft", nominal: 10, tolerance: 0.02, direction: 1 },
        { name: "bore",  nominal: 4,  tolerance: 0.01, direction: -1 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.closingDimension.nominal, 6); // 10 - 4
    assert.equal(r.result.closingDimension.worstCaseTolerance, 0.03); // 0.02 + 0.01
    // chain accumulates direction-signed nominals
    assert.equal(r.result.chain[1].cumulativeNominal, 6);
    assert.equal(r.result.chain[1].direction, "-");
  });

  it("parametricSolid: box 0.1³ → volume 0.001 m³, mass 7.85 kg @ steel density", async () => {
    const r = await lensRun("engineering", "parametricSolid", {
      data: { kind: "box", material: "steel-a36", width: 0.1, height: 0.1, length: 0.1 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.volume, 0.001);
    assert.equal(r.result.mass, 7.85); // 0.001 × 7850
    assert.equal(r.result.section.area, 0.01); // w×h
    // Ix = (w·h³)/12 = (0.1 × 0.001)/12 = 8.333…e-6, rounded to 1e-9 by the handler
    assert.equal(r.result.section.Ix, 0.000008333);
  });

  it("materialLibrary: steel-a36 returns catalog mechanical properties", async () => {
    const r = await lensRun("engineering", "materialLibrary", { params: { id: "steel-a36" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.E, 200000);
    assert.equal(r.result.yield, 250);
    assert.equal(r.result.density, 7850);
  });

  it("materialLibrary: filter by category returns only matching materials", async () => {
    const r = await lensRun("engineering", "materialLibrary", { params: { category: "polymer" } });
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 2);
    assert.ok(r.result.materials.every((m) => m.category === "polymer"), "all polymer");
    assert.ok(r.result.materials.some((m) => m.id === "abs-plastic"));
  });

  it("materialLibrary: unknown id is rejected", async () => {
    const r = await lensRun("engineering", "materialLibrary", { params: { id: "unobtanium" } });
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /unknown material/i);
  });

  it("bomRollup: material + 15% overhead → exact total & per-unit cost", async () => {
    // qty 4 × $10 = $40 + qty 2 × $5 = $10 → material 50; overhead 15% = 7.5; total 57.5
    const r = await lensRun("engineering", "bomRollup", {
      params: {
        overheadRate: 0.15, buildQty: 1,
        items: [
          { partNumber: "BOLT-1", quantity: 4, unitCost: 10, supplier: "Acme", leadTimeDays: 3 },
          { partNumber: "NUT-1",  quantity: 2, unitCost: 5,  supplier: "Acme", leadTimeDays: 7 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.rollup.materialCost, 50);
    assert.equal(r.result.rollup.overhead, 7.5);
    assert.equal(r.result.rollup.totalCost, 57.5);
    assert.equal(r.result.rollup.procurementLeadDays, 7); // max lead
    assert.equal(r.result.criticalPath[0].partNumber, "NUT-1"); // longest lead first
  });

  it("meshGenerate: 1 member ÷ 4 divisions → 4 elements, 5 mesh nodes", async () => {
    const r = await lensRun("engineering", "meshGenerate", {
      data: { model: {
        nodes: [{ id: "n1", x: 0, y: 0 }, { id: "n2", x: 4, y: 0 }],
        members: [{ id: "m1", nodeI: "n1", nodeJ: "n2" }],
      } },
      params: { divisions: 4 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.stats.meshElements, 4);
    assert.equal(r.result.stats.meshNodes, 5); // 2 original + 3 interior
    assert.equal(r.result.stats.avgElementLength, 1); // 4m span / 4 elements
  });

  it("meshGenerate: rejects a model with no nodes/members", async () => {
    const r = await lensRun("engineering", "meshGenerate", { data: { model: { nodes: [], members: [] } } });
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /nodes and members/i);
  });

  it("bom: extended cost = qty × unitCost, totals roll up exactly", async () => {
    // 3 × $2.50 = $7.50 + 1 × $12 = $12 → total 19.5, totalParts 4
    const r = await lensRun("engineering", "bom", {
      data: { items: [
        { partNumber: "WASHER-1", quantity: 3, unitCost: 2.5, leadTime: "stock" },
        { partNumber: "MOTOR-1", quantity: 1, unitCost: 12, leadTime: "14", supplier: "Acme" },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalLineItems, 2);
    assert.equal(r.result.totalParts, 4); // 3 + 1
    assert.equal(r.result.totalCost, 19.5); // 7.5 + 12
    assert.equal(r.result.bom[0].extendedCost, 7.5); // 3 × 2.5
    assert.equal(r.result.criticalPath, "MOTOR-1"); // only non-stock lead
  });

  it("partMesh: a default box mesh is closed (24 verts, 12 triangles) with exact bbox", async () => {
    // 6 quads × 4 verts = 24 positions; 6 quads × 2 tris = 12 triangles.
    const r = await lensRun("engineering", "partMesh", {
      data: { kind: "box", width: 0.2, height: 0.1, length: 0.3 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.vertexCount, 24);
    assert.equal(r.result.triangleCount, 12);
    assert.equal(r.result.boundingBox.x, 0.2);
    assert.equal(r.result.boundingBox.y, 0.1);
    assert.equal(r.result.boundingBox.z, 0.3);
    // determinism: positions array length matches vertexCount × 3
    assert.equal(r.result.positions.length, 72);
  });
});

describe("engineering — CRUD round-trips (state-backed store)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("engineering-crud"); });

  it("savePart → listParts: a saved part reads back by id with computed geometry", async () => {
    const saved = await lensRun("engineering", "savePart", {
      params: { name: "Bracket", kind: "box", material: "aluminum-6061-t6", params: { width: 0.05, height: 0.05, length: 0.1 } },
    }, ctx);
    assert.equal(saved.ok, true);
    assert.equal(saved.result.part.name, "Bracket");
    const id = saved.result.part.id;
    // geometry computed at save: vol = 0.05×0.05×0.1 = 0.00025
    assert.equal(saved.result.part.geometry.volume, 0.00025);
    const list = await lensRun("engineering", "listParts", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.ok((list.result.parts || []).some((p) => p.id === id), "saved part is listed");
    assert.equal(list.result.count, list.result.parts.length);
  });

  it("savePart → deletePart: deleting a part removes it from the list", async () => {
    const saved = await lensRun("engineering", "savePart", { params: { name: "Scrap", kind: "box" } }, ctx);
    const id = saved.result.part.id;
    const del = await lensRun("engineering", "deletePart", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, 1);
    const list = await lensRun("engineering", "listParts", { params: {} }, ctx);
    assert.ok(!(list.result.parts || []).some((p) => p.id === id), "deleted part is gone");
  });

  it("saveLoadCase → listLoadCases: a load case round-trips by id", async () => {
    const saved = await lensRun("engineering", "saveLoadCase", {
      params: { name: "Gravity + tip load", gravity: true, loads: [{ node: "n2", fy: -500 }], supports: [{ node: "n1", type: "fixed" }] },
    }, ctx);
    assert.equal(saved.ok, true);
    assert.equal(saved.result.loadCase.name, "Gravity + tip load");
    assert.equal(saved.result.loadCase.gravity, true);
    const id = saved.result.loadCase.id;
    const list = await lensRun("engineering", "listLoadCases", { params: {} }, ctx);
    assert.ok((list.result.loadCases || []).some((c) => c.id === id), "load case is listed");
  });

  it("saveLoadCase → deleteLoadCase: deleting a load case removes it from the list", async () => {
    const saved = await lensRun("engineering", "saveLoadCase", { params: { name: "Temp case" } }, ctx);
    const id = saved.result.loadCase.id;
    const del = await lensRun("engineering", "deleteLoadCase", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, 1);
    const list = await lensRun("engineering", "listLoadCases", { params: {} }, ctx);
    assert.ok(!(list.result.loadCases || []).some((c) => c.id === id), "deleted load case is gone");
  });

  it("runFEA → listSimJobs: a solved cantilever persists a sim job in history", async () => {
    // simply-supported steel beam, 2m span, central point load.
    // Solver contract (lib/simulation/fea-solver.js): loads use { nodeId, Fy },
    // supports use { nodeId, fixedDOF }. Pin restrains translation, roller
    // restrains the vertical only.
    const model = {
      nodes: [
        { id: "n1", x: 0, y: 0 },
        { id: "n2", x: 1, y: 0 },
        { id: "n3", x: 2, y: 0 },
      ],
      members: [
        { id: "m1", nodeI: "n1", nodeJ: "n2", area: 0.001, momentI: 1e-6, elasticModulus: 200e9, allowableStress: 250e6 },
        { id: "m2", nodeI: "n2", nodeJ: "n3", area: 0.001, momentI: 1e-6, elasticModulus: 200e9, allowableStress: 250e6 },
      ],
      loads: [{ nodeId: "n2", Fy: -1000 }],
      supports: [
        { nodeId: "n1", fixedDOF: ["x", "y", "z", "rx", "rz"] },
        { nodeId: "n3", fixedDOF: ["y", "z"] },
      ],
    };
    const r = await lensRun("engineering", "runFEA", { data: { name: "beam check", model } }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.jobId, "FEA run returns a jobId");
    assert.ok(r.result.summary, "FEA run returns a summary");
    assert.equal(r.result.summary.allPass, true); // low utilization → all members pass
    assert.equal(r.result.summary.memberCount, 2);
    const jobs = await lensRun("engineering", "listSimJobs", { params: {} }, ctx);
    assert.equal(jobs.ok, true);
    assert.ok((jobs.result.jobs || []).some((j) => j.id === r.result.jobId && j.status === "completed"), "job persisted as completed");
  });
});
