// tests/conkay-solid-stress.test.js
//
// fea.solid3d (lib/conkay/physics/solvers/solid-stress.js) on the CalculiX
// kernel (lib/conkay/fea/calculix_kernel.py via lib/conkay/fea/calculix.js):
// STEP solid -> gmsh 10-node tets -> CalculiX deck -> ccx -> .frd.
//
// Reference cases (tolerances fixed in solid-stress.js with their citations):
//   - cantilever tip deflection vs PL^3/3EI, within 2 %;
//   - quarter-symmetric plate with a hole, Kt vs Heywood 3.032 +/- 0.10;
//   - mesh convergence of both (element size halved each step; final change <= 0.5 % / 1 %, changes non-increasing).
//
// Kernel tests are skipped when the gmsh Python or ccx is not found
// (CONKAY_FEA_PYTHON / CONKAY_OCC_PYTHON / ~/.zuko/venvs/cad-occ; CONKAY_CCX).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runSolidStatic, feaPythonPath, ccxPath, feaKernelKey, CCX_UNAVAILABLE } from "../lib/conkay/fea/calculix.js";
import { clearKernelResults } from "../lib/conkay/cad/kernel-queue.js";
import { validateSolid3d, convergenceVerdict, cantileverRequest, CANTILEVER, CANTILEVER_DEFLECTION, PLATE_KT_HEYWOOD } from "../lib/conkay/physics/solvers/solid-stress.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

const HAVE_KERNEL = fs.existsSync(feaPythonPath()) && fs.existsSync(ccxPath());
const SKIP = !HAVE_KERNEL && `gmsh Python (${feaPythonPath()}) or ccx (${ccxPath()}) not found`;

let shared = null;
const validation = () => (shared ??= validateSolid3d());

const solidIr = (fea) => ({ nodes: [{ id: "BEAM", kind: "Part", props: { fea } }] });

describe("registration and pure logic", () => {
  it("fea.solid3d is registered with its declarations", () => {
    const s = listSolvers().find((x) => x.id === "fea.solid3d");
    assert.ok(s);
    assert.equal(s.fidelity, 3);
    assert.match(s.method, /CalculiX/);
    assert.match(s.method, /gmsh/);
    for (const k of ["reference", "regime", "units", "tolerance"]) assert.ok(s[k], k);
  });

  it("the analytical references are what the citations say", () => {
    assert.ok(Math.abs(CANTILEVER_DEFLECTION - 0.190476) < 1e-6);
    assert.ok(Math.abs(PLATE_KT_HEYWOOD - 3.0323) < 1e-4);
  });

  it("convergenceVerdict: passes a converging sequence, fails a growing change or a large final step", () => {
    assert.equal(convergenceVerdict([1.0, 1.01, 1.012], 0.005).pass, true);
    assert.equal(convergenceVerdict([1.0, 1.001, 1.02], 0.005).pass, false);
    assert.equal(convergenceVerdict([1.0, 1.1, 1.15], 0.005).pass, false);
  });

  it("a node with no STEP is NOT_COMPUTED with the precise reason", () => {
    const { session } = openDesign(solidIr({ material: { E: 1, nu: 0.3 } }));
    const r = session.result("fea.solid3d@BEAM");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.match(r.reason, /STEP/);
  });

  it("a missing ccx -> NOT_COMPUTED with the CONKAY_CCX reason (env var honoured)", async () => {
    const prev = process.env.CONKAY_CCX;
    process.env.CONKAY_CCX = "/nonexistent/ccx";
    try {
      assert.equal(ccxPath(), "/nonexistent/ccx");
      const r = await runSolidStatic(cantileverRequest(5));
      assert.equal(r.ok, false);
      assert.equal(r.unavailable, CCX_UNAVAILABLE);
      const v = await validateSolid3d();
      assert.ok(v.cases.every((c) => c.pass === false && /CONKAY_CCX/.test(c.reason)));
      assert.ok(v.convergence.every((c) => c.pass === false));
    } finally {
      if (prev === undefined) delete process.env.CONKAY_CCX; else process.env.CONKAY_CCX = prev;
    }
  });
});

describe("reference cases (real gmsh + CalculiX runs)", { skip: SKIP }, async () => {
  const v = await validation();
  const byId = (id) => v.cases.find((c) => c.id === id);
  const conv = (id) => v.convergence.find((c) => c.id === id);

  it("cantilever tip deflection = PL^3/3EI within 2 %", () => {
    const c = byId("cantilever-tip-deflection");
    assert.equal(c.pass, true, JSON.stringify({ computed: c.computed, reference: c.reference, reason: c.reason }));
    assert.ok(Math.abs(c.result.appliedForce[1] + CANTILEVER.P) < 1e-9, "the deck carries exactly the applied load");
    assert.equal(c.result.elementType, "C3D10");
  });

  it("plate with a hole: Kt = 3.03 +/- 0.10 (Heywood), peak at the hole edge on the net section", () => {
    const c = byId("plate-hole-Kt");
    assert.equal(c.pass, true, JSON.stringify({ computed: c.computed, reference: c.reference, reason: c.reason }));
    const at = c.result.stressProbes[0].components.sxx.at;
    assert.ok(Math.abs(at[0]) < 1 && Math.abs(at[1] - 10) < 0.1, `peak at ${at}`);
  });

  it("mesh convergence: cantilever deflection and hole peak stress", () => {
    for (const id of ["cantilever-deflection-convergence", "plate-hole-peak-stress-convergence"]) {
      const c = conv(id);
      assert.equal(c.pass, true, JSON.stringify(c));
    }
  });
});

describe("through the design graph (a real STEP file)", { skip: SKIP }, () => {
  let step;
  before(() => {
    step = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "conkay-solid-")), "beam.step");
    execFileSync(feaPythonPath(), ["-c", `import gmsh,sys\ngmsh.initialize(["-noenv"])\ngmsh.option.setNumber("General.Terminal",0)\ngmsh.model.occ.addBox(0,0,0,100,10,10)\ngmsh.model.occ.synchronize()\ngmsh.write(sys.argv[1])\ngmsh.finalize()`, step], { stdio: "ignore" });
  });
  const fea = (extra) => ({
    step, material: { E: 210000, nu: 0.3, source: "structural steel" },
    supports: [{ bbox: [0, 0, 0, 0, 10, 10] }], loads: [{ bbox: [100, 0, 0, 100, 10, 10], force: [0, -100, 0] }],
    mesh: { size: 5 }, displacementProbes: [{ name: "tip", bbox: [100, 0, 0, 100, 10, 10] }], ...extra,
  });

  it("settle() runs the kernel: PASS against a generous allowable, FAIL against a tight one, WARN with none", async () => {
    clearKernelResults();
    const cases = [
      [{ allowableStress: { value: 250, source: "S235 yield" } }, "PASS"],
      [{ allowableStress: { value: 10, source: "deliberately tight" } }, "FAIL"],
      [{}, "WARN"],
    ];
    for (const [extra, status] of cases) {
      const { session } = openDesign(solidIr(fea(extra)));
      if (status === "PASS") assert.equal(session.result("fea.solid3d@BEAM").status, "NOT_COMPUTED", "pending before settle (later nodes reuse the cached run: criteria are not part of the kernel request)");
      await session.settle();
      const r = session.result("fea.solid3d@BEAM");
      assert.equal(r.status, status, JSON.stringify(r.reason || r.warnings));
      const tip = -r.outputs.displacementProbes.value[0].mean[1];
      assert.ok(Math.abs(tip - CANTILEVER_DEFLECTION) / CANTILEVER_DEFLECTION < 0.02, `tip ${tip}`);
      // root bending stress 6PL/bh^2 = 60 MPa is the right magnitude for the peak
      assert.ok(r.outputs.maxVonMises.value > 40 && r.outputs.maxVonMises.value < 120);
    }
    assert.match(feaKernelKey({ step }), /^fea:solid3d:/);
  });

  it("times out honestly when ccx exceeds its deadline", async () => {
    const r = await runSolidStatic(cantileverRequest(1.5), { timeoutMs: 50 });
    assert.equal(r.ok, false);
    assert.match(r.error, /timed out/);
  });

  it("a STEP that does not exist is an error, not a guess", async () => {
    const r = await runSolidStatic({ ...cantileverRequest(5), geometry: undefined, step: "/nonexistent/x.step" });
    assert.equal(r.ok, false);
    assert.match(r.error, /STEP file not found/);
  });
});
