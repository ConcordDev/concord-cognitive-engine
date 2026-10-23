// server/tests/conkay-actuation-thermal-budget.test.js
//
// Closed-form acceptance tests for actuation.thermal-budget.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { thermalBudgetSingle, thermalBudgetTrajectory } from "../lib/conkay/physics/solvers/actuation-thermal-budget.js";

describe("actuation.thermal-budget — motor thermal model", () => {
  it("single: torque 5 Nm at Kt=0.1 N·m/A ⇒ I = 50 A, P = I²R = 250 W ⇒ T_ss = 548.15 K ⇒ over 393 K ⇒ fail", () => {
    const a = { Kt: 0.1, R: 0.1, tau_th: 60, R_th: 1.0, T_maxK: 393.15, T_ambK: 298.15 };
    const r = thermalBudgetSingle({ torque: 5, actuator: a });
    assert.equal(r.status, "fail");
    assert.equal(r.I, 50);
    assert.equal(r.P_W, 250);
    assert.equal(r.T_ssK, 298.15 + 250 * 1);
  });

  it("single: torque 1 Nm ⇒ I=10 A, P=10 W, T_ss=308 K. Below T_max ⇒ ok", () => {
    const a = { Kt: 0.1, R: 0.1, tau_th: 60, R_th: 1.0, T_maxK: 393.15, T_ambK: 298.15 };
    const r = thermalBudgetSingle({ torque: 1, actuator: a });
    assert.equal(r.status, "ok");
    assert.equal(r.I, 10);
    assert.equal(r.P_W, 10);
  });

  it("trajectory: 100 s at low torque ⇒ temperature stabilizes well below T_max", () => {
    const a = { Kt: 0.1, R: 0.1, tau_th: 60, R_th: 1.0, T_maxK: 393.15, T_ambK: 298.15 };
    const frames = [];
    for (let i = 0; i < 100; i += 1) {
      frames.push({ t: i, joints: { m1: { tau: 1, omega: 0 } } });
    }
    const r = thermalBudgetTrajectory({ frames, actuatorMap: { m1: a } });
    assert.equal(r.status, "ok");
    assert.ok(r.perJoint[0].T_maxK < 320, `T_max should be < 320 K, got ${r.perJoint[0].T_maxK}`);
  });

  it("trajectory: 100 s at high torque ⇒ eventually trips T_max", () => {
    const a = { Kt: 0.05, R: 0.05, tau_th: 30, R_th: 0.5, T_maxK: 350, T_ambK: 298.15 };   // I=80 A, P=320 W, dT=160 K → T_ss=458 K → fails
    const frames = [];
    for (let i = 0; i < 200; i += 1) {
      frames.push({ t: i, joints: { m1: { tau: 4, omega: 0 } } });
    }
    const r = thermalBudgetTrajectory({ frames, actuatorMap: { m1: a } });
    assert.equal(r.status, "fail");
    assert.ok(r.aggregate.overTemp.includes("m1"));
  });

  it("not_computed: missing frames or actuatorMap", () => {
    const r = thermalBudgetTrajectory({ frames: [], actuatorMap: {} });
    assert.equal(r.status, "not_computed");
  });
});