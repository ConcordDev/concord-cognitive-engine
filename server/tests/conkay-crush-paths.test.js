// server/tests/conkay-crush-paths.test.js
//
// Roadmap 5 item 2. The square-tube reduction is checked against the printed
// 9.56 coefficient. The car's rails are rectangular, so that reduction is
// not the force used. No crash box is added.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { meanCrushForce, reconstructedCoefficient, FOLDING, kineticEnergyJ, crushPaths } from "../lib/conkay/structural/crush-paths.js";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { openDesign } from "../lib/conkay/index.js";
import { TUB_DESIGN_CHOICES } from "../lib/conkay/structural/car-tub.js";

const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b}`);
const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";

describe("1983 rectangular mean crush force", () => {
  it("reconstructs the printed 38.27 from A1, 4π and A3", () => {
    near(reconstructedCoefficient(), FOLDING.coefficient, 0.001, "38.27");
  });

  it("square tube matches eq (7.4), Pm = 9.56 σ0 h^(5/3) C^(1/3)", () => {
    const h = 0.001, C = 0.1, sigma0 = 200e6;
    const got = meanCrushForce({ c: C, d: C, h, sigma0 });
    const printed = 9.56 * sigma0 * h ** (5 / 3) * C ** (1 / 3);
    near(got.Pm, printed, 0.001, "square");
    assert.equal(got.C, C);
  });

  it("a tall rectangle does not use either side as the square width", () => {
    const sigma0 = 276e6, h = 0.003, c = 0.07, d = 0.32;
    const got = meanCrushForce({ c, d, h, sigma0 });
    const asShort = 9.56 * sigma0 * h ** (5 / 3) * c ** (1 / 3);
    const asTall = 9.56 * sigma0 * h ** (5 / 3) * d ** (1 / 3);
    const asMean = 38.27 * (sigma0 * h * h / 4) * Math.cbrt(((c + d) / 2) / h);
    near(got.Pm, asMean, 1e-12, "mean side");
    assert.ok(Math.abs(got.Pm - asShort) / got.Pm > 0.2, "short side");
    assert.ok(Math.abs(got.Pm - asTall) / got.Pm > 0.05, "tall side");
  });
});

describe("crush paths on the car tub", () => {
  it("screens the existing rails and does not treat the quarters as a crush can", () => {
    const built = buildCarFromLibrary(BRIEF);
    const opened = openDesign(built.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.result("structure.crush-paths@CHASSIS");
    assert.equal(env.status, "WARN");
    assert.equal(env.margins.length, 0);
    const paths = env.outputs.paths.value;
    assert.equal(paths.dedicatedCrashBox, false);
    assert.equal(paths.squareFormulaApplied, false);
    assert.equal(env.outputs.dedicatedCrashBox.value, false);

    assert.equal(paths.front.members.length, 2);
    const rail = paths.front.members[0];
    const rs = TUB_DESIGN_CHOICES.frontRailSection.value;
    near(rail.c, rs.width, 1e-9, "width");
    near(rail.d, rs.height, 1e-9, "height");
    near(rail.h, rs.wall, 1e-9, "wall");
    near(rail.x0, TUB_DESIGN_CHOICES.frontRailX0.value, 1e-6, "rail start");
    assert.ok(rail.strokeM > 0 && rail.strokeM < rail.lengthM, `stroke ${rail.strokeM} length ${rail.lengthM}`);
    near(rail.strokeM, rail.xAxle - rail.x0, 1e-9, "stroke");
    const expectPm = 38.27 * (paths.material.sigma0Pa * rail.h ** 2 / 4) * Math.cbrt(rail.C / rail.h);
    near(rail.meanForceN, expectPm, 1e-9, "Pm");
    assert.equal(rail.squareFormulaApplied, false);
    assert.equal(rail.eulerUndercutsFolding, false);
    assert.ok(rail.euler.cantileverN > rail.meanForceN);
    assert.ok(rail.wideWall.slenderness.ratio > 50, "wide face is slender");

    assert.equal(paths.front.energyStatus, "screening upper bound");
    const sum = paths.front.members.reduce((s, m) => s + m.energyJ, 0);
    near(paths.front.energyJ, sum, 1e-12, "front energy");

    assert.equal(paths.rear.energyStatus, "not determined");
    assert.equal(paths.rear.energyJ, null);
    assert.equal(paths.rear.members.length, 2);
    for (const q of paths.rear.members) {
      assert.equal(q.energyJ, null);
      assert.equal(q.energyStatus, "not determined");
      assert.match(q.reason, /pickup/);
      assert.ok(q.aftOfCrossM < 0.1, `aft of cross ${q.aftOfCrossM}`);
      assert.ok(q.aftOfCrossM > 0);
    }

    assert.equal(paths.material.ultimateUsedAsFlowStress, false);
    assert.ok(paths.material.sigma0Pa > 200e6 && paths.material.sigma0Pa < 350e6);

    const ids = paths.comparisons.map((c) => `${c.massId}@${c.kmh}`);
    assert.deepEqual(ids.sort(), ["brief-max@48", "brief-max@56", "kerb@48", "kerb@56"]);
    for (const c of paths.comparisons) {
      near(c.kineticEnergyJ, kineticEnergyJ(c.massKg, c.kmh), 1e-12, c.speedId);
      assert.equal(c.compliance, "not an FMVSS result");
      assert.notEqual(c.reading, "pass");
      assert.ok(c.frontEnergyJ > 0);
    }
    const brief56 = paths.comparisons.find((c) => c.massId === "brief-max" && c.kmh === 56);
    assert.equal(brief56.reading, "short of this kinetic energy");
    assert.ok(env.warnings.some((w) => w.includes("short of that kinetic energy")));
    assert.ok(env.warnings.some((w) => w.includes("No crash box")));
  });

  it("kinetic energy is ½ m v²", () => {
    near(kineticEnergyJ(1000, 36), 0.5 * 1000 * 10 * 10, 1e-12, "10 m/s");
  });

  it("a direct call with no rear cross leaves the rear energy unset", () => {
    const r = crushPaths({
      frontRails: [{ id: "R", c: 0.07, d: 0.32, h: 0.003, lengthM: 0.74, x0: 0.68, xAxle: 1, xBoxEnd: 1.42 }],
      rearQuarters: [{ id: "Q", c: 0.08, d: 0.34, h: 0.005, lengthM: 0.72, x0: 3.58, xAxle: 3.966, xTip: 4.30, xCrossRear: 4.24 }],
      sigma0Pa: 276e6, ultimatePa: 310e6, youngsPa: 68.9e9, nu: 0.33,
      materialId: "aluminum-6061-t6", materialNote: "test",
      masses: [{ id: "m", kg: 1000, note: "test" }],
    });
    assert.equal(r.rear.energyJ, null);
    assert.ok(r.front.energyJ > 0);
    assert.equal(r.dedicatedCrashBox, false);
  });
});
