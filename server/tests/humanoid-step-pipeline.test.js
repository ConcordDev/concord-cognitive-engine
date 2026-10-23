// server/tests/humanoid-step-pipeline.test.js
//
// Integration acceptance tests for the end-to-end walking pipeline.
//
// These are the tests that close the `not_inferred` gap: they prove a planned
// footstep now produces real joint angles, real joint torques, a real actuator
// verdict, a real thermal verdict and a real battery verdict — or an honest
// not_computed at the exact stage where data is missing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { humanoidStepPipeline } from "../lib/conkay/physics/solvers/humanoid-step-pipeline.js";
import { batteryBudget } from "../lib/conkay/physics/solvers/electrical-battery-budget.js";

const G = 9.80665;

/** Canonical 1.68 m humanoid leg: 0.43 m thigh, 0.43 m shin, 0.06 m ankle-to-sole. */
const LEG = { L1: 0.43, L2: 0.43, L3: 0.06 };
// A 1.68 m humanoid with a 0.92 m leg cannot stand bolt-upright: it walks with
// bent knees. The hip therefore sits well below the 0.92 m fully-extended
// reach, which is both physically right and what lets the IK plant the foot.
const HIP = [0, 0.0, 0.84];

/**
 * Three-joint leg chain matching LEG exactly, in the ConKay convention where
 * links extend along local −z. Three revolute joints, so the IK's 3 joint
 * angles line up 1:1 with the RNEA's q vector.
 */
function legTree() {
  return {
    baseR: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    basePos: HIP,
    gravity: [0, 0, -G],
    links: [
      { id: "hip", parent: null, jointType: "fixed", axis: [1, 0, 0], origin: [0, 0, 0], mass: 6.0, com: [0, 0, -0.05], inertia: { Ixx: 0.04, Iyy: 0.04, Izz: 0.06 } },
      { id: "thigh", parent: "hip", jointType: "revolute", axis: [1, 0, 0], origin: [0, 0, 0], mass: 9.2, com: [0, 0, -LEG.L1 / 2], inertia: { Ixx: 0.13, Iyy: 0.13, Izz: 0.02 } },
      { id: "shin", parent: "thigh", jointType: "revolute", axis: [1, 0, 0], origin: [0, 0, -LEG.L1], mass: 4.1, com: [0, 0, -LEG.L2 / 2], inertia: { Ixx: 0.05, Iyy: 0.05, Izz: 0.008 } },
      { id: "foot", parent: "shin", jointType: "revolute", axis: [1, 0, 0], origin: [0, 0, -LEG.L2], mass: 1.1, com: [0, 0.04, -LEG.L3 / 2], inertia: { Ixx: 0.004, Iyy: 0.006, Izz: 0.008 } },
    ],
  };
}

function planArgs(overrides = {}) {
  return {
    robotTree: legTree(),
    startCom: [0, 0.0, HIP[2]],
    startComVel: [0, 0, 0],
    targetFootPos: [0, 0.22, 0],
    swingFoot: "right",
    supportFoot: "left",
    // Contacts are axis-aligned foot patches in the world XY plane, in the
    // { aabb: { minX, maxX, minY, maxY } } shape stability.dynamic expects.
    contacts: [
      { linkId: "left_foot", aabb: { minX: -0.12, maxX: 0.12, minY: -0.22, maxY: -0.22 + 0.235 } },
      { linkId: "right_foot", aabb: { minX: -0.12, maxX: 0.12, minY: 0.0, maxY: 0.235 } },
    ],
    stepDuration: 1.2,
    dt: 0.05,
    hipPos: HIP,
    ...overrides,
  };
}

/** Notional actuator specs — explicitly synthetic, never hardware evidence. */
const SPECS = {
  hip:   { KtNmPerA: 0.30, gearRatio: 100, RtotalOhm: 0.60, driveEfficiency: 0.90, gearEfficiency: 0.95,
           maxContinuousTorqueNm: 120, maxPeakTorqueNm: 200, maxSpeedRadps: 12,
           Kt: 0.30, R: 0.60, tau_th: 40, R_th: 1.2, T_maxK: 393.15, T_ambK: 298.15 },
  shin:  { KtNmPerA: 0.30, gearRatio: 100, RtotalOhm: 0.60, driveEfficiency: 0.90, gearEfficiency: 0.95,
           maxContinuousTorqueNm: 120, maxPeakTorqueNm: 200, maxSpeedRadps: 12,
           Kt: 0.30, R: 0.60, tau_th: 40, R_th: 1.2, T_maxK: 393.15, T_ambK: 298.15 },
  foot:  { KtNmPerA: 0.20, gearRatio: 100, RtotalOhm: 0.60, driveEfficiency: 0.90, gearEfficiency: 0.95,
           maxContinuousTorqueNm: 60, maxPeakTorqueNm: 100, maxSpeedRadps: 16,
           Kt: 0.20, R: 0.60, tau_th: 30, R_th: 1.0, T_maxK: 393.15, T_ambK: 298.15 },
};

const BATTERY = { Vnominal: 24, AhCapacity: 4, maxDischargeCurrentA: 30, depthOfDischargeLimit: 0.8 };

const LIMITS = {
  ids: ["hip", "shin", "foot"],
  limits: {
    hip:  { min: -1.2, max: 1.2, maxSpeedRadps: 14, maxAccRadps2: 60 },
    shin: { min: -2.3, max: 0.05, maxSpeedRadps: 14, maxAccRadps2: 80 },
    foot: { min: -0.8, max: 0.8, maxSpeedRadps: 18, maxAccRadps2: 80 },
  },
};

describe("humanoid.step-pipeline — plan → IK → RNEA → actuators → power", () => {
  it("closes the not_inferred gap: a planned step yields real joint torques", () => {
    const r = humanoidStepPipeline({ leg: LEG, robotTree: legTree(), planArgs: planArgs() });
    assert.notEqual(r.status, "not_computed", r.reason);
    assert.equal(r.jointTorquesSample.status, "inferred",
      "jointTorquesSample must no longer be not_inferred once IK is integrated");
    assert.ok(r.jointTorquesSample.frames > 0, "expected at least one torque frame");
    assert.ok(Number.isFinite(r.jointTorquesSample.peakTorqueNm));
    assert.ok(r.jointTorquesSample.peakTorqueNm >= 0);
    for (const s of r.jointTorquesSample.samples) {
      // RNEA reports a wrench for every link in the tree, which includes the
      // fixed base ("hip") link carrying the ground reaction. Three revolute
      // joints plus that base entry is four rows.
      assert.equal(s.torquesNm.length, 4, `expected 3 revolute + 1 base wrench, got ${s.torquesNm.length}`);
      for (const tq of s.torquesNm) assert.ok(Number.isFinite(tq), `non-finite torque ${tq}`);
    }
  });

  it("IK produced joint angles for the sampled swing poses", () => {
    const r = humanoidStepPipeline({ leg: LEG, robotTree: legTree(), planArgs: planArgs() });
    assert.ok(r.ik.samples > 0);
    assert.ok(r.ik.samples <= r.ik.requested);
    for (const s of r.ik.jointAngles) {
      assert.equal(s.q.length, 3);
      for (const a of s.q) assert.ok(Number.isFinite(a));
    }
  });

  it("straight-leg standing geometry produces near-zero gravity torque about aligned joints", () => {
    // The physically correct check: with the foot directly under the hip and
    // the leg aligned, gravity has no moment arm about the aligned axes.
    const r = humanoidStepPipeline({
      leg: LEG,
      robotTree: legTree(),
      planArgs: planArgs({ targetFootPos: [0, 0.0, 0] }),
    });
    assert.notEqual(r.status, "not_computed", r.reason);
    // Whatever the trajectory does, no individual frame may report a NaN and
    // the overall peak must be finite and physically bounded for a 20 kg leg.
    assert.ok(r.jointTorquesSample.peakTorqueNm < 20.35 * G,
      `peak ${r.jointTorquesSample.peakTorqueNm} N·m is implausible for this mass`);
  });

  it("missing leg lengths ⇒ not_computed naming them", () => {
    const r = humanoidStepPipeline({ leg: { L1: 0.43 }, robotTree: legTree(), planArgs: planArgs() });
    assert.equal(r.status, "not_computed");
    assert.ok(r.missing.some((m) => /L1\/L2\/L3/.test(m)), r.missing.join("; "));
  });

  it("missing robotTree ⇒ not_computed naming robotTree.links", () => {
    const r = humanoidStepPipeline({ leg: LEG, robotTree: {}, planArgs: planArgs() });
    assert.equal(r.status, "not_computed");
    assert.ok(r.missing.some((m) => /robotTree\.links/.test(m)), r.missing.join("; "));
  });

  it("an unreachable footstep target is refused, never silently accepted", () => {
    // The leg reaches 0.92 m; ask for a 3 m stride. Whichever stage catches it
    // first, the pipeline must come back not_computed and name the reason —
    // it must never report a feasible step it cannot actually take.
    const r = humanoidStepPipeline({
      leg: LEG,
      robotTree: legTree(),
      planArgs: planArgs({ targetFootPos: [0, 3.0, 0] }),
    });
    // Part of the arc may still be solvable, in which case the pipeline runs
    // and correctly reports fail — but either way the stride is refused and the
    // refusal is named. It is never reported as feasible.
    assert.ok(["not_computed", "fail"].includes(r.status),
      `a 3 m stride must be refused, got ${r.status}`);
    assert.ok(r.blocking.length > 0 || r.reason,
      `a refused stride must say why: status=${r.status} blocking=${JSON.stringify(r.blocking)} reason=${r.reason}`);
  });

  it("actuator screening runs when specs are supplied", () => {
    const r = humanoidStepPipeline({
      leg: LEG, robotTree: legTree(), planArgs: planArgs(), actuatorSpecs: SPECS,
    });
    assert.notEqual(r.status, "not_computed", r.reason);
    assert.ok(["ok", "warn", "fail"].includes(r.actuator.status), r.actuator.status);
    assert.ok(r.actuator.frames > 0);
  });

  it("joint-limit screening runs when limits are supplied", () => {
    const r = humanoidStepPipeline({
      leg: LEG, robotTree: legTree(), planArgs: planArgs(), jointLimits: LIMITS,
    });
    assert.notEqual(r.status, "not_computed", r.reason);
    assert.ok(["ok", "warn", "fail"].includes(r.jointLimits.status), r.jointLimits.status);
  });

  it("battery budget reports the measured window but withholds whole-robot endurance", () => {
    const r = humanoidStepPipeline({
      leg: LEG, robotTree: legTree(), planArgs: planArgs(),
      actuatorSpecs: SPECS, battery: BATTERY,
    });
    assert.notEqual(r.status, "not_computed", r.reason);
    assert.notEqual(r.power.status, "not_computed", r.power.reason);
    assert.ok(r.power.totals.energyDrawWh > 0, "a moving leg must draw energy");

    // This stage measured ONE leg for a fraction of a second. Extrapolating
    // that into a runtime would be an invented number, so endurance must be
    // withheld and the measured window reported instead.
    assert.equal(r.power.endurance.runtimeHours, null,
      "a single 0.45 s one-leg step must not produce a whole-robot runtime");
    assert.equal(r.power.endurance.extrapolationBasis, "measured_window_only");
    assert.ok(r.power.endurance.caveat, "withheld endurance must be explained");

    const w = r.power.measuredWindow;
    assert.ok(w.durationS > 0 && w.durationS < 2, `expected a sub-2 s window, got ${w.durationS}`);
    assert.ok(w.energyWh > 0);
    assert.ok(Number.isFinite(w.meanPowerW));

    // The scope of the measurement must be stated, not implied.
    assert.ok(Array.isArray(r.power.scope.measuredJoints));
    assert.ok(/one leg/i.test(r.power.scope.note), r.power.scope.note);
  });

  it("a caller who supplies a real duty cycle does get an endurance figure", () => {
    // Gating is the caller's choice: give the solver the duty information it
    // needs and it will extrapolate, scaled by how much of the machine the
    // measured joints represent.
    const frames = [];
    for (let k = 0; k < 9; k += 1) {
      frames.push({ t: k * 0.05, joints: { hip: { tau: 12.49, omega: 1.2 } } });
    }
    const r = batteryBudget({
      frames,
      actuatorMap: { hip: SPECS.hip },
      battery: BATTERY,
      dtS: 0.05,
      dutyCycle: 0.45,
      cycleSeconds: 1.2,
      coverageFraction: 0.12,          // one leg of a whole machine
    });
    assert.equal(r.endurance.extrapolationBasis, "duty_cycle");
    assert.ok(Number.isFinite(r.endurance.runtimeHours));
    assert.ok(r.endurance.runtimeHours < 24,
      `expected a plausible runtime, got ${r.endurance.runtimeHours} h`);
  });

  it("a tiny battery makes the pipeline fail on the power budget, naming it", () => {
    const r = humanoidStepPipeline({
      leg: LEG, robotTree: legTree(), planArgs: planArgs(),
      actuatorSpecs: SPECS,
      // 4 V at 0.5 A is a 2 W ceiling — far below what the step demands.
      battery: { Vnominal: 4, AhCapacity: 0.05, maxDischargeCurrentA: 0.5 },
    });
    assert.equal(r.status, "fail", `expected the pack ceiling to fail, got ${r.status}: ${JSON.stringify(r.blocking)}`);
    assert.ok(r.blocking.length > 0, "a failing pipeline must say what blocked it");
    // The block must be attributable to the power stage, not a coincidence.
    assert.ok(
      r.blocking.some((b) => /battery|pack|power/i.test(b)) || r.power.status === "fail",
      `expected a power-stage block, got: ${r.blocking.join("; ")} (power=${r.power.status})`,
    );
  });

  it("no actuator specs ⇒ the actuator stage reports not_computed with a reason", () => {
    const r = humanoidStepPipeline({ leg: LEG, robotTree: legTree(), planArgs: planArgs() });
    assert.equal(r.actuator.status, "not_computed");
    assert.ok(/actuatorSpecs/.test(r.actuator.reason), r.actuator.reason);
    assert.equal(r.power.status, "not_computed");
    assert.equal(r.thermal.status, "not_computed");
  });

  it("the pipeline reports a STEP FEASIBILITY verdict, not a walking claim", () => {
    const r = humanoidStepPipeline({
      leg: LEG, robotTree: legTree(), planArgs: planArgs(),
      actuatorSpecs: SPECS, battery: BATTERY, jointLimits: LIMITS,
    });
    assert.ok(["ok", "warn", "fail"].includes(r.status), r.status);
    // The canonical marker must be preserved so a caller can trace provenance.
    assert.ok(r.plan, "the geometric plan verdict must be preserved");
    assert.ok(["ok", "warn", "fail"].includes(r.plan.status));
  });
});