// server/tests/conkay-envelope-refusal.test.js
//
// Out-of-envelope car briefs must refuse as a structured judgment, never throw
// from buildCarFromLibrary / carAcceptance / carAcceptanceAsync. Pins the tyre
// established-speed wall (library: 300 km/h / 186 mph) and regresses in-envelope
// showcase + mass-only acceptance.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCarFromLibrary,
  carAcceptance,
  carAcceptanceAsync,
} from "../lib/conkay/compiler/car-from-library.js";

const SHOWCASE =
  "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const SPEED_250 =
  "Design a car that weighs 2,500 lb, can go 250 mph, seats 4 people, and has a futuristic aerodynamic look.";
const IMPOSSIBLE =
  "Design a car that weighs 1,500 lb, can go 250 mph, seats 6 people, and has a futuristic aerodynamic look.";
const MASS_ONLY =
  "Design a car that weighs 1,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";

const TYRE_WALL_RE =
  /no tyre in the library is established above 300 km\/h \(186 mph\); the brief requires 402(?:\.3)? km\/h \(250 mph\)/;

describe("ConKay envelope refusal (tyre established-speed wall)", () => {
  it("buildCarFromLibrary refuses the 250 mph brief without throwing", () => {
    const b = buildCarFromLibrary(SPEED_250, { cadBody: false });
    assert.equal(b.ir, undefined);
    assert.match(b.error, TYRE_WALL_RE);
  });

  it("buildCarFromLibrary refuses the full impossible brief without throwing", () => {
    const b = buildCarFromLibrary(IMPOSSIBLE, { cadBody: false });
    assert.match(b.error, TYRE_WALL_RE);
  });

  it("the same out-of-envelope brief is deterministic", () => {
    const a = buildCarFromLibrary(IMPOSSIBLE, { cadBody: false });
    const b = buildCarFromLibrary(IMPOSSIBLE, { cadBody: false });
    assert.equal(a.error, b.error);
    assert.match(a.error, TYRE_WALL_RE);
  });

  it("carAcceptance (sync) returns the structured refusal — no throw", () => {
    const r = carAcceptance(SPEED_250, { cadBody: false });
    assert.equal(r.ok, false);
    assert.match(r.error, TYRE_WALL_RE);
    assert.equal(r.report, undefined);
  });

  it("carAcceptanceAsync returns the structured refusal — no throw", async () => {
    const r = await carAcceptanceAsync(IMPOSSIBLE, { cadBody: false });
    assert.equal(r.ok, false);
    assert.match(r.error, TYRE_WALL_RE);
    assert.equal(r.report, undefined);
  });
});

describe("ConKay envelope refusal — in-envelope regressions", () => {
  it("showcase brief sync acceptance is unchanged (verdicts + headline numbers)", () => {
    const r = carAcceptance(SHOWCASE, { cadBody: false });
    assert.equal(r.ok, true, r.error);
    const rep = r.report;
    assert.equal(rep.verdict, "not_physically_credible");
    assert.equal(rep.status, "FAIL");
    const byId = Object.fromEntries(rep.requirements.map((x) => [x.id, x.status]));
    assert.equal(byId.REQ_mass, "PASS");
    assert.equal(byId.REQ_topSpeed, "PASS");
    assert.equal(byId.REQ_seats, "PASS");
    assert.equal(rep.topSpeed.kmh, 295);
    assert.equal(rep.topSpeed.mph, 183.3);
    assert.equal(rep.massBreakdown.vsTarget.targetLb, 2500);
    assert.equal(rep.massBreakdown.vsTarget.totalKg, 997.2);
  });

  it("showcase brief async acceptance still passes the three requirements", async () => {
    const r = await carAcceptanceAsync(SHOWCASE);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.report.verdict, "credible_with_caveats");
    const byId = Object.fromEntries(r.report.requirements.map((x) => [x.id, x.status]));
    assert.equal(byId.REQ_mass, "PASS");
    assert.equal(byId.REQ_topSpeed, "PASS");
    assert.equal(byId.REQ_seats, "PASS");
    assert.equal(r.report.topSpeed.kmh, 295);
  });

  it("mass-only impossible variant still fails REQ_mass at acceptance (others PASS)", () => {
    // packaging: false isolates the mass judgment the way the founder repro did
    // (with packaging on, occupant-fit failures also fire on this brief).
    const r = carAcceptance(MASS_ONLY, { packaging: false, cadBody: false });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.report.verdict, "not_physically_credible");
    assert.deepEqual(r.report.failures, ['requirement REQ_mass (weighs 1,500 lb) fails']);
    const byId = Object.fromEntries(r.report.requirements.map((x) => [x.id, x.status]));
    assert.equal(byId.REQ_mass, "FAIL");
    assert.equal(byId.REQ_topSpeed, "PASS");
    assert.equal(byId.REQ_seats, "PASS");
  });
});
