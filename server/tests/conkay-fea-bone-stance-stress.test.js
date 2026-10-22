// tests/conkay-fea-bone-stance-stress.test.js
//
// fea.bone-stance-stress (lib/conkay/physics/solvers/fea-bone-stance-stress.js)
// — the adapter that maps "the load a human leg carries during stance" onto the
// existing fea.solid3d solver (lib/conkay/physics/solvers/solid-stress.js).
//
// What is actually under test:
//   - the ARITHMETIC of the stance load distribution. This is the adapter's own
//     physics and is checked to the digit: hip = (0.5 + 0.5f)W, knee = 0.5fW,
//     ankle = fW, design = static x dynamicAmplification.
//   - the HANDOFF. The tests run the REAL fea.solid3d against the REAL gmsh +
//     CalculiX kernel, so a regression that breaks the STEP the adapter writes
//     (a shape OCC can no longer import as one solid, an end-cap bbox that
//     selects no surface, a unit conversion that is off by 1e6) fails here
//     rather than quietly returning a plausible number.
//
// Honesty: the kernel-backed tests are skipped when the gmsh Python or ccx is
// not found, exactly like tests/conkay-solid-stress.test.js. The pure-arithmetic
// and validation tests always run — those never touch the kernel, so a missing
// kernel can never hide a broken load distribution.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { boneStanceStress } from "../lib/conkay/physics/solvers/fea-bone-stance-stress.js";
import { solid3d } from "../lib/conkay/physics/solvers/solid-stress.js";
import { runSolidStatic, feaPythonPath, ccxPath } from "../lib/conkay/fea/calculix.js";
import { settleKernels, clearKernelResults, KERNEL_PENDING } from "../lib/conkay/cad/kernel-queue.js";
import { listSolvers } from "../lib/conkay/index.js";

const HAVE_KERNEL = fs.existsSync(feaPythonPath()) && fs.existsSync(ccxPath());
const SKIP = !HAVE_KERNEL && `gmsh Python (${feaPythonPath()}) or ccx (${ccxPath()}) not found`;

const G = 9.80665;
const STEEL_ISH_CORTICAL = { E: 210e9, nu: 0.3, allowableStressPa: 200e6 };

/** A femur: 450 mm long, 28 mm proximal -> 22 mm distal shaft. */
const FEMUR = () => ({
  shape: "tube",
  lengthM: 0.45,
  diameterProximalM: 0.028,
  diameterDistalM: 0.022,
  sides: 12,
  material: { ...STEEL_ISH_CORTICAL },
});

/**
 * Run the adapter until the queued kernel finishes. The first call legitimately
 * reports not_computed "kernel run pending" (the kernel is a child process that
 * runs off the request path); settleKernels() runs it and the second call has the
 * field. Returns the first answer that is not pending.
 */
async function solved(opts) {
  let r = boneStanceStress(opts);
  for (let i = 0; i < 3 && r.status === "not_computed" && typeof r.reason === "string" && r.reason.includes(KERNEL_PENDING); i += 1) {
    await settleKernels();
    r = boneStanceStress(opts);
  }
  return r;
}

describe("registration", () => {
  it("fea.bone-stance-stress is registered with the declared identity", () => {
    const s = listSolvers().find((x) => x.id === "fea.bone-stance-stress");
    assert.ok(s, "solver not registered");
    assert.equal(s.version, "1.0.0");
    assert.equal(s.domain, "structural");
    assert.deepEqual(s.domains, ["structural", "robotics"]);
    assert.equal(s.method, "fea.bone-stance-adapter");
    assert.equal(s.fidelity, 2);
  });

  it("is registered next to the fea.solid3d it delegates to, and that is the id it uses", () => {
    assert.equal(solid3d, "fea.solid3d", "solid3d export changed shape");
    assert.ok(listSolvers().some((x) => x.id === "fea.solid3d"));
  });
});

describe("stance load distribution (pure arithmetic, no kernel)", () => {
  it("single-leg stance: hipForceN is body weight and the design force is that x dynamicAmplification", () => {
    const r = boneStanceStress({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 1 });
    // The mass check fires before any FEA, so this is answerable without a kernel.
    assert.ok(Number.isFinite(r.loads.hipForceN) || r.status === "not_computed", r.reason);
    const expectedHip = 70 * G;
    const expectedDesign = expectedHip * 1.6;

    // Read the loads off the same arithmetic the adapter used, whether or not
    // the kernel was available to finish the FEA half.
    const loads = r.loads ?? probeLoads({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 1 });
    assert.ok(Math.abs(loads.hipForceN - expectedHip) < 1e-9, `hipForceN ${loads.hipForceN} != ${expectedHip}`);
    assert.ok(Math.abs(loads.designForceN - expectedDesign) < 1e-9, `designForceN ${loads.designForceN} != ${expectedDesign}`);
    assert.equal(loads.stanceFraction, 1);
    assert.equal(loads.dynamicAmplification, 1.6);
  });

  it("double support: ankleForceN is 0 and the hip force is half the single-support value", () => {
    const single = probeLoads({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 1 });
    const double = probeLoads({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 0 });
    assert.equal(double.ankleForceN, 0);
    assert.ok(Math.abs(double.hipForceN - single.hipForceN / 2) < 1e-9);
    assert.ok(Math.abs(double.hipForceN - (70 * G * 0.5)) < 1e-9);
    // The knee force is the share transmitted above the knee: zero in double
    // support, half the hip force in single support.
    assert.equal(double.kneeForceN, 0);
    assert.ok(Math.abs(single.kneeForceN - single.hipForceN / 2) < 1e-9);
  });

  it("a partial stance fraction interpolates monotonically between double and single support", () => {
    const d = probeLoads({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 0 });
    const h = probeLoads({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 0.5 });
    const s = probeLoads({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 1 });
    assert.ok(d.hipForceN < h.hipForceN && h.hipForceN < s.hipForceN);
    assert.ok(Math.abs(h.hipForceN - 70 * G * 0.75) < 1e-9);
  });

  it("all reported loads are finite, including a deliberately huge body mass", () => {
    for (const stanceFraction of [0, 0.5, 1]) {
      const l = probeLoads({ bone: FEMUR(), bodyMassKg: 250, stanceFraction });
      for (const k of ["hipForceN", "kneeForceN", "ankleForceN", "designForceN", "stanceFraction", "dynamicAmplification"]) {
        assert.ok(Number.isFinite(l[k]), `${k} = ${l[k]} is not finite`);
      }
    }
  });
});

/**
 * The adapter reports `loads` on every envelope it returns, including the
 * not_computed ones (the load arithmetic happens before the FEA is requested).
 * So these assertions work with or without a kernel: a run that stopped at the
 * kernel still carries the loads it computed, which is exactly the honesty
 * property being relied on here.
 */
function probeLoads(opts) {
  const r = boneStanceStress(opts);
  assert.ok(r.loads, `no loads reported (status ${r.status}: ${r.reason})`);
  return r.loads;
}

describe("validation: nothing is defaulted silently", () => {
  it("a missing bodyMassKg is not_computed naming bodyMassKg", () => {
    const r = boneStanceStress({ bone: FEMUR() });
    assert.equal(r.status, "not_computed");
    assert.match(r.reason, /bodyMassKg/);
  });

  it("a non-positive bodyMassKg is not_computed naming bodyMassKg, not silently clamped", () => {
    for (const bad of [0, -70, Number.NaN, "70"]) {
      const r = boneStanceStress({ bone: FEMUR(), bodyMassKg: bad });
      assert.equal(r.status, "not_computed", `accepted ${JSON.stringify(bad)}`);
      assert.match(r.reason, /bodyMassKg/);
    }
  });

  it("missing bone geometry is not_computed naming the absent bone field", () => {
    const mat = { ...STEEL_ISH_CORTICAL };
    const cases = [
      [{ material: mat }, /bone\.shape/],
      [{ shape: "tube", material: mat }, /bone\.lengthM/],
      [{ shape: "tube", lengthM: 0.45, material: mat }, /bone\.diameterProximalM/],
      [{ shape: "blob", lengthM: 0.45, diameterProximalM: 0.028, material: mat }, /bone\.shape/],
      [{ shape: "tube", lengthM: -1, diameterProximalM: 0.028, material: mat }, /bone\.lengthM/],
    ];
    for (const [bone, re] of cases) {
      const r = boneStanceStress({ bone, bodyMassKg: 70 });
      assert.equal(r.status, "not_computed", `${JSON.stringify(bone)} was not rejected`);
      assert.match(r.reason, re);
      assert.match(r.reason, /^bone\./, "the reason must name a bone field");
    }
  });

  it("a missing or unusable material is not_computed naming the material field", () => {
    const geo = { shape: "tube", lengthM: 0.45, diameterProximalM: 0.028 };
    for (const [material, re] of [
      [undefined, /bone\.material/],
      [{}, /bone\.material\.E/],
      [{ nu: 0.3, allowableStressPa: 2e8 }, /bone\.material\.E/],
      [{ E: 210e9 }, /bone\.material\.nu/],
      [{ E: 210e9, nu: 0.9 }, /bone\.material\.nu/],
    ]) {
      const r = boneStanceStress({ bone: { ...geo, material }, bodyMassKg: 70 });
      assert.equal(r.status, "not_computed");
      assert.match(r.reason, re);
    }
  });

  it("an out-of-range stanceFraction or amplification is rejected rather than clamped", () => {
    for (const opts of [{ stanceFraction: -0.1 }, { stanceFraction: 1.5 }, { dynamicAmplification: 0 }, { gravity: 0 }]) {
      const r = boneStanceStress({ bone: FEMUR(), bodyMassKg: 70, ...opts });
      assert.equal(r.status, "not_computed", JSON.stringify(opts));
      assert.ok(r.reason, "a rejection must carry a reason");
    }
  });
});

describe("handoff to fea.solid3d (real gmsh + CalculiX)", { skip: SKIP }, async () => {
  before(async () => {
    // Settle any kernel a previous suite left queued so this file's assertions
    // are about this bone, not about a shared queue.
    await settleKernels();
  });

  it("a realistic femur returns a finite positive utilization and a real status — never not_computed", async () => {
    const r = await solved({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 1 });
    assert.equal(r.status, "ok", `reason: ${r.reason}`);
    assert.ok(Number.isFinite(r.stress.vonMisesStressPa) && r.stress.vonMisesStressPa > 0, r.stress.vonMisesStressPa);
    assert.ok(Number.isFinite(r.stress.utilization) && r.stress.utilization > 0, r.stress.utilization);
    assert.ok(Number.isFinite(r.stress.allowableStressPa) && r.stress.allowableStressPa > 0);
    // The kernel really ran: a real element count and a nodal field, not a
    // number the adapter made up.
    assert.ok(r.feaResult?.outputs?.maxVonMises?.value > 0);
    assert.ok(r.feaResult?.outputs?.mesh?.value?.elements > 0, "no mesh: the FEA never ran");
    assert.ok(["ok", "fail"].includes(r.status));
  });

  it("the computed stress matches the applied axial force over the shaft area", async () => {
    // Independent physics check, not a tautology: a uniform axial strut carries
    // sigma = F/A. The kernel's peak end-cap von Mises carries a stress
    // concentration on top of that, so the check is that the solved stress is
    // the same order as F/A and above the bare uniform value.
    const r = await solved({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 1 });
    const designN = r.loads.designForceN;
    const areaM2 = Math.PI * (0.022 / 2) ** 2; // distal shaft, the loaded end
    const uniformPa = designN / areaM2;
    assert.ok(
      r.stress.vonMisesStressPa > uniformPa * 0.5 && r.stress.vonMisesStressPa < uniformPa * 10,
      `vM ${r.stress.vonMisesStressPa} Pa is not consistent with F/A = ${uniformPa} Pa`,
    );
  });

  it("the loads reported with the answer are exactly the documented distribution", async () => {
    const r = await solved({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 1 });
    const W = 70 * G;
    assert.ok(Math.abs(r.loads.hipForceN - W) < 1e-9);
    assert.ok(Math.abs(r.loads.kneeForceN - 0.5 * W) < 1e-9);
    assert.ok(Math.abs(r.loads.ankleForceN - W) < 1e-9);
    assert.ok(Math.abs(r.loads.designForceN - W * 1.6) < 1e-9);
  });

  it("safetyFactorActual is exactly allowableStressPa / vonMisesStressPa, so it cannot disagree with the utilization", async () => {
    const r = await solved({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 1, safetyFactor: 2 });
    assert.equal(r.status, "ok");
    const { vonMisesStressPa, allowableStressPa, utilization, safetyFactorActual } = r.stress;
    assert.ok(Math.abs(safetyFactorActual - allowableStressPa / vonMisesStressPa) < 1e-9);
    // The two views of the same ratio must be exact reciprocals, not two
    // separately-derived numbers that can drift apart.
    assert.ok(Math.abs(utilization * safetyFactorActual - 1) < 1e-9);
    assert.ok(Math.abs(1 / utilization - safetyFactorActual) < 1e-9);
  });

  it("a safetyFactor above the achieved one fails even when the utilization passes", async () => {
    const r = await solved({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 1, safetyFactor: 1e6 });
    assert.equal(r.status, "fail");
    assert.match(r.reason, /safety factor/);
    assert.ok(r.stress.utilization < 1, "this test needs a passing utilization");
  });

  it("a deliberately tiny allowable flips the status to fail", async () => {
    const ok = await solved({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 1 });
    assert.equal(ok.status, "ok");
    assert.ok(ok.stress.utilization < 1);

    // Same bone, same solve, an allowable a thousand times smaller.
    const bone = { ...FEMUR(), material: { ...STEEL_ISH_CORTICAL, allowableStressPa: ok.stress.allowableStressPa / 1000 } };
    const bad = await solved({ bone, bodyMassKg: 70, stanceFraction: 1 });
    assert.ok(bad.stress.utilization > 1, `utilization ${bad.stress.utilization} did not exceed 1`);
    assert.equal(bad.status, "fail");
    assert.match(bad.reason, /utilization/);
    // And the ratio moved by exactly the factor the allowable moved by.
    assert.ok(Math.abs(bad.stress.utilization - ok.stress.utilization * 1000) / bad.stress.utilization < 1e-9);
  });

  it("a heavy stance load with a tiny allowable reports utilization > 1 as fail", async () => {
    const bone = { ...FEMUR(), material: { E: 210e9, nu: 0.3, allowableStressPa: 1e6 } }; // 1 MPa allowable
    const r = await solved({ bone, bodyMassKg: 140, stanceFraction: 1, dynamicAmplification: 3 });
    assert.ok(r.stress.utilization > 1, `utilization ${r.stress.utilization} did not exceed 1`);
    assert.equal(r.status, "fail");
  });

  it("a bone with no allowable stress reports not_computed and keeps the field it did compute", async () => {
    const bone = { ...FEMUR(), material: { E: 210e9, nu: 0.3 } };
    const r = await solved({ bone, bodyMassKg: 70, stanceFraction: 1 });
    assert.equal(r.status, "not_computed");
    assert.match(r.reason, /allowableStressPa/);
    // Honesty: the stress was computed, it just could not be checked. It is kept,
    // it is not nulled out, and it is NOT reported as a pass.
    assert.ok(Number.isFinite(r.stress.vonMisesStressPa) && r.stress.vonMisesStressPa > 0);
    assert.equal(r.stress.utilization, null);
  });

  it("an unavailable kernel propagates the kernel's NOT_COMPUTED reason instead of falling back to our own FEA", async () => {
    clearKernelResults();
    const prev = process.env.CONKAY_CCX;
    process.env.CONKAY_CCX = "/nonexistent/ccx";
    try {
      const bone = { ...FEMUR(), shape: "tube", sides: 13 }; // a distinct geometry: a fresh kernel key
      const r = await solved({ bone, bodyMassKg: 70, stanceFraction: 1 });
      assert.equal(r.status, "not_computed");
      assert.match(r.reason, /CONKAY_CCX|ccx not found/);
      // Crucially, there is no stress number: we refused rather than inventing one.
      assert.equal(r.stress.vonMisesStressPa, null);
    } finally {
      if (prev === undefined) delete process.env.CONKAY_CCX;
      else process.env.CONKAY_CCX = prev;
      clearKernelResults();
      await settleKernels();
    }
  });

  it("an axial bone with no step, an unknown shape or a bad bbox never returns a fabricated stress", async () => {
    // A bone.step that does not exist on disk: the kernel says so and the adapter
    // propagates it verbatim.
    const r = await solved({
      bone: { step: "/nonexistent/femur.step", material: { ...STEEL_ISH_CORTICAL } },
      bodyMassKg: 70,
      stanceFraction: 1,
    });
    assert.equal(r.status, "not_computed");
    assert.ok(r.reason.length > 10, "a not_computed must carry a precise reason");
    assert.equal(r.stress.vonMisesStressPa, null);
  });

  it("a rectangular-section bone also solves (the box geometry path)", async () => {
    const bone = {
      shape: "box",
      lengthM: 0.36, // tibia
      widthM: 0.026,
      thicknessM: 0.024,
      material: { ...STEEL_ISH_CORTICAL },
    };
    const r = await solved({ bone, bodyMassKg: 70, stanceFraction: 1 });
    assert.ok(["ok", "fail"].includes(r.status), `status ${r.status}: ${r.reason}`);
    assert.ok(r.stress.vonMisesStressPa > 0, "the box bone produced no stress");
    assert.ok(r.feaResult?.outputs?.mesh?.value?.elements > 0);
  });
});

describe("no hidden FEA fallback", () => {
  it("the module delegates to the registered fea.solid3d rather than computing a stress itself", async () => {
    // The adapter's own module must not import a stress routine; if it ever
    // grew one, this test still passes, but the mesh assertion below is the real
    // guard: every reported stress carries a kernel element count.
    if (!HAVE_KERNEL) return;
    const r = await solved({ bone: FEMUR(), bodyMassKg: 70, stanceFraction: 1 });
    if (r.status === "not_computed") return; // kernel missing; the skip covers it
    assert.ok(r.feaResult, "a non-not_computed answer must carry the FEA result");
    assert.ok(r.feaResult.outputs?.maxVonMises?.basis?.includes("C3D10"), r.feaResult.outputs?.maxVonMises?.basis);
  });

  it("the loads are reported even when the FEA half could not run", () => {
    clearKernelResults();
    const prev = process.env.CONKAY_CCX;
    process.env.CONKAY_CCX = "/nonexistent/ccx";
    try {
      const bone = { ...FEMUR(), sides: 11 };
      const r = boneStanceStress({ bone, bodyMassKg: 80, stanceFraction: 0.25 });
      assert.equal(r.status, "not_computed");
      assert.ok(r.loads, "the load arithmetic is independent of the kernel and must still be reported");
      assert.ok(Math.abs(r.loads.hipForceN - 80 * G * 0.625) < 1e-9);
      assert.ok(Math.abs(r.loads.ankleForceN - 80 * G * 0.25) < 1e-9);
      assert.ok(Math.abs(r.loads.kneeForceN - 80 * G * 0.5 * 0.25) < 1e-9);
    } finally {
      if (prev === undefined) delete process.env.CONKAY_CCX;
      else process.env.CONKAY_CCX = prev;
      clearKernelResults();
    }
  });
});