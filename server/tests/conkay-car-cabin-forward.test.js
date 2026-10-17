// Car cabin-forward pass (car-design brief item 0): can a PUBLISHED seat-position accommodation model move the
// 2+2 electric car's cabin forward? Measured answer (2026-10-17): no. This file pins the sourced model (SAE 980651
// SAM, locators in references.json), where the layout's front seat sits in the driver population, and what each
// accommodation target would do to the rear H-point. No layout value changed in this pass (the rear H-point 3.458 m,
// rear axle 4.251 m and firewall 1.4668 m are the 2+2 pass's), so no kernel run is needed.
// A passing test here is not a physical validation of the car.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { PACKAGING_REFERENCES as REFS } from "../lib/conkay/packaging/occupant.js";
import { umtriHPointX } from "../lib/conkay/packaging/checks.js";
import { samDistributions, samSeatPositionSd, samPercentileOffsetMm, samAccommodationTrack, samTrackCoverage, samPercentileOfOffset, normalCdf } from "../lib/conkay/packaging/seat-position-model.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const build = () => buildCarFromLibrary(BRIEF, { config: { fuelType: "electric", motorId: "motor.cascadia.im-375-dz" }, cadBody: false });
const pkg = (b) => b.ir.nodes.find((n) => n.id === "VEH").props.vehicle.packaging;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} vs ${b} (tol ${tol})`);

describe("the sourced model (SAE 980651 SAM, read from the paper)", () => {
  const s = REFS.samSeatPosition;
  it("carries the published coefficients and locators", () => {
    assert.equal(s.coefficients.statureSlope, 0.433);
    assert.equal(s.coefficients.statureSlopeSquared, 0.187);
    assert.equal(s.coefficients.residualVariance, 885);
    assert.equal(s.coefficients.residualSdMm, 29.75);
    near(0.433 ** 2, 0.187, 5e-4); near(29.75 ** 2, 885, 0.5);
    assert.match(s.source.title, /SAE Technical Paper 980651/);
    assert.match(s.source.url, /Flannagan_19980651\.pdf$/);
    assert.deepEqual(s.populations.US, { maleMeanMm: 1753, maleSdMm: 71, femaleMeanMm: 1615, femaleSdMm: 64, source: s.populations.US.source });
    for (const k of ["meanEquation", "sdEquation", "mixture", "populations"]) assert.ok(s.source.locators[k], k);
    assert.match(s.equations.mean, /16\.83 \+ 0\.433 muS - 0\.24 h - 2\.19 p \+ 0\.41 w - 18\.2 t/);
    assert.match(s.notChecked, /J4004 itself .* was not read/);
  });
  it("uses the same stature slope as the UMTRI equation the layout places the seat with", () => {
    assert.equal(REFS.umtriSeatPosition.coefficients.stature, s.coefficients.statureSlope);
  });
  it("Eq. 9 and the US population give the single-gender distributions (offsets from the male mean)", () => {
    near(samSeatPositionSd(71), 42.75, 0.01); near(samSeatPositionSd(64), 40.63, 0.01);
    const d = samDistributions();
    assert.equal(d.male.meanMm, 0); near(d.female.meanMm, -59.754, 1e-6);
  });
  it("the mixture percentiles invert the CDF (Eq. 13)", () => {
    assert.ok(Math.abs(normalCdf(1.6448536) - 0.95) < 1e-6);
    for (const p of [0.025, 0.5, 0.9, 0.95, 0.975]) near(samPercentileOfOffset(samPercentileOffsetMm(p)), p, 1e-9);
    near(samPercentileOffsetMm(0.975), 70.6, 0.1); near(samPercentileOffsetMm(0.95), 55.35, 0.05);
  });
  it("accommodation tracks: the central 95% of US adults needs a ~198 mm track (J4004 convention is a design choice stated here)", () => {
    const t95 = samAccommodationTrack(0.95);
    near(t95.lengthMm, 197.8, 0.1); near(t95.frontOffsetMm, -127.2, 0.1); near(t95.rearOffsetMm, 70.6, 0.1);
    near(samAccommodationTrack(0.9).rearOffsetMm, 55.4, 0.1);
    near(samAccommodationTrack(0.99).lengthMm, 254.0, 0.1);
  });
});

describe("where the layout's front seat sits in the driver population (information only)", () => {
  const p = pkg(build());
  const fsp = p.layoutRevision.inputs.frontSeatPopulation;
  it("the front package is unchanged by this pass; the rear H-point is the rear-knee pass's (3.458 m here before L48 was measured at knee height, 3.235 m after)", () => {
    assert.equal(p.designChoices.rearSgRPX.value, 3.235);
    assert.equal(p.firewallX, 1.4668);
    assert.equal(p.layoutRevision.inputs.sgRPFrontX, 2.6253);
    assert.equal(p.layoutRevision.inputs.frontSeatRearX, 3.1506);
    assert.equal(p.designChoices.torsoDeg.value, 25);
    assert.equal(p.designChoices.h30.value, 0.185);
  });
  it("the seat the rear is derived against is the 95th-percentile male's mean UMTRI position: ~the 94th percentile of the drivers", () => {
    near(fsp.seatOffsetMm, 50.7, 0.05);
    near(fsp.seatPopulationPercentile, 0.939, 0.001);
    // the same number from the model and the UMTRI equation directly: 0.433 x (1870 - 1753) mm
    near(0.433 * (1870 - 1753), 50.66, 0.01);
  });
  it("the design's 240 mm track covers ~96% of drivers; its rear stop is the ~99.9th percentile (the rear is NOT derived against it)", () => {
    assert.equal(fsp.trackLengthMm, 240);
    near(fsp.trackCoverage, 0.962, 0.001); near(fsp.trackRearPercentile, 0.999, 0.001);
    near(fsp.trackOffsetsMm[1], 120.9, 0.1);
  });
  it("no sourced accommodation target moves the cabin forward: each is at or behind the seat the layout already uses", () => {
    // rear x offsets (mm aft of the mean male seat) vs the layout's 50.7 mm; every rear H-point and rear axle shift 1:1 with the seat (translation of the derivation)
    near(fsp.rearOffsetsMm.central90 - fsp.seatOffsetMm, +4.7, 0.1);   // 90% central: 4.7 mm further back
    near(fsp.rearOffsetsMm.central95 - fsp.seatOffsetMm, +19.9, 0.1);  // 95% central: 19.9 mm further back
    near(fsp.rearOffsetsMm.central99 - fsp.seatOffsetMm, +48.8, 0.1);  // 99% central: 48.8 mm further back
    near(fsp.trackOffsetsMm[1] - fsp.seatOffsetMm, +70.2, 0.1);        // the track's rear stop: 70.2 mm further back
    // a forward move needs a LOWER accommodation level than the layout's 93.9th percentile: e.g. the 90th percentile is 13.4 mm forward
    near(samPercentileOffsetMm(0.9) - fsp.seatOffsetMm, -13.4, 0.1);
    assert.ok(samTrackCoverage(-119.1, 120.9) > 0.96);
  });
  it("the UMTRI position function behind the offsets is the one the layout uses", () => {
    near(umtriHPointX(1.87, 0.55, 0.185) - umtriHPointX(1.753, 0.55, 0.185), 0.0507, 1e-4);
  });
});

describe("driver-selected seatback angle (SAE 983163 Table 4): no upright-sport-posture opportunity", () => {
  const s = REFS.driverSelectedSeatback;
  it("the lowest-seat vehicles (H30 189, 197 mm) have design angles 24 and 25 deg, selected 20.6 and 21.8 deg", () => {
    assert.equal(s.vehicles.Avenger.h30Mm, 189); assert.equal(s.vehicles.Avenger.designSeatbackDeg, 24); assert.equal(s.vehicles.Avenger.selectedSeatbackMeanDeg, 20.6);
    assert.equal(s.vehicles.Laser.h30Mm, 197); assert.equal(s.vehicles.Laser.designSeatbackDeg, 25); assert.equal(s.vehicles.Laser.selectedSeatbackMeanDeg, 21.8);
    assert.match(s.source.title, /SAE Technical Paper 983163/);
    assert.match(s.finding, /31 of 37/);
  });
  it("this car's 25 deg design angle at H30 185 mm matches the Laser's design angle (25 deg at H30 197 mm)", () => {
    const p = pkg(build());
    assert.equal(p.designChoices.torsoDeg.value, s.vehicles.Laser.designSeatbackDeg);
    assert.ok(Math.abs(p.designChoices.h30.value * 1000 - s.vehicles.Laser.h30Mm) < 15);
  });
});
