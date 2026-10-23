// server/tests/conkay-electrical-motor-thermal.test.js
//
// Closed-form acceptance tests for electrical.motor-thermal.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { motorThermal, INSULATION_CLASSES } from "../lib/conkay/physics/solvers/electrical-motor-thermal.js";

const TAMB = 298.15;

describe("electrical.motor-thermal — winding temperature model", () => {
  it("current from torque: I = tau/(Kt·G·eta)", () => {
    const r = motorThermal({
      torqueNm: 30,
      motor: { KtNmPerA: 0.30, gearRatio: 100, driveEfficiency: 0.9 },
    });
    assert.equal(r.status === "not_computed", false, `expected computed, got ${r.status} ${r.reason}`);
    // 30 / (0.30 * 100 * 0.9) = 1.1111... A
    assert.ok(Math.abs(r.current.armatureA - 30 / (0.30 * 100 * 0.9)) < 1e-12);
    assert.ok(r.current.armatureA > 1.1 && r.current.armatureA < 1.12);
  });

  it("three-phase copper loss P = 3·I²·Rphase", () => {
    const motor = { KtNmPerA: 0.30, gearRatio: 100, driveEfficiency: 0.9, RphaseOhm: 0.08 };
    const r = motorThermal({ torqueNm: 30, motor });
    const I = r.current.armatureA;
    assert.equal(r.copperLoss.model, "three_phase_winding");
    assert.ok(Math.abs(r.copperLoss.W - 3 * I * I * 0.08) < 1e-12);
  });

  it("DC fallback when only Rtotal supplied", () => {
    const r = motorThermal({
      torqueNm: 10,
      motor: { KtNmPerA: 0.2, gearRatio: 50, driveEfficiency: 1.0, RtotalOhm: 0.5 },
    });
    assert.equal(r.copperLoss.model, "dc_equivalent");
    const I = r.current.armatureA;
    assert.ok(Math.abs(r.copperLoss.W - I * I * 0.5) < 1e-12);
  });

  it("missing winding resistance ⇒ copper loss notComputed (never fabricated)", () => {
    const r = motorThermal({ torqueNm: 10, motor: { KtNmPerA: 0.2, gearRatio: 10 } });
    assert.equal(r.copperLoss.notComputed, true);
    assert.match(r.copperLoss.reason, /winding resistance/i);
  });

  it("winding thermal network converges to the analytic steady state", () => {
    const motor = {
      KtNmPerA: 0.30, gearRatio: 100, driveEfficiency: 0.9,
      RphaseOhm: 0.08,
      RhwKW: 0.6, RhaKW: 2.0,
      CwJPerK: 180, ChJPerK: 1200,
      insulationClass: "F",
      TambientK: TAMB,
    };
    // Run long enough to be past several time constants.
    const r = motorThermal({ torqueNm: 30, motor, durationS: 900, dtS: 0.5 });
    assert.equal(r.thermal.notComputed, false);
    const P = r.copperLoss.W;
    // Analytic: T_ss_winding = Tamb + P*Rhw
    const expected = TAMB + P * 0.6;
    assert.ok(Math.abs(r.thermal.steadyStateWindingK - expected) < 1e-9,
      `steady state ${r.thermal.steadyStateWindingK} vs expected ${expected}`);
    // The simulated peak should approach the analytic steady state.
    assert.ok(Math.abs(r.temperatures.windingPeakK - expected) < 2.0,
      `simulated peak ${r.temperatures.windingPeakK} vs analytic ${expected}`);
    // Housing sits between winding and ambient.
    assert.ok(r.temperatures.housingPeakK > TAMB);
    assert.ok(r.temperatures.housingPeakK < r.temperatures.windingPeakK);
  });

  it("insulation limit exceeded ⇒ fail", () => {
    const motor = {
      KtNmPerA: 0.05, gearRatio: 10, driveEfficiency: 0.85,   // low Kt ⇒ high current
      RphaseOhm: 0.9,               // high resistance ⇒ large copper loss
      RhwKW: 1.4, RhaKW: 2.5,       // poor heat path ⇒ winding runs hot
      CwJPerK: 180, ChJPerK: 1200,
      insulationClass: "F",         // 428.15 K
      TambientK: TAMB,
    };
    // I = 60 / (0.05*10*0.85) = 141 A ; P = 3*141^2*0.9 ≈ 53.8 kW ;
    // steady-state winding rise = 53.8k * 1.4 ≈ 75,000 K ⇒ far past 428 K.
    const r = motorThermal({ torqueNm: 60, motor, durationS: 4000, dtS: 0.5 });
    assert.equal(r.status, "fail");
    assert.ok(r.reasons.some((x) => /insulation limit/i.test(x)), r.reasons.join("; "));
  });

  it("bus voltage sag under load ⇒ fail", () => {
    const motor = {
      KtNmPerA: 0.30, gearRatio: 100, driveEfficiency: 0.9,
      RphaseOhm: 0.08, KbackemfVsRad: 0.02, Vbus: 12,
    };
    const r = motorThermal({ torqueNm: 30, jointOmegaRad: 8, motor });
    assert.equal(r.busCheck.notComputed, false);
    // At 8 rad/s joint => 800 rad/s armature => back-EMF 16 V > 12 V bus.
    assert.equal(r.busCheck.feasible, false);
    assert.equal(r.status, "fail");
  });

  it("bus voltage sufficient ⇒ feasible", () => {
    const motor = {
      KtNmPerA: 0.30, gearRatio: 100, driveEfficiency: 0.9,
      RphaseOhm: 0.08, KbackemfVsRad: 0.02, Vbus: 48,
    };
    const r = motorThermal({ torqueNm: 30, jointOmegaRad: 8, motor });
    assert.equal(r.busCheck.feasible, true);
    assert.notEqual(r.status, "fail");
  });

  it("duty cycle reduces continuous-equivalent RMS current by sqrt(d)", () => {
    const base = { KtNmPerA: 0.30, gearRatio: 100, driveEfficiency: 0.9, RphaseOhm: 0.08 };
    const full = motorThermal({ torqueNm: 30, motor: base, dutyCycle: 1 });
    const half = motorThermal({ torqueNm: 30, motor: base, dutyCycle: 0.5 });
    assert.ok(Math.abs(half.current.continuousEquivalentRmsA - full.current.continuousEquivalentRmsA * Math.sqrt(0.5)) < 1e-12);
    assert.ok(Math.abs(half.copperLoss.averageW - 0.5 * full.copperLoss.W) < 1e-12);
  });

  it("missing torqueNm ⇒ not_computed with the missing field named", () => {
    const r = motorThermal({ motor: { KtNmPerA: 0.3 } });
    assert.equal(r.status, "not_computed");
    assert.ok(r.missing.includes("torqueNm"));
  });

  it("missing Kt ⇒ not_computed", () => {
    const r = motorThermal({ torqueNm: 10, motor: {} });
    assert.equal(r.status, "not_computed");
    assert.ok(r.missing.includes("motor.KtNmPerA"));
  });

  it("insulation class table exposes the standard limits", () => {
    assert.ok(Math.abs(INSULATION_CLASSES.B - 433.15) < 1e-9);
    assert.ok(Math.abs(INSULATION_CLASSES.H - 453.15) < 1e-9);
  });
});