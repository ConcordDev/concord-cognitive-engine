// server/tests/conkay-cad-mesh-generate.test.js
//
// SX-CAD-01 — mesh.generate acceptance tests.
// Reference case: the catalogue's unit cube mesh quality case — a unit
// cube at 1x1x1 divisions has exactly 8 nodes, 1 cell, cell volume 1,
// aspect ratio 1 (the gmsh/Netgen quality vocabulary). Expected values
// are exact integers/rationals of the inputs, never solver echoes.
//
// Engine honesty is the spine of this ticket at wave 0: the L3 tier
// (gmsh SXE-06, Netgen SXE-11 — both unbuilt) must answer
// NOT_COMPUTED engine_unavailable naming both engines, and the
// in-process tier must be labelled screening everywhere it appears —
// never a quiet downgrade, never a screening number labelled L3.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { meshGenerate } from "../lib/conkay/cad/mesh-generate.js";
import { getSolver, listSolvers, envelope } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertEchoIntegrity, assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

describe("SX-CAD-01 — reference case (unit cube mesh quality)", () => {
  it("unit cube at 1x1x1: 8 nodes, 1 cell, volume 1, aspect 1", () => {
    const r = meshGenerate({ shape: "box", dims: { length: 1, width: 1, height: 1 }, divisions: { nx: 1, ny: 1, nz: 1 } });
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.nodes, 8);
    assert.equal(r.outputs.cells, 1);
    assert.equal(r.outputs.minCellVolumeM3, 1);
    assert.equal(r.outputs.maxCellVolumeM3, 1);
    assert.equal(r.outputs.maxAspectRatio, 1);
    assert.equal(r.outputs.quality.withinThresholds, true);
  });

  it("the screening tier is labelled, and the engine tier is NOT_COMPUTED naming both engines", () => {
    const r = meshGenerate({ shape: "box", dims: { length: 1, width: 1, height: 1 }, divisions: { nx: 1, ny: 1, nz: 1 } });
    assert.equal(r.outputs.screening, true);
    assert.equal(r.outputs.tier, "screening-structured");
    assert.equal(r.outputs.engineTier.status, "NOT_COMPUTED");
    assert.match(r.outputs.engineTier.reason, /engine_unavailable:sxe-06/);
    assert.match(r.outputs.engineTier.reason, /engine_unavailable:sxe-11/);
    assert.ok(r.warnings.some((w) => /engine_unavailable:sxe-06/.test(w)));
  });

  it("refinement trend: doubling every division count multiplies cells by 8, divides cell volume by 8", () => {
    const a = meshGenerate({ shape: "box", dims: { length: 2, width: 2, height: 2 }, divisions: { nx: 2, ny: 2, nz: 2 } });
    const b = meshGenerate({ shape: "box", dims: { length: 2, width: 2, height: 2 }, divisions: { nx: 4, ny: 4, nz: 4 } });
    assert.equal(b.outputs.cells, a.outputs.cells * 8);
    assert.equal(b.outputs.minCellVolumeM3, a.outputs.minCellVolumeM3 / 8);
  });

  it("targetSizeM derives divisions from the dimensions", () => {
    const r = meshGenerate({ shape: "box", dims: { length: 2, width: 1, height: 1 }, targetSizeM: 0.5 });
    assert.equal(r.outputs.cells, 4 * 2 * 2);
  });

  it("an over-aspect mesh is returned with the quality violation named (WARN)", () => {
    const r = meshGenerate({ shape: "box", dims: { length: 100, width: 1, height: 1 }, divisions: { nx: 1, ny: 1, nz: 1 } });
    assert.equal(r.outputs.quality.withinThresholds, false);
    assert.ok(r.warnings.some((w) => /quality violation/.test(w)));
    const env = envelope(getSolver("mesh.generate"), "P1", r, { runtimeMs: 1, revision: 0 });
    assert.equal(env.status, "WARN");
  });
});

describe("SX-CAD-01 — adversarial + honesty legs", () => {
  it("a non-box shape is NOT_COMPUTED engine_unavailable — no screening path, no downgrade", () => {
    const r = meshGenerate({ shape: "sphere", dims: { radius: 1 }, divisions: { nx: 1, ny: 1, nz: 1 } });
    assert.match(r.notComputed, /engine_unavailable:sxe-06/);
    assert.match(r.notComputed, /engine_unavailable:sxe-11/);
  });

  it("negative / NaN / 1e300 dims are INVALID_INPUT naming the field", () => {
    for (const bad of [-1, NaN, 1e300]) {
      const r = meshGenerate({ shape: "box", dims: { length: bad, width: 1, height: 1 }, divisions: { nx: 1, ny: 1, nz: 1 } });
      assert.match(r.notComputed, /INVALID_INPUT: dims\.length/);
    }
  });

  it("non-integer or zero divisions are INVALID_INPUT; over-cap is out of envelope, named", () => {
    const a = meshGenerate({ shape: "box", dims: { length: 1, width: 1, height: 1 }, divisions: { nx: 1.5, ny: 1, nz: 1 } });
    assert.match(a.notComputed, /INVALID_INPUT: divisions\.nx/);
    const b = meshGenerate({ shape: "box", dims: { length: 1, width: 1, height: 1 }, divisions: { nx: 513, ny: 1, nz: 1 } });
    assert.match(b.notComputed, /mesh_out_of_envelope/);
  });

  it("missing divisions are NOT_COMPUTED naming the field (SC-05) — no assumed resolution", async () => {
    await assertNothingAssumed(
      (p) => meshGenerate(p),
      { shape: "box", dims: { length: 1, width: 1, height: 1 }, divisions: { nx: 1, ny: 1, nz: 1 } },
      ["divisions"],
      "mesh.generate"
    );
  });

  it("echo integrity + citations through the envelope (SC-05)", () => {
    const s = getSolver("mesh.generate");
    const raw = meshGenerate({ shape: "box", dims: { length: 1, width: 1, height: 1 }, divisions: { nx: 1, ny: 1, nz: 1 } });
    const env = envelope(s, "P1", raw, { runtimeMs: 1, revision: 0 });
    assert.equal(env.outputs.screening, true);
    assertCitationsDomain(env, s, "mesh.generate");
  });
});

describe("SX-CAD-01 — registry + IR reachability", () => {
  it("is registered at L3 with the engine dependency listed (SXC-20's data source)", () => {
    const s = listSolvers().find((x) => x.id === "mesh.generate");
    assert.ok(s, "mesh.generate not in the registry");
    assert.equal(s.fidelity, 3);
    assert.ok(s.regime && s.units && s.tolerance);
    // engineDependent rides the frozen descriptor (getSolver). The
    // listSolvers() projection drops it at this build — SXC-20's
    // regeneration must extend the projection or read descriptors;
    // named in the ticket's check file, not silently worked around.
    assert.deepEqual(getSolver("mesh.generate").engineDependent, ["sxe-06", "sxe-11"]);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "cad1", name: "CAD1" },
      nodes: [
        {
          id: "P1",
          kind: "Part",
          name: "block",
          props: { "cad.mesh": { shape: "box", dims: { length: 1, width: 1, height: 1 }, divisions: { nx: 2, ny: 2, nz: 2 } } },
        },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "mesh.generate@P1");
    assert.ok(env, "no mesh.generate envelope");
    assert.equal(env.outputs.cells, 8);
    assert.equal(env.outputs.engineTier.status, "NOT_COMPUTED");
  });
});
