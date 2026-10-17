// tests/conkay-em-magnetostatic.test.js
//
// em.magnetostatic (lib/conkay/physics/solvers/em-magnetostatic.js) on the
// FEniCSx kernel (lib/conkay/em/fenicsx_magnetostatic_kernel.py via
// lib/conkay/em/fenicsx.js).
//
// Reference cases (tolerances fixed in em-magnetostatic.js, with citations, before any run):
//   (1) solenoid as a current-sheet pair: |B/(mu0 n I) - 1| <= 1e-3 inside, |B_out| <= 1e-3 mu0 n I;
//   (2) long straight conductor, inside and outside: |B/B_ref - 1| <= 1e-2;
//   (3) iron shell (mu_r 1000): |B/B_ref - 1| <= 1e-2; gapped core: |B_gap/B_circuit - 1| <= 5e-2, gain >= 50x;
//   (4) mesh convergence (h, h/2, h/4) of the conductor energy: decreasing, observed order >= 1.5.
//
// Kernel tests are skipped when the FEniCSx Python is not found (CONKAY_FENICSX_PYTHON / ~/.zuko/envs/fenicsx).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runPlanar2d, fenicsxPythonPath, magKernelKey } from "../lib/conkay/em/fenicsx.js";
import { clearKernelResults } from "../lib/conkay/cad/kernel-queue.js";
import { validateEmMagnetostatic, magConvergenceVerdict, wireB, wireRequest, MU0, SOLENOID_B, WIRE_ENERGY, CORE_B_GAP } from "../lib/conkay/physics/solvers/em-magnetostatic.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

const HAVE_FENICSX = fs.existsSync(fenicsxPythonPath());
const SKIP = !HAVE_FENICSX && `FEniCSx Python (${fenicsxPythonPath()}) not found`;

let shared = null;
const validation = () => (shared ??= validateEmMagnetostatic());
const magIr = (magnetics) => ({ nodes: [{ id: "BUS", kind: "Part", props: { magnetics } }] });
const report = (x) => JSON.stringify(x, (k, v) => (k === "result" ? undefined : v));

describe("registration and pure logic", () => {
  it("em.magnetostatic is registered with its declarations", () => {
    const s = listSolvers().find((x) => x.id === "em.magnetostatic");
    assert.ok(s);
    assert.equal(s.fidelity, 3);
    assert.match(s.method, /FEniCSx/);
    for (const k of ["reference", "regime", "units", "tolerance"]) assert.ok(s[k], k);
  });

  it("the analytic references are what the citations say", () => {
    assert.ok(Math.abs(SOLENOID_B - 4e-7 * Math.PI * 2000) < 1e-15);
    assert.ok(Math.abs(wireB(0.02) - 1e-3) < 1e-12, "mu0 I / (2 pi r) = 1 mT at r = 20 mm, I = 100 A");
    assert.ok(Math.abs(wireB(0.005) - 1e-3) < 1e-12, "mu0 I r / (2 pi a^2) = 1 mT at r = a/2");
    assert.ok(Math.abs(wireB(0.01 - 1e-12) - wireB(0.01 + 1e-12)) < 1e-9, "continuous at r = a");
    assert.ok(Math.abs(WIRE_ENERGY - 1e-3 * (0.25 + Math.log(50))) < 1e-12);
    assert.ok(CORE_B_GAP > 0.037 && CORE_B_GAP < 0.0375, `B_gap ${CORE_B_GAP}`);
    assert.ok(MU0 > 1.2566e-6 && MU0 < 1.2567e-6);
  });

  it("magConvergenceVerdict: passes second-order decay, fails a stall or a rise", () => {
    assert.equal(magConvergenceVerdict([0.04, 0.01, 0.0025], 1.5).pass, true);
    assert.equal(magConvergenceVerdict([0.04, 0.01, 0.008], 1.5).pass, false);
    assert.equal(magConvergenceVerdict([0.04, 0.05, 0.001], 1.5).pass, false);
  });

  it("a node with no probes is NOT_COMPUTED with the precise reason", () => {
    const { session } = openDesign(magIr({ domain: { type: "disk", r: 1 }, regions: [], h: 0.1 }));
    const r = session.result("em.magnetostatic@BUS");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.match(r.reason, /probes/);
  });

  it("a missing FEniCSx Python -> NOT_COMPUTED with the CONKAY_FENICSX_PYTHON reason (env var honoured)", async () => {
    const prev = process.env.CONKAY_FENICSX_PYTHON;
    process.env.CONKAY_FENICSX_PYTHON = "/nonexistent/python";
    try {
      assert.equal(fenicsxPythonPath(), "/nonexistent/python");
      const r = await runPlanar2d(wireRequest());
      assert.equal(r.ok, false);
      assert.match(r.unavailable, /CONKAY_FENICSX_PYTHON/);
      const v = await validateEmMagnetostatic();
      assert.ok(v.cases.every((c) => c.status === "NOT_COMPUTED" && c.pass === false && /CONKAY_FENICSX_PYTHON/.test(c.reason)));
      assert.equal(v.convergence.status, "NOT_COMPUTED");
    } finally {
      if (prev === undefined) delete process.env.CONKAY_FENICSX_PYTHON; else process.env.CONKAY_FENICSX_PYTHON = prev;
    }
  });
});

describe("reference cases (real FEniCSx runs)", { skip: SKIP }, async () => {
  const v = await validation();
  const byId = (id) => v.cases.find((c) => c.id === id);
  if (process.env.CONKAY_MAG_REPORT) console.log(report(v));

  it("(1) solenoid / current-sheet pair: B = mu0 n I inside within 1e-3, ~0 outside", () => {
    const c = byId("solenoid-current-sheet-pair");
    assert.equal(c.status, "PASS", report(c));
    assert.match(c.result.dolfinxVersion, /^0\.\d+/);
  });

  it("(2) long straight conductor: inside and outside within 1e-2", () => {
    assert.equal(byId("straight-conductor-inside-outside").status, "PASS", report(byId("straight-conductor-inside-outside")));
  });

  it("(3a) iron shell mu_r = 1000: B = mu_r mu0 H in the iron, H unchanged, within 1e-2", () => {
    assert.equal(byId("iron-shell-permeability").status, "PASS", report(byId("iron-shell-permeability")));
  });

  it("(3b) gapped core: B_gap within 5e-2 of the magnetic-circuit value, >= 50x the air-only field", () => {
    assert.equal(byId("gapped-core-magnetic-circuit").status, "PASS", report(byId("gapped-core-magnetic-circuit")));
  });

  it("(4) mesh convergence h, h/2, h/4 of the conductor energy: decreasing, observed order >= 1.5", () => {
    assert.equal(v.convergence.status, "PASS", report(v.convergence));
  });
});

describe("through the design graph", { skip: SKIP }, () => {
  const mag = (extra) => ({ ...wireRequest(2), ...extra });

  it("settle() runs the kernel: PASS / FAIL from the stated criterion, WARN with none", async () => {
    clearKernelResults();
    const cases = [
      [{ maxFluxDensity: { value: 2e-3, source: "busbar spec" } }, "PASS"],
      [{ maxFluxDensity: { value: 5e-4, source: "deliberately tight" } }, "FAIL"],
      [{}, "WARN"],
    ];
    for (const [extra, status] of cases) {
      const { session } = openDesign(magIr(mag(extra)));
      if (status === "PASS") assert.equal(session.result("em.magnetostatic@BUS").status, "NOT_COMPUTED", "pending before settle");
      await session.settle();
      const r = session.result("em.magnetostatic@BUS");
      assert.equal(r.status, status, JSON.stringify(r.reason || r.warnings));
      // the largest probe field is 1 mT (r = a/2 and r = 2a)
      assert.ok(Math.abs(r.outputs.maxFluxDensity.value - 1e-3) < 2e-5, `max B ${r.outputs.maxFluxDensity.value}`);
    }
    assert.match(magKernelKey(wireRequest()), /^em:magnetostatic:/);
  });

  it("times out honestly", async () => {
    const r = await runPlanar2d(wireRequest(0.5), { timeoutMs: 50 });
    assert.equal(r.ok, false);
    assert.match(r.error, /timed out/);
  });
});
