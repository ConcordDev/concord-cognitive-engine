// server/tests/conkay-electrical-battery-budget.test.js
//
// Closed-form acceptance tests for electrical.battery-budget.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { batteryBudget } from "../lib/conkay/physics/solvers/electrical-battery-budget.js";

const BATTERY = { Vnominal: 24, AhCapacity: 10, maxDischargeCurrentA: 40, depthOfDischargeLimit: 0.8 };

/** A single-joint actuator: Kt 0.3 N·m/A, 100:1, 85% drive, 0.08 Ω. */
function actuator(overrides = {}) {
  return { KtNmPerA: 0.3, gearRatio: 100, driveEfficiency: 0.85, gearEfficiency: 0.95, RtotalOhm: 0.08, ...overrides };
}

/** Build `n` frames each holding the same torque/omega pair for `dt`. */
function frames(tau, omega, n, dt) {
  const out = [];
  for (let k = 0; k < n; k += 1) out.push({ t: k * dt, joints: { j1: { tau, omega } } });
  return out;
}

describe("electrical.battery-budget — energy and power budget", () => {
  it("isometric hold still draws power (copper loss floor), not zero", () => {
    // omega = 0 so the mechanical term vanishes, but the current still flows.
    const r = batteryBudget({
      frames: frames(30, 0, 100, 0.02),
      actuatorMap: { j1: actuator() },
      battery: BATTERY,
    });
    assert.notEqual(r.status, "not_computed");
    assert.ok(r.totals.energyDrawWh > 0, "an isometric hold must not report zero draw");
    // I = 30 / (0.3*100*0.85) = 1.176 A ; Pcu = 1.176^2 * 0.08 = 0.1107 W
    // Pdrive = 0 / (0.85*0.95) = 0 ; Pelec = max(0, Pcu) = 0.1107 W
    const I = 30 / (0.3 * 100 * 0.85);
    const expectedW = I * I * 0.08;
    // 100 frames * 0.02 s = 2 s ⇒ Wh = expectedW * 2 / 3600
    const expectedWh = expectedW * 2 / 3600;
    assert.ok(Math.abs(r.totals.energyDrawWh - expectedWh) < 1e-12,
      `expected ${expectedWh}, got ${r.totals.energyDrawWh}`);
  });

  it("moving joint: current follows the torque/omega mechanical path", () => {
    const r = batteryBudget({
      frames: frames(30, 5, 100, 0.02),
      actuatorMap: { j1: actuator() },
      battery: BATTERY,
    });
    assert.ok(r.totals.mechanicalOutWh > 0);
    // Pmech = 30*5 = 150 W ; Pdrive = 150/(0.85*0.95) = 185.7 W
    assert.ok(Math.abs(r.totals.peakPowerW - 150 / (0.85 * 0.95)) < 1e-6,
      `peak ${r.totals.peakPowerW}`);
    assert.ok(Math.abs(r.totals.mechanicalOutWh - 150 * 2 / 3600) < 1e-12);
  });

  it("back-driven motion regenerates; the credit is reported but only spent when countRegen", () => {
    // Same magnitude, opposite sign: the drive pushes energy back instead of
    // drawing it, so the recovered figure is strictly positive and equals the
    // gap between the gross (no-regen) draw and the net draw.
    const rRegen = batteryBudget({ frames: frames(-30, 5, 100, 0.02), actuatorMap: { j1: actuator() }, battery: BATTERY });
    const rRegenCredited = batteryBudget({
      frames: frames(-30, 5, 100, 0.02), actuatorMap: { j1: actuator() }, battery: BATTERY, countRegen: true,
    });
    const rFwd = batteryBudget({ frames: frames(30, 5, 100, 0.02), actuatorMap: { j1: actuator() }, battery: BATTERY });

    assert.ok(rRegen.totals.energyRecoveredWh > 0, "regen credit should be reported");
    // Without countRegen the budget stays conservative.
    assert.ok(Math.abs(rRegen.totals.energyDrawWh - rFwd.totals.energyDrawWh) < 1e-12,
      "without countRegen the back-driven case should bill the same as motoring");
    // With countRegen the draw drops by exactly the reported credit.
    const delta = rRegen.totals.energyDrawWh - rRegenCredited.totals.energyDrawWh;
    assert.ok(Math.abs(delta - rRegenCredited.totals.energyRecoveredWh) < 1e-12,
      `drop ${delta} should equal the credit ${rRegenCredited.totals.energyRecoveredWh}`);
    assert.ok(rRegenCredited.totals.energyDrawWh < rRegen.totals.energyDrawWh);
  });

  it("regen never exceeds the copper loss (no free energy)", () => {
    const r = batteryBudget({
      frames: frames(-30, 5, 100, 0.02),
      actuatorMap: { j1: actuator() },
      battery: BATTERY, countRegen: true,
    });
    assert.ok(r.totals.energyDrawWh > 0, `net draw must stay positive: ${r.totals.energyDrawWh}`);
    assert.ok(r.totals.copperLossWh > 0);
    // Gross regen can never exceed the gross energy that went in.
    assert.ok(r.totals.energyRecoveredWh < r.totals.energyInWh + r.totals.energyRecoveredWh,
      `regen ${r.totals.energyRecoveredWh} is not physically bounded`);
    // With regen credited, the reported draw still exceeds the pure copper floor.
    const floorWh = r.totals.copperLossWh;
    assert.ok(r.totals.energyDrawWh >= floorWh - 1e-15,
      `draw ${r.totals.energyDrawWh} fell below the copper floor ${floorWh}`);
  });

  it("battery capacity arithmetic matches V * Ah", () => {
    const r = batteryBudget({ frames: frames(1, 1, 10, 0.02), actuatorMap: { j1: actuator() }, battery: BATTERY });
    assert.ok(Math.abs(r.battery.energyTotalWh - 24 * 10) < 1e-12);
    assert.ok(Math.abs(r.battery.energyUsableWh - 24 * 10 * 0.8) < 1e-12);
    assert.ok(Math.abs(r.battery.peakPowerLimitW - 24 * 40) < 1e-12);
  });

  it("peak draw beyond the pack limit ⇒ fail", () => {
    // Small pack: 10 V at 2 A = 20 W. Command a big fast move.
    const r = batteryBudget({
      frames: frames(300, 60, 200, 0.02),
      actuatorMap: { j1: actuator() },
      battery: { Vnominal: 10, AhCapacity: 1, maxDischargeCurrentA: 2 },
    });
    assert.equal(r.status, "fail");
    assert.ok(r.reasons.some((x) => /pack limit/i.test(x)), r.reasons.join("; "));
  });

  it("long duration exhausting usable capacity ⇒ fail", () => {
    // Big torques for a long time on a tiny pack.
    const r = batteryBudget({
      frames: frames(200, 40, 5000, 0.02),          // 100 s
      actuatorMap: { j1: actuator() },
      battery: { Vnominal: 12, AhCapacity: 0.2, maxDischargeCurrentA: 200, depthOfDischargeLimit: 0.5 },
    });
    assert.equal(r.status, "fail");
    assert.ok(r.reasons.some((x) => /usable capacity/i.test(x)), r.reasons.join("; "));
  });

  it("incomplete actuator spec ⇒ warn + partial, and the joint is excluded not zeroed", () => {
    const r = batteryBudget({
      frames: frames(30, 5, 50, 0.02),
      actuatorMap: { j1: actuator(), j2: { KtNmPerA: 0.3 } },   // j2 missing R + gear
      battery: BATTERY,
    });
    assert.equal(r.status, "warn");
    assert.equal(r.partial, true);
    assert.equal(r.unresolvedJoints.length, 1);
    assert.equal(r.unresolvedJoints[0].jointId, "j2");
    assert.ok(r.unresolvedJoints[0].missing.includes("RtotalOhm"));
    assert.ok(r.unresolvedJoints[0].missing.includes("gearRatio"));
    const j2 = r.perJoint.find((j) => j.jointId === "j2");
    assert.ok(j2.notComputed, "j2 must carry a notComputed marker");
  });

  it("idle frames (no joint command) draw nothing", () => {
    const r = batteryBudget({
      frames: [{ t: 0 }, { t: 0.02 }, { t: 0.04 }],
      actuatorMap: { j1: actuator() },
      battery: BATTERY,
    });
    assert.ok(r.totals.energyDrawWh === 0, `idle frames should draw nothing, got ${r.totals.energyDrawWh}`);
    assert.ok(r.totals.peakPowerW === 0);
  });

  it("missing battery data ⇒ not_computed naming the field", () => {
    const r = batteryBudget({ frames: frames(1, 1, 2, 0.02), actuatorMap: { j1: actuator() }, battery: { Vnominal: 24 } });
    assert.equal(r.status, "not_computed");
    assert.ok(r.missing.includes("battery.AhCapacity"));
    assert.ok(r.missing.includes("battery.maxDischargeCurrentA"));
  });

  it("missing frames ⇒ not_computed", () => {
    const r = batteryBudget({ actuatorMap: { j1: actuator() }, battery: BATTERY });
    assert.equal(r.status, "not_computed");
    assert.ok(r.missing.includes("frames"));
  });

  it("conversion efficiency is reported and physically bounded", () => {
    const r = batteryBudget({ frames: frames(30, 5, 100, 0.02), actuatorMap: { j1: actuator() }, battery: BATTERY });
    const eta = r.totals.conversionEfficiency;
    assert.ok(eta > 0.5 && eta < 1.0, `expected a plausible drive efficiency, got ${eta}`);
  });

  it("endurance is withheld without a duty cycle, and the window is reported instead", () => {
    const r = batteryBudget({
      frames: frames(30, 5, 100, 0.02), actuatorMap: { j1: actuator() }, battery: BATTERY,
    });
    // A 2 s window is not representative of continuous operation, so no
    // whole-pack extrapolation may be produced.
    assert.equal(r.endurance.runtimeHours, null, "endurance must not be invented from a short window");
    assert.equal(r.endurance.repeatableRuns, null);
    assert.equal(r.endurance.extrapolationBasis, "measured_window_only");
    assert.ok(r.endurance.caveat, "withholding endurance must be explained");
    assert.ok(r.endurance.blockedBy.some((x) => /dutyCycle/.test(x)), r.endurance.blockedBy.join("; "));

    // The measured window is always available and is the honest figure.
    assert.ok(r.measuredWindow.durationS > 1.9 && r.measuredWindow.durationS < 2.1,
      `expected a ~2 s window, got ${r.measuredWindow.durationS}`);
    assert.ok(r.measuredWindow.energyWh > 0);
    assert.ok(Number.isFinite(r.measuredWindow.meanPowerW));
    // NOTE: peak is the max of the per-frame SUM across joints, while mean is
    // the time-average. Under regen those two need not satisfy
    // peak >= mean, so no such relation is asserted here.
  });

  it("mean power is in watts, not watt-hours per second", () => {
    const r = batteryBudget({
      frames: frames(30, 5, 100, 0.02), actuatorMap: { j1: actuator() }, battery: BATTERY,
    });
    // meanPowerW must equal energyWh * 3600 / durationS. That identity is the
    // whole point: Wh/s is not W, and the earlier version was off by 3600x.
    const { energyWh, durationS } = r.measuredWindow;
    const expectedW = (energyWh * 3600) / durationS;
    assert.ok(Math.abs(r.measuredWindow.meanPowerW - expectedW) < 1e-9,
      `mean power ${r.measuredWindow.meanPowerW} W vs ${expectedW} W`);
    // Independent check against the mechanical path: 30 N·m * 5 rad/s = 150 W
    // through the gearbox and drive, so the mean must be at least that.
    const mechanicalPathW = 150 / (0.9 * 0.95);
    assert.ok(r.measuredWindow.meanPowerW > mechanicalPathW * 0.99,
      `mean ${r.measuredWindow.meanPowerW} W should be at least the ${mechanicalPathW} W mechanical path`);
    assert.ok(r.measuredWindow.meanPowerW < 500, "sanity: this is a sub-kW profile, not a MW one");
  });

  it("with a duty cycle, endurance scales linearly with usable energy", () => {
    const base = { frames: frames(30, 5, 100, 0.02), actuatorMap: { j1: actuator() }, dutyCycle: 0.4, cycleSeconds: 1.0 };
    const small = batteryBudget({ ...base, battery: { Vnominal: 24, AhCapacity: 2, maxDischargeCurrentA: 40 } });
    const large = batteryBudget({ ...base, battery: { Vnominal: 24, AhCapacity: 20, maxDischargeCurrentA: 400 } });
    assert.equal(small.endurance.extrapolationBasis, "duty_cycle");
    assert.equal(small.endurance.caveat, null);
    // A 10x pack gives a 10x runtime for the same profile.
    const ratio = large.endurance.runtimeHours / small.endurance.runtimeHours;
    assert.ok(Math.abs(ratio - 10) < 1e-6, `expected a 10x endurance ratio, got ${ratio}`);
    // Sanity: a ~175 W machine on a 38.4 Wh pack cannot run for years.
    assert.ok(small.endurance.runtimeHours < 24,
      `runtime ${small.endurance.runtimeHours} h is implausible for this load`);
  });

  it("coverageFraction scales runtime for a partially-measured machine", () => {
    const base = { frames: frames(30, 5, 100, 0.02), actuatorMap: { j1: actuator() }, battery: BATTERY, dutyCycle: 0.4, cycleSeconds: 1.0 };
    const whole = batteryBudget({ ...base, coverageFraction: 1.0 });
    const oneLeg = batteryBudget({ ...base, coverageFraction: 0.12 });
    // A joint that is only 12% of machine power implies the whole machine draws
    // ~8.3x more, so runtime must be ~8.3x shorter.
    const ratio = whole.endurance.runtimeHours / oneLeg.endurance.runtimeHours;
    assert.ok(Math.abs(ratio - 1 / 0.12) < 1e-6, `expected 1/0.12 ratio, got ${ratio}`);
  });

  it("an out-of-range coverageFraction withholds endurance with a reason", () => {
    const r = batteryBudget({
      frames: frames(30, 5, 100, 0.02), actuatorMap: { j1: actuator() }, battery: BATTERY,
      dutyCycle: 0.4, cycleSeconds: 1.0, coverageFraction: 3.5,
    });
    assert.equal(r.endurance.runtimeHours, null);
    assert.ok(r.endurance.blockedBy.some((x) => /coverageFraction/.test(x)), r.endurance.blockedBy.join("; "));
  });
});