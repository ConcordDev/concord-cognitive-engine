// tests/conkay-reacting-chemistry.test.js
//
// chem.equilibrium / chem.ignition / chem.flameSpeed (lib/conkay/physics/
// solvers/reacting-chemistry.js) on the Cantera kernel (lib/conkay/chem/
// cantera_kernel.py, run through lib/conkay/chem/cantera.js).
//
// Reference cases:
//   [T]  Turns, An Introduction to Combustion, 3rd ed. (McGraw-Hill, 2012):
//        stoichiometric CH4/air adiabatic flame temperature ~2226 K and
//        H2/air ~2380-2400 K (unreacted 298-300 K, 1 atm). The same states are
//        computed by the Cantera "adiabatic flame temperature" example.
//   [KF] Kwon & Faeth, Combust. Flame 124 (2001) 230: measured H2/air laminar
//        flame speeds ~2.1-2.3 m/s at 298 K, 1 atm.
//   [B]  Burke, Chen, Ju, Dryer, Combust. Flame 159 (2012) 3282: H2 mechanism
//        comparisons land in the same 2.1-2.3 m/s band (h2o2.yaml here).
//   Ignition: no single-value citation is claimed — validated only
//   qualitatively (the delay must decrease monotonically with T0).
//
// The flame solve runs exactly once in this file (inside validateChemistry());
// the design-graph flame test replays that same kernel result through
// rememberKernel, so no second flame solve happens.
//
// Kernel tests are skipped when the Cantera Python is not found
// (CONKAY_CANTERA_PYTHON / CONKAY_OCC_PYTHON / ~/.zuko/venvs/cad-occ).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runEquilibrium, runChemistryKernel, canteraPythonPath, chemKernelKey, CANTERA_UNAVAILABLE } from "../lib/conkay/chem/cantera.js";
import { clearKernelResults, rememberKernel } from "../lib/conkay/cad/kernel-queue.js";
import { CHEM_REFERENCE_CASES, CHEM_IGNITION_CASE, validateChemistry } from "../lib/conkay/physics/solvers/reacting-chemistry.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";

const HAVE_KERNEL = fs.existsSync(canteraPythonPath());
const SKIP = !HAVE_KERNEL && `no Python with Cantera (CONKAY_CANTERA_PYTHON / CONKAY_OCC_PYTHON / ~/.zuko/venvs/cad-occ): ${CANTERA_UNAVAILABLE}`;
const PLAIN_PYTHON = "/usr/bin/python3";

// One shared validation run (five real kernel executions) for this file.
let shared = null;
const validation = () => (shared ??= validateChemistry());

const chemIr = (props) => ({ nodes: [{ id: "CMB", kind: "Volume", props: { chemistry: props } }] });
const caseById = (v, id) => v.cases.find((c) => c.id === id);

describe("registration", () => {
  it("chem.equilibrium, chem.ignition and chem.flameSpeed are registered with their declarations", () => {
    const byId = Object.fromEntries(listSolvers().map((s) => [s.id, s]));
    for (const id of ["chem.equilibrium", "chem.ignition", "chem.flameSpeed"]) {
      const s = byId[id];
      assert.ok(s, id);
      assert.equal(s.fidelity, 3, `${id}: Cantera is a full numerical solve`);
      assert.match(s.method, /Cantera/, id);
      for (const k of ["reference", "regime", "units", "tolerance"]) assert.ok(s[k], `${id}: ${k}`);
      assert.equal(s.screening, true, `${id}: screening-level, not a design check`);
    }
    assert.match(byId["chem.equilibrium"].regime, /ideal.gas/i);
    assert.match(byId["chem.flameSpeed"].tolerance, /coarse/);
  });
});

describe("reference cases [T][KF][B] (real Cantera runs)", { skip: SKIP }, async () => {
  const v = await validation();

  it("CH4/air phi=1, 300 K, 1 atm: T_ad = 2226 +/- 25 K [T] (the Cantera example state)", () => {
    const c = caseById(v, "CH4-air-stoichiometric-Tad");
    assert.equal(c.pass, true, JSON.stringify({ computed: c.computed, reference: c.reference, reason: c.reason }));
    assert.ok(Math.abs(c.computed - c.reference) <= c.tolerance);
    assert.match(c.source, /Turns/);
    const eq = c.result.products;
    assert.equal(eq[0].species, "N2", "air's nitrogen dominates the products");
    assert.ok(eq.some((p) => p.species === "CO2" && p.X > 0.05), "CO2 is a major product");
  });

  it("H2/air phi=1, 298 K, 1 atm: T_ad = 2380 +/- 40 K [T]", () => {
    const c = caseById(v, "H2-air-stoichiometric-Tad");
    assert.equal(c.pass, true, JSON.stringify({ computed: c.computed, reference: c.reference, reason: c.reason }));
  });

  it("H2/air phi=1, 298 K, 1 atm: S_L vs the measured 2.1-2.3 m/s band on h2o2.yaml [KF][B] — the single flame run of this file", () => {
    const c = caseById(v, "H2-air-stoichiometric-SL");
    // regression on the mechanism's own answer (~2.31 m/s, grid-converged), and pass/fail strictly from the band
    assert.ok(c.computed > 2.28 && c.computed < 2.34, `${c.computed} m/s`);
    assert.equal(c.pass, Math.abs(c.computed - 2.2) <= 0.1, "pass comes from the number, never forced");
    assert.ok(c.result.gridPoints > 10);
    assert.ok(c.result.warnings.some((w) => /coarse/.test(w)), "the coarse-grid caveat is carried, not hidden");
    assert.match(c.source, /Kwon & Faeth/);
  });

  it("H2/air ignition delay decreases monotonically with T0 (qualitative — reported, not number-validated)", () => {
    assert.equal(v.ignition.pass, true, JSON.stringify(v.ignition.results));
    const [a, b] = v.ignition.results;
    assert.ok(b.ignitionDelay < a.ignitionDelay, `${a.ignitionDelay} s at ${a.T0} K vs ${b.ignitionDelay} s at ${b.T0} K`);
    assert.ok(a.ignitionDelayT400 > 0 && b.ignitionDelayT400 > 0, "the T+400 K criterion is reported beside it");
    assert.match(v.ignition.source, /qualitatively/);
  });

  it("every kernel result carries the cantera version, mechanism, an inputs echo and warnings; each case reports its numbers", () => {
    assert.ok(v.cantera, "the cantera version rides every result");
    for (const c of v.cases) {
      for (const k of ["computed", "reference", "tolerance", "pass", "source"]) assert.ok(k in c, `${c.id}: ${k}`);
      assert.equal(c.result.mechanism, c.request.mechanism);
      assert.equal(c.result.inputs.phi, c.request.phi);
      assert.ok(Array.isArray(c.result.warnings));
    }
  });
});

describe("chem solvers through the design graph", { skip: SKIP }, () => {
  it("equilibrium: NOT_COMPUTED pending -> settle() -> PASS with the kernel receipt", async () => {
    clearKernelResults(); // the pending -> settle() flow below runs for real
    const { session } = openDesign(chemIr({ op: "equilibrium", mechanism: "gri30.yaml", fuel: "CH4", phi: 1, T0: 300, P0: 101325, source: "reference case" }));
    const pending = session.result("chem.equilibrium@CMB");
    assert.equal(pending.status, "NOT_COMPUTED");
    assert.match(pending.reason, /kernel run pending/);
    const settled = await session.settle();
    assert.ok(settled.kernels >= 1, "the kernel ran");
    const r = session.result("chem.equilibrium@CMB");
    assert.equal(r.status, "PASS");
    assert.ok(Math.abs(r.outputs.adiabaticFlameTemperature.value - 2226) <= 25, `${r.outputs.adiabaticFlameTemperature.value} K`);
    assert.equal(r.outputs.majorProducts.value[0].species, "N2");
    assert.equal(r.inputs.initialPressure.unit, "Pa");
    assert.equal(r.inputs.mechanism.value, "gri30.yaml");
    assert.ok(r.engineReceipt.cantera, "the kernel receipt rides along");
    assert.ok(r.assumptions.some((a) => /no kinetic/.test(a)));
  });

  it("flameSpeed: the single flame run -> WARN (the coarse-grid caveat), never a silent PASS", async () => {
    const v = await validation();
    const flameCase = caseById(v, "H2-air-stoichiometric-SL");
    // replay the validation's own kernel result: no second flame solve
    rememberKernel(chemKernelKey("flameSpeed", CHEM_REFERENCE_CASES[2].request), flameCase.result);
    const { session } = openDesign(chemIr({ op: "flameSpeed", mechanism: "h2o2.yaml", fuel: "H2", phi: 1, T0: 298, P0: 101325 }));
    const r = session.result("chem.flameSpeed@CMB");
    assert.equal(r.status, "WARN");
    assert.equal(r.outputs.laminarFlameSpeed.value, flameCase.computed, "the same kernel result, replayed from the queue");
    assert.ok(r.warnings.some((w) => /coarse/.test(w)));
  });

  it("ignition: PASS with both delay criteria", async () => {
    const v = await validation();
    const ign1000 = v.ignition.results.find((x) => x.T0 === 1000);
    rememberKernel(chemKernelKey("ignition", { ...CHEM_IGNITION_CASE.request, T0: 1000 }), ign1000.result);
    const { session } = openDesign(chemIr({ op: "ignition", mechanism: "h2o2.yaml", fuel: "H2", phi: 1, T0: 1000, P0: 101325 }));
    const r = session.result("chem.ignition@CMB");
    assert.equal(r.status, "PASS");
    assert.equal(r.outputs.ignitionDelay.value, ign1000.ignitionDelay);
    assert.ok(r.outputs.ignitionDelayT400.value > 0);
    assert.ok(r.outputs.finalTemperature.value > 2000);
  });

  it("a chemistry node with a missing input is NOT_COMPUTED with the precise reason", () => {
    const { session } = openDesign(chemIr({ op: "equilibrium", mechanism: "gri30.yaml", fuel: "CH4", phi: 1, T0: 300 })); // no P0
    const r = session.result("chem.equilibrium@CMB");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.match(r.reason, /P0/);
  });

  it("a mechanism outside the two validated ones is refused, not guessed", () => {
    const { session } = openDesign(chemIr({ op: "equilibrium", mechanism: "somewhere-else.yaml", fuel: "CH4", phi: 1, T0: 300, P0: 101325 }));
    const r = session.result("chem.equilibrium@CMB");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.match(r.reason, /gri30\.yaml, h2o2\.yaml/);
  });
});

describe("honesty: python missing, timeout, refused inputs", () => {
  it("a python that does not exist -> { ok:false, unavailable }, the honest NOT_COMPUTED reason", async () => {
    process.env.CONKAY_CANTERA_PYTHON = "/nonexistent/python";
    try {
      const r = await runEquilibrium({ mechanism: "gri30.yaml", fuel: "CH4", phi: 1, T0: 300, P0: 101325 });
      assert.equal(r.ok, false);
      assert.match(r.unavailable, /no Python with Cantera/);
      const v = await validateChemistry();
      assert.ok(v.cases.every((c) => c.pass === false && /no Python with Cantera/.test(c.reason)), "every reference case reports the reason");
      assert.equal(v.ignition.pass, false);
    } finally {
      delete process.env.CONKAY_CANTERA_PYTHON;
    }
  });

  it("through the design graph: settle() -> NOT_COMPUTED with the unavailable reason", async () => {
    process.env.CONKAY_CANTERA_PYTHON = "/nonexistent/python";
    try {
      clearKernelResults();
      const { session } = openDesign(chemIr({ op: "ignition", mechanism: "h2o2.yaml", fuel: "H2", phi: 0.9, T0: 1100, P0: 101325 }));
      await session.settle();
      const r = session.result("chem.ignition@CMB");
      assert.equal(r.status, "NOT_COMPUTED");
      assert.match(r.reason, /no Python with Cantera/);
    } finally {
      delete process.env.CONKAY_CANTERA_PYTHON;
    }
  });

  it("times out honestly when the kernel exceeds its deadline", { skip: SKIP }, async () => {
    const r = await runChemistryKernel("equilibrium", { mechanism: "gri30.yaml", fuel: "CH4", phi: 1, T0: 300, P0: 101325 }, { timeoutMs: 50 });
    assert.equal(r.ok, false);
    assert.match(r.error, /timed out after 50 ms/);
  });

  it("a fuel species not in the mechanism is an error, not a guess (CH4 in h2o2.yaml)", { skip: SKIP }, async () => {
    const r = await runEquilibrium({ mechanism: "h2o2.yaml", fuel: "CH4", phi: 1, T0: 300, P0: 101325 });
    assert.equal(r.ok, false);
    assert.match(r.error, /CH4/);
  });

  it("a python without cantera reports the import failure as one JSON error, never a traceback", async (t) => {
    if (!fs.existsSync(PLAIN_PYTHON)) return t.skip(`no plain ${PLAIN_PYTHON} on this machine`);
    const r = await runChemistryKernel("equilibrium", { mechanism: "gri30.yaml", fuel: "CH4", phi: 1, T0: 300, P0: 101325 }, { python: PLAIN_PYTHON });
    if (r.ok) return t.skip(`${PLAIN_PYTHON} unexpectedly has cantera`);
    assert.equal(r.ok, false);
    assert.match(r.error, /cantera import failed/);
  });
});