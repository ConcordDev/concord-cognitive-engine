// tests/conkay-sentinel-gait.test.js
//
// Quasi-static Sentinel M1 gait (brief 4 item 5). Pure function: the mass is
// an argument. This file does not call runSentinelM1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { solve1D } from "../lib/conkay/thermal/conduction.js";
import {
  G, LEG, ACTUATOR, CELL_WH, WINDOW, GAIT_VERSION,
  ratedPointEfficiency, packMissionWh, quasiStaticGait,
} from "../lib/conkay/sentinel/gait.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const MASS = 60.682;
const MASS_LOW = 60.108;
const MASS_HIGH = 61.890;
const D = 0.05;
const A_LOW = 0.12;
const A_HIGH = 0.15;

function ankleMotoringJ({ massKg, A }) {
  const L = LEG.straightM;
  const W = massKg * G;
  const singleReach = (2 / 3) * A;
  const F = (x) => -Math.sqrt(L * L - x * x) + D * Math.asin(x / L);
  // ∫ -share W (x+d) / sqrt(L^2-x^2) dx = -share W (F(x1)-F(x0)), motoring while x < -d
  const seg = (x0, x1, share) => -share * W * (F(x1) - F(x0));
  return seg(-A, -singleReach, 0.5) + seg(-singleReach, -D, 1);
}

describe("quasi-static gait", () => {
  const g = quasiStaticGait({ massKg: MASS, massLowKg: MASS_LOW, massHighKg: MASS_HIGH });

  it("uses the frame joint centres and the datasheet ratings, and leaves the gear ratio unknown", () => {
    assert.equal(GAIT_VERSION, "1.0.0");
    near(LEG.kneeZ - LEG.ankleZ, 0.878, 1e-12, "shin");
    near(LEG.hipZ - LEG.kneeZ, 0.878, 1e-12, "thigh");
    near(LEG.straightM, 1.756, 1e-12, "straight leg");
    assert.equal(ACTUATOR.ratedTorqueNm, 48);
    assert.equal(ACTUATOR.peakTorqueNm, 120);
    assert.equal(ACTUATOR.ratedSpeedRpm48V, 48);
    assert.equal(ACTUATOR.source, "cubemars-ak80-64");
    assert.equal(g.actuator.gearRatio.state, "unknown");
    assert.equal(g.actuator.gearRatio.status, "not determined");
    assert.equal(g.duty.replacesWalkLoadFactor, false);
    assert.equal(g.energy.closesDurationRequirement, false);
  });

  it("matches the closed-form joint moments", () => {
    const W = MASS * G;
    const cycle = g.cycleAtHighExcursion.stations;
    const endSingle = cycle.find((s) => s.support === "single" && s.xHipM > 0);
    const reach = (2 / 3) * A_HIGH;
    near(endSingle.torqueNm.ankle, W * (reach + D), 1e-3, "ankle at the end of single support");
    near(endSingle.torqueNm.knee, W * (reach / 2 + D), 1e-3, "knee");
    near(endSingle.torqueNm.hip, W * D, 1e-3, "hip");
    near(endSingle.speedRpm.ankle, (0.5 / Math.sqrt(LEG.straightM ** 2 - reach ** 2)) * 60 / (2 * Math.PI), 1e-3, "ankle rate");
    assert.equal(endSingle.speedRpm.knee.state, "unknown");
    // Early stance: the CoM is behind the ankle, so the ankle moment changes sign.
    const start = cycle[0];
    assert.ok(start.torqueNm.ankle < 0, "ankle moment is negative at the start of stance");
    assert.equal(start.support, "double");
  });

  it("fails rated torque on every joint that the range puts over 48 Nm, and does not call a crossed peak a pass", () => {
    assert.equal(g.margins.ankle.rated.status, "FAIL");
    assert.ok(g.margins.ankle.rated.utilization.low > 1);
    assert.equal(g.margins.knee.rated.status, "FAIL");
    assert.equal(g.margins.hip.rated.status, "PASS");
    assert.ok(g.margins.hip.rated.utilization.high < 1);
    // Centre mass, full-excursion single support, stays under the 120 Nm peak.
    // The high end of the mass band stacked on that excursion crosses it.
    const under = MASS * G * (A_HIGH + D);
    const over = MASS_HIGH * G * (A_HIGH + D);
    assert.ok(under < ACTUATOR.peakTorqueNm && over > ACTUATOR.peakTorqueNm, `${under} vs ${over}`);
    assert.equal(g.margins.ankle.peak.status, "not determined");
    assert.ok(g.margins.ankle.peak.utilization.low < 1 && g.margins.ankle.peak.utilization.high > 1);
    assert.equal(g.margins.knee.peak.status, "PASS");
    assert.equal(g.margins.hip.peak.status, "PASS");
  });

  it("passes ankle and hip speed against 48 rpm and leaves knee speed unknown", () => {
    assert.equal(g.speed.ankle.status, "PASS");
    assert.equal(g.speed.hip.status, "PASS");
    assert.ok(g.speed.ankle.utilization < 0.1);
    near(g.speed.ankle.rpm.high, (0.5 / Math.sqrt(LEG.straightM ** 2 - A_HIGH ** 2)) * 60 / (2 * Math.PI), 1e-4, "peak rate");
    assert.equal(g.speed.knee.state, "unknown");
    assert.equal(g.speed.knee.status, "not determined");
  });

  it("integrates positive ankle work to the closed form and does not credit regeneration or the swing leg", () => {
    const eff = ratedPointEfficiency();
    near(eff.eta, (48 * (48 * 2 * Math.PI / 60)) / (48 * 7), 1e-12, "eta");
    assert.equal(eff.state, "estimated");
    assert.ok(eff.electricalW > eff.mechanicalW);
    const hour = (massKg, A) => {
      const cycleS = ((2 * A) / 0.5) / 0.6;
      return (2 * ankleMotoringJ({ massKg, A }) / eff.eta) / cycleS / 3600;
    };
    const corners = [hour(MASS_LOW, A_LOW), hour(MASS_LOW, A_HIGH), hour(MASS_HIGH, A_LOW), hour(MASS_HIGH, A_HIGH)];
    near(g.energy.electricalWh.low, Math.min(...corners), 1e-4 * Math.min(...corners), "low corner");
    near(g.energy.electricalWh.high, Math.max(...corners), 1e-4 * Math.max(...corners), "high corner");
    assert.equal(g.energy.regeneration, "not credited; the excerpt does not say the drive regenerates");
    assert.ok(g.energy.excluded.some((e) => e.item === "swing leg" && e.state === "unknown"));
    assert.equal(g.energy.lowerBound, true);
    assert.equal(g.heating.hip.state, "unknown");
  });

  it("compares the gait lower bound to 13S2P and 13S5P without closing the duration requirement", () => {
    const two = packMissionWh(2);
    const five = packMissionWh(5);
    near(two.nominalWh, 26 * CELL_WH, 1e-9, "13S2P");
    near(five.nominalWh, 65 * CELL_WH, 1e-9, "13S5P");
    near(two.missionWh.centre, 26 * CELL_WH * (WINDOW.usable.value - WINDOW.reserve.value), 1e-9, "mission centre");
    near(two.missionWh.low, 26 * CELL_WH * (WINDOW.usable.low - WINDOW.reserve.value), 1e-9, "mission low");
    assert.equal(two.usableState, "estimated");
    assert.equal(two.reserveState, "requirement");
    assert.equal(g.energy.packs["13S2P"].lowerBoundVsWindow, "below the low end of the window");
    assert.equal(g.energy.packs["13S5P"].lowerBoundVsWindow, "below the low end of the window");
    assert.equal(g.energy.packs["13S2P"].requirementStatus, "not closed");
    assert.ok(g.energy.electricalWh.high < two.missionWh.low);
    assert.equal(g.energy.packs["13S2P"].lowerBoundVsWindow === "PASS", false);
  });

  it("matches solve1D to the lumped housing balance and does not pass or fail a temperature", () => {
    const loss = g.heating.ankleAverageLossW.high;
    const h = 5;
    const D = ACTUATOR.envelopeM.diameter;
    const Len = ACTUATOR.envelopeM.length;
    const lateral = Math.PI * D * Len;
    const lumped = 25 + loss / (h * lateral);
    const hot = g.heating.cases.find((c) => c.atHighLoss.hWm2K === h).atHighLoss;
    near(hot.lumpedC, lumped, 1e-4, "lumped");
    near(hot.solve1DC, lumped, 1e-4, "solve1D");
    near(hot.kDroppedOutC, 0, 1e-6, "k does not enter this balance");
    const area = Math.PI * (D / 2) ** 2;
    const solved = solve1D({
      L: Len, n: 20, k: 15, area, perimeter: Math.PI * D, hLateral: h, TinfLateral: 25,
      generation: loss / (area * Len),
      left: { type: "adiabatic" }, right: { type: "adiabatic" }, steady: true,
    });
    near(solved.T[0], lumped, 1e-6, "independent solve1D");
    assert.equal(hot.limitC.state, "unknown");
    assert.equal(hot.status, "not determined");
    assert.equal(hot.hState, "estimated");
    const mild = g.heating.cases.find((c) => c.atHighLoss.hWm2K === 10).atHighLoss;
    assert.ok(mild.lumpedC < hot.lumpedC);
  });
});
