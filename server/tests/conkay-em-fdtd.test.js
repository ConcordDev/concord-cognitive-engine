// tests/conkay-em-fdtd.test.js
//
// em.fdtd (lib/conkay/physics/solvers/em-fdtd.js) on the Meep kernel
// (lib/conkay/em/meep_kernel.py via lib/conkay/em/meep.js).
//
// Reference cases (tolerances fixed in em-fdtd.js with their citations):
//   - Fresnel normal incidence, vacuum -> n = 2: |R - 1/9| <= 5e-3 (resolution 40);
//   - dielectric slab (n = 1.5, d = 1) Fabry-Perot: |T - T_Airy| <= 1e-2, |R + T - 1| <= 1e-3 (resolution 40);
//   - resolution convergence 20/40/80 of the slab error: decreasing, observed order >= 1.5.
//
// Kernel tests are skipped when the Meep Python is not found (CONKAY_MEEP_PYTHON / ~/.zuko/envs/meep).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runStack1d, meepPythonPath, emKernelKey } from "../lib/conkay/em/meep.js";
import { clearKernelResults } from "../lib/conkay/cad/kernel-queue.js";
import { validateEmFdtd, emConvergenceVerdict, airyTransmission, FRESNEL_R, slabRequest } from "../lib/conkay/physics/solvers/em-fdtd.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

const HAVE_MEEP = fs.existsSync(meepPythonPath());
const SKIP = !HAVE_MEEP && `Meep Python (${meepPythonPath()}) not found`;

let shared = null;
const validation = () => (shared ??= validateEmFdtd());
const emIr = (em) => ({ nodes: [{ id: "WIN", kind: "Part", props: { em } }] });
const report = (x) => JSON.stringify(x, (k, v) => (k === "result" ? undefined : v));

describe("registration and pure logic", () => {
  it("em.fdtd is registered with its declarations", () => {
    const s = listSolvers().find((x) => x.id === "em.fdtd");
    assert.ok(s);
    assert.equal(s.fidelity, 3);
    assert.match(s.method, /Meep/);
    for (const k of ["reference", "regime", "units", "tolerance"]) assert.ok(s[k], k);
  });

  it("the analytic references are what the citations say", () => {
    assert.ok(Math.abs(FRESNEL_R - 1 / 9) < 1e-15);
    assert.ok(Math.abs(airyTransmission(1) - 1) < 1e-12, "resonance: n d f = 1.5 (an integer number of half-waves)");
    const r2 = 0.04; // ((1.5 - 1) / 2.5)^2
    assert.ok(Math.abs(airyTransmission(1 / 6) - 1 / (1 + (4 * r2) / (1 - r2) ** 2)) < 1e-12, "quarter-wave minimum 1/(1+F)");
  });

  it("emConvergenceVerdict: passes second-order decay, fails a stall or a rise", () => {
    assert.equal(emConvergenceVerdict([0.04, 0.01, 0.0025], 1.5).pass, true);
    assert.equal(emConvergenceVerdict([0.04, 0.01, 0.008], 1.5).pass, false);
    assert.equal(emConvergenceVerdict([0.04, 0.05, 0.001], 1.5).pass, false);
  });

  it("a node with no layers is NOT_COMPUTED with the precise reason", () => {
    const { session } = openDesign(emIr({ fcen: 1, df: 0.5 }));
    const r = session.result("em.fdtd@WIN");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.match(r.reason, /layers/);
  });

  it("a missing Meep Python -> NOT_COMPUTED with the CONKAY_MEEP_PYTHON reason (env var honoured)", async () => {
    const prev = process.env.CONKAY_MEEP_PYTHON;
    process.env.CONKAY_MEEP_PYTHON = "/nonexistent/python";
    try {
      assert.equal(meepPythonPath(), "/nonexistent/python");
      const r = await runStack1d(slabRequest(20));
      assert.equal(r.ok, false);
      assert.match(r.unavailable, /CONKAY_MEEP_PYTHON/);
      const v = await validateEmFdtd();
      assert.ok(v.cases.every((c) => c.status === "NOT_COMPUTED" && c.pass === false && /CONKAY_MEEP_PYTHON/.test(c.reason)));
      assert.equal(v.convergence.status, "NOT_COMPUTED");
    } finally {
      if (prev === undefined) delete process.env.CONKAY_MEEP_PYTHON; else process.env.CONKAY_MEEP_PYTHON = prev;
    }
  });
});

describe("reference cases (real Meep runs)", { skip: SKIP }, async () => {
  const v = await validation();
  const byId = (id) => v.cases.find((c) => c.id === id);

  it("Fresnel normal incidence n = 2: |R - 1/9| <= 5e-3", () => {
    const c = byId("fresnel-normal-incidence-n2");
    assert.equal(c.status, "PASS", report(c));
    assert.match(c.result.meepVersion, /^1\.35/);
  });

  it("dielectric slab Fabry-Perot: |T - T_Airy| <= 1e-2 and R + T = 1 within 1e-3", () => {
    const c = byId("slab-fabry-perot-transmission");
    assert.equal(c.status, "PASS", report(c));
  });

  it("resolution convergence 20/40/80: error decreasing, observed order >= 1.5", () => {
    assert.equal(v.convergence.status, "PASS", report(v.convergence));
  });
});

describe("through the design graph", { skip: SKIP }, () => {
  const em = (extra) => ({ layers: [{ n: 1.5, thickness: 1 }], fcen: 1, df: 1, nfreq: 51, resolution: 40, ...extra });

  it("settle() runs the kernel: PASS / FAIL from the stated criterion, WARN with none", async () => {
    clearKernelResults();
    const cases = [
      [{ minTransmittance: { value: 0.8, source: "window spec" } }, "PASS"],
      [{ minTransmittance: { value: 0.95, source: "deliberately tight" } }, "FAIL"],
      [{}, "WARN"],
    ];
    for (const [extra, status] of cases) {
      const { session } = openDesign(emIr(em(extra)));
      if (status === "PASS") assert.equal(session.result("em.fdtd@WIN").status, "NOT_COMPUTED", "pending before settle");
      await session.settle();
      const r = session.result("em.fdtd@WIN");
      assert.equal(r.status, status, JSON.stringify(r.reason || r.warnings));
      // the Airy minimum for n = 1.5 is 0.852
      assert.ok(Math.abs(r.outputs.minTransmittance.value - 0.8521) < 0.01, `min T ${r.outputs.minTransmittance.value}`);
    }
    assert.match(emKernelKey(em({})), /^em:fdtd:/);
  });

  it("times out honestly", async () => {
    const r = await runStack1d(slabRequest(80), { timeoutMs: 50 });
    assert.equal(r.ok, false);
    assert.match(r.error, /timed out/);
  });
});
