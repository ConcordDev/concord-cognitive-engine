// The ConKay workspace example from the live test: Al 6061-T6, 3 m span,
// 5 kN midspan, current section, checked against a required SF of 1.5.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solveBeamStudy, beamRequiredSafetyFactor } from "../domains/engineering.js";

const SECTION = { height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 };
const run = (extra) => solveBeamStudy({ dims: { length: 3000, ...SECTION }, loadN: 5000, support: "simply-supported", material: "aluminum-6061-t6", ...extra });

test("beamStudy checks the result against the required safety factor", () => {
  const r = run({ requiredSafetyFactor: 1.5 });
  assert.equal(r.ok, true);
  assert.equal(r.result.material.id, "aluminum-6061-t6");
  // PL/4 · c / I = 5000·3000/4 · 150 / Ix
  const Ix = 150 * 300 ** 3 / 12 - 141 * 270 ** 3 / 12;
  assert.ok(Math.abs(r.result.maxStressMPa - (5000 * 3000 / 4) * 150 / Ix) / r.result.maxStressMPa < 0.02);
  const sc = r.result.safetyCheck;
  assert.equal(sc.requiredSafetyFactor, 1.5);
  assert.equal(sc.stated, true);
  assert.equal(sc.pass, true);
  assert.ok(Math.abs(sc.achievedSafetyFactor - 276 / r.result.maxStressMPa) < 0.1);
  assert.ok(sc.marginPct > 0);
  assert.match(sc.verdict, /^PASS: achieved SF [\d.]+ vs required SF 1\.5, margin \+/);
});

test("a heavy load FAILs against the same safety factor", () => {
  const r = run({ loadN: 400000, requiredSafetyFactor: 1.5 });
  assert.equal(r.result.safetyCheck.pass, false);
  assert.ok(r.result.safetyCheck.marginPct < 0);
  assert.match(r.result.safetyCheck.verdict, /^FAIL/);
});

test("the SF can arrive as text and is parsed with the conkay_design parser", () => {
  assert.equal(run({ safetyFactorText: "with a safety factor of 1.5" }).result.safetyCheck.requiredSafetyFactor, 1.5);
  assert.equal(beamRequiredSafetyFactor({ requiredSafetyFactor: 2 }).value, 2);
  assert.equal(beamRequiredSafetyFactor({}).value, null);
  assert.ok(beamRequiredSafetyFactor({ requiredSafetyFactor: 50 }).note);
});

test("no SF stated: checked against yield, stated=false", () => {
  const sc = run({}).result.safetyCheck;
  assert.equal(sc.stated, false);
  assert.equal(sc.requiredSafetyFactor, 1);
});
