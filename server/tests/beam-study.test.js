// lib/conkay/beam-study.js — the ConKay workspace's I-beam study must agree
// with the textbook formula for each support case before the UI is allowed
// to say "FEA agrees with the hand calculation".
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBeamStudy, summarizeBeamStudy, cleanBeamDims } from "../lib/conkay/beam-study.js";
import { runFEA } from "../lib/simulation/fea-solver.js";

const DIMS = { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 };
const A992 = { E: 200000, yield: 345 };

test("I-beam section properties come from the real dimensions", () => {
  const s = buildBeamStudy({ dims: DIMS, material: A992, loadN: 1000 });
  // 2·150·15 + (300 − 30)·9 = 6930 mm²
  assert.ok(Math.abs(s.section.areaMm2 - 6930) < 1e-6);
  // 150·300³/12 − 141·270³/12
  assert.ok(Math.abs(s.section.IxMm4 - (150 * 300 ** 3 / 12 - 141 * 270 ** 3 / 12)) < 1e-3);
});

for (const [support, stress, defl] of [
  ["simply-supported", 84.73, 0.3389],
  ["cantilever", 338.9, 5.4225],
  ["fixed", 42.36, 0.0847],
]) {
  test(`${support}: FEA matches the hand calculation`, () => {
    const s = buildBeamStudy({ dims: DIMS, material: A992, support, loadN: 200000 });
    const r = summarizeBeamStudy(s, runFEA(s.model), A992);
    assert.ok(Math.abs(r.maxStressMPa - stress) < 0.01, `stress ${r.maxStressMPa}`);
    assert.ok(Math.abs(r.maxDeflectionMm - defl) < 0.0001, `deflection ${r.maxDeflectionMm}`);
    assert.equal(r.handCheck.agrees, true);
    assert.ok(Math.abs(r.safetyFactor - 345 / r.maxStressMPa) < 1e-9);
    assert.ok(Math.abs(r.utilization - r.maxStressMPa / 345) < 1e-6);
  });
}

test("thinner web reduces stiffness: stress and deflection go up", () => {
  const thick = buildBeamStudy({ dims: DIMS, material: A992, loadN: 200000 });
  const thin = buildBeamStudy({ dims: { ...DIMS, webThickness: 8 }, material: A992, loadN: 200000 });
  const a = summarizeBeamStudy(thick, runFEA(thick.model), A992);
  const b = summarizeBeamStudy(thin, runFEA(thin.model), A992);
  assert.ok(b.maxStressMPa > a.maxStressMPa);
  assert.ok(b.maxDeflectionMm > a.maxDeflectionMm);
});

test("impossible geometry and missing inputs are refused", () => {
  assert.equal(cleanBeamDims({ ...DIMS, flangeThickness: 160 }).ok, false);
  assert.equal(cleanBeamDims({ ...DIMS, webThickness: 200 }).ok, false);
  assert.equal(cleanBeamDims({ ...DIMS, length: -5 }).ok, false);
  assert.equal(buildBeamStudy({ dims: DIMS, material: A992, loadN: 0 }).ok, false);
  assert.equal(buildBeamStudy({ dims: DIMS, material: null, loadN: 10 }).ok, false);
});
