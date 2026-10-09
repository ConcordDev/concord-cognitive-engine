// tests/conkay-packaging.test.js
//
// Occupant fit and packaging: ANSUR II occupants, SAE J1100 dimensions,
// component envelopes from library dimensions, interference, and the
// acceptance gate failing the car on a fit failure or an interference.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { obb, aabb, separation, ellipsoid, signedDistance, rayToEllipsoid, boxClearanceToShell, widthAt } from "../lib/conkay/packaging/geometry.js";
import { occupantDims, seatOccupant, solveLeg, hPointOffsets, ANTHROPOMETRY, PACKAGING_REFERENCES, PERCENTILES } from "../lib/conkay/packaging/occupant.js";
import { umtriHPointX } from "../lib/conkay/packaging/checks.js";
import { layoutCar, steeringLockDeg, LAYOUT_DESIGN_CHOICES } from "../lib/conkay/compiler/car-layout.js";
import { carAcceptance, buildCarFromLibrary, PACKAGING_OCCUPANTS } from "../lib/conkay/compiler/car-from-library.js";
import { getComponent } from "../lib/conkay/components/index.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const STATES = new Set(["sourced", "geometric", "estimated", "design"]);

describe("Packaging geometry: boxes and the body shell", () => {
  it("separating-axis gaps: apart, overlapping and rotated", () => {
    const a = aabb({ id: "a", min: [0, 0, 0], max: [1, 1, 1] });
    assert.ok(close(separation(a, aabb({ id: "b", min: [1.2, 0, 0], max: [2, 1, 1] })).separation, 0.2));
    assert.ok(close(separation(a, aabb({ id: "c", min: [0.9, 0.5, 0.5], max: [2, 2, 2] })).separation, -0.1), "overlap: minus the smallest penetration");
    const r = obb({ id: "r", center: [2.5, 0, 0.5], half: [0.5, 0.5, 0.5], yawDeg: 45 });
    assert.ok(close(separation(a, r).separation, 2.5 - 0.5 * Math.SQRT2 - 1), "a 45° box's corner");
  });

  it("ellipsoid: signed distance, ray and width; a box's clearance is at a corner", () => {
    const e = ellipsoid({ center: [0, 0, 0], semi: [2, 1, 0.5] });
    assert.ok(close(signedDistance(e, [0, 0, 0.4]), 0.1, 1e-6));
    assert.ok(close(signedDistance(e, [3, 0, 0]), -1, 1e-6));
    assert.ok(close(signedDistance(e, [0, 0, 0]), 0.5, 1e-6));
    assert.ok(close(rayToEllipsoid(e, [0, 0, 0], [0, 0, 1]), 0.5));
    assert.ok(close(widthAt(e, 0, 0), 2));
    const b = aabb({ id: "b", min: [-0.1, -0.1, 0.3], max: [0.1, 0.1, 0.45] });
    assert.ok(boxClearanceToShell(e, b).clearance < signedDistance(e, [0, 0, 0.45]), "a top corner is closer than the top centre");
  });
});

describe("Occupant data: ANSUR II percentiles, cited", () => {
  it("every dimension has F5-M95 in mm, an ANSUR name and a report page; the source is the Natick report", () => {
    assert.match(ANTHROPOMETRY.source.url, /ANSURII-TR15-007\.pdf$/);
    for (const [name, d] of Object.entries(ANTHROPOMETRY.dimensions)) {
      assert.ok(d.ansur && Number.isInteger(d.reportPage), name);
      for (const k of PERCENTILES) assert.ok(Number.isFinite(d.mm[k]) && d.mm[k] > 0, `${name} ${k}`);
    }
    const f5 = occupantDims("F5"), m95 = occupantDims("M95");
    assert.equal(f5.stature, 1.525); assert.equal(m95.stature, 1.87);
    assert.equal(f5.sittingHeight, 0.803); assert.equal(m95.sittingHeight, 0.977);
    assert.equal(m95.buttockKneeLength, 0.669); assert.equal(m95.buttockPoplitealLength, 0.548);
    assert.equal(m95.kneeHeightSitting, 0.602); assert.equal(m95.eyeHeightSitting, 0.86);
    assert.equal(m95.shoulderBreadthBideltoid, 0.567); assert.equal(occupantDims("F95").hipBreadthSitting, 0.456);
    assert.equal(m95.footLength, 0.293);
    assert.throws(() => occupantDims("X50"));
  });

  it("H-point offsets scale the Hybrid III 50th male by sitting height (estimated)", () => {
    const { hOff, hBack } = hPointOffsets(0.8839);
    assert.ok(close(hOff, 3.4 * 0.0254, 1e-4) && close(hBack, 5.4 * 0.0254, 1e-4));
    assert.match(PACKAGING_REFERENCES.hybridIII50.source.url, /humaneticsgroup\.com/);
  });

  it("a two-link leg reaches or doesn't; the knee is above the hip-ankle line", () => {
    const ok = solveLeg([1, 0.34], [0.2, 0.2], 0.458, 0.46);
    assert.equal(ok.reachable, true);
    assert.ok(ok.knee[1] > 0.34 && ok.kneeAngleDeg < 180);
    assert.equal(solveLeg([1, 0.34], [0, 0.2], 0.34, 0.361).reachable, false);
  });

  it("a seated occupant: head top along the torso line at sitting height above the sitting surface", () => {
    const o = seatOccupant("M95", { id: "S", hPoint: { x: 2.6, y: 0, z: 0.34 }, torsoDeg: 25, posture: "front", heel: { x: 1.8, z: 0.12 }, footAngleDeg: 40 });
    const s = 0.977 - o.hOff;
    assert.ok(close(o.landmarks.headTop[0], 2.6 + s * Math.sin(25 * Math.PI / 180)));
    assert.ok(close(o.landmarks.headTop[1], 0.34 + s * Math.cos(25 * Math.PI / 180)));
    assert.deepEqual(o.boxes.map((b) => b.part).sort(), ["foot", "foot", "head", "pelvis", "thigh", "thigh", "torso"]);
  });
});

describe("Seat position and steering lock: published models", () => {
  it("UMTRI H-point: -15.0 + 0.433 S + 0.41 W - 0.24 H (mm aft of the PRP, flat track)", () => {
    assert.ok(close(umtriHPointX(1.87, 0.55, 0.22), (-15 + 0.433 * 1870 + 0.41 * 550 - 0.24 * 220) / 1000, 1e-9));
    assert.match(PACKAGING_REFERENCES.umtriSeatPosition.source.url, /^https:\/\/www\.iihs\.org\//);
  });

  it("steering lock from the S550's published turning circle (estimated, Ackermann)", () => {
    const l = steeringLockDeg(PACKAGING_REFERENCES.referenceVehicle);
    assert.ok(close(l.outerDeg, (Math.asin(107.1 / 219) * 180) / Math.PI, 1e-9));
    assert.ok(l.innerDeg > l.outerDeg && l.innerDeg < 45);
  });
});

describe("Layout: components placed from library dimensions", () => {
  it("engine, TKX, differential, radiator, fuel cell and tyres get envelopes with their dimension source", () => {
    const e = (id) => getComponent(id);
    const lay = layoutCar({
      entries: { engine: e("engine.ford.coyote-gen4x.m-6007-m50h"), gearbox: e("transmission.tremec.tkx.tcet18085"), diff: e("differential.ford.super-8.8-irs.m-4001-88355b"), cooling: e("cooling.coldcase.lmm570-5k"), fuel: e("fuel.atl.saver-cell.sa-aa-070"), tyre: e("tyre.michelin.pilot-sport-4s.245-40zr18-97y-xl") },
      frontAxleX: 1, rearAxleX: 3.7, track: 1.6,
    });
    const c = Object.fromEntries(lay.components.map((x) => [x.id, x]));
    assert.deepEqual(Object.keys(c).sort(), ["DIFFERENTIAL", "ENGINE", "FUEL_CELL", "RADIATOR", "TRANSMISSION"]);
    assert.equal(c.ENGINE.dims.state, "estimated");
    assert.ok(close(c.ENGINE.half[0] * 2, 26 * 0.0254, 1e-4));
    assert.equal(c.TRANSMISSION.dims.state, "sourced");
    assert.ok(close(c.TRANSMISSION.half[0] * 2, (31.23 - 7.21) * 0.0254, 1e-4), "case = overall length minus input shaft");
    assert.ok(close(lay.positions.TRANSMISSION.x - c.TRANSMISSION.half[0], lay.positions.ENGINE.x + c.ENGINE.half[0] + 7.21 * 0.0254, 5e-4), "face one input shaft behind the engine");
    assert.ok(close(lay.positions.DIFFERENTIAL.x, 3.7) && close(lay.positions.DIFFERENTIAL.z, 0.6528 / 2, 1e-4));
    assert.equal(lay.tyres.length, 4);
    for (const [k, v] of Object.entries(LAYOUT_DESIGN_CHOICES)) assert.match(v.basis, /design choice/, k);
  });
});

// The #1039 layout (v1: hand-set rear package, RECARO Pole Position) against the screening ellipsoid, kept as a
// regression of the failures the CAD-body step resolves (tests/conkay-cad-body.test.js covers the revised layout).
describe("Car brief (v1 layout, ellipsoid shell): occupant fit, interference and the acceptance gate", () => {
  const r = carAcceptance(BRIEF, { layout: "v1", cadBody: false, config: { seatHipBreadthM: null } });
  const s = r.session;
  const fit = s.result("package.occupant-fit@VEH");
  const itf = s.result("package.interference@VEH");
  const checks = fit.outputs.checks.value;
  const ck = (id) => checks.find((c) => c.id === id);

  it("both solvers run on the library car, and every check carries value, threshold and the threshold's basis", () => {
    assert.deepEqual(PACKAGING_OCCUPANTS, ["F5", "F95", "M95"]);
    assert.equal(fit.status, "FAIL");
    assert.equal(itf.status, "FAIL");
    assert.ok(checks.length > 80);
    for (const c of checks) {
      assert.ok(Number.isFinite(c.value), c.id);
      assert.ok(STATES.has(c.thresholdBasis.state), c.id);
      if (c.thresholdBasis.state === "sourced") assert.match(c.thresholdBasis.source, /^https?:\/\//, c.id);
      if (c.thresholdBasis.state === "estimated") assert.ok(c.thresholdBasis.method, c.id);
    }
    for (const g of ["headroom", "legroom", "shoulder room", "hip room", "steering", "pedals", "entry", "SAE J1100 Class A"]) assert.ok(checks.some((c) => c.group === g), g);
  });

  it("vehicle dimensions come from the design, each with its source", () => {
    const v = fit.outputs.vehicleDimensions.value;
    assert.ok(close(v.wheelbase.m, 2.7) && close(v.frontTrack.m, 1.6) && close(v.overallLength.m, 4.4));
    for (const d of Object.values(v)) assert.ok(d.source, "every dimension says where it came from");
  });

  it("finds what doesn't fit: rear headroom (95th male), Recaro cushion width (95th male and female), rear knee room (95th male)", () => {
    assert.ok(ck("headroom.SEAT_3.M95").value < 0 && !ck("headroom.SEAT_3.M95").pass);
    assert.ok(ck("headroom.SEAT_1.M95").pass && ck("headroom.SEAT_1.M95").value > 0);
    assert.equal(ck("seatWidth.M95").value, 431); assert.equal(ck("seatWidth.M95").threshold, 385); assert.equal(ck("seatWidth.M95").pass, false);
    assert.equal(ck("seatWidth.F95").pass, false); assert.equal(ck("seatWidth.F5").pass, true);
    assert.equal(ck("rearKnee.SEAT_3.M95").pass, false); assert.equal(ck("rearKnee.SEAT_3.F5").pass, true);
    assert.equal(ck("legReach.SEAT_1.F5").pass, true);
    assert.equal(ck("airbag.F5").threshold, 254); assert.equal(ck("airbag.F5").pass, true);
    assert.equal(ck("classA.H30").pass, true);
  });

  it("J1100 dimensions are computed from the geometry by their definitions", () => {
    const j = fit.outputs.j1100.value;
    assert.equal(j.front.H30.mm, 220);
    assert.ok(j.front.H61.mm > 0 && j.rear.H63.mm > 0 && j.front.W3.mm > 0 && j.rear.W4.mm > 0);
    assert.ok(Number.isFinite(j.front.L53.mm) && Number.isFinite(j.rear.L50.mm) && Number.isFinite(j.steering.L7_M95.mm));
    assert.ok(close(j.front.L34_M95.mm - 254, Math.hypot(...[0, 1].map((i) => fit.outputs.occupants.value.M95[0].hPoint[i] - [1.8, 0.12 + 0.083][i])) * 1000, 0.2));
  });

  it("interference: the rear occupants run into the differential's (upper-bound) envelope; the TKX pairs use its 1/4 in minimum", () => {
    const items = itf.outputs.interferences.value;
    assert.ok(items.length > 0);
    assert.ok(items.some((p) => /SEAT_3:M95:(torso|pelvis)/.test(p.a + p.b) && /DIFFERENTIAL/.test(p.a + p.b)));
    const pairs = s.result("package.interference@VEH");
    const tkx = pairs.outputs.closest.value.concat(items).filter((p) => /TRANSMISSION/.test(p.a + p.b));
    for (const p of tkx) assert.equal(p.minClearanceMm, 6.35);
    assert.ok(itf.outputs.notChecked.value.some((n) => n.item === "STEERING_RACK"));
  });

  it("a fit failure or an interference fails the car; the limiter and tyre still pass and the caveats stay", () => {
    const rep = r.report;
    assert.equal(rep.verdict, "not_physically_credible");
    assert.ok(rep.failures.length > 0);
    assert.ok(rep.failures.every((f) => /^(occupant fit|interference)/.test(f)), "only packaging fails");
    assert.ok(rep.failures.some((f) => /occupant fit \(headroom\)/.test(f)));
    assert.ok(rep.failures.some((f) => /^interference: /.test(f)));
    assert.equal(rep.tyreSpeed.status, "PASS");
    assert.ok(rep.caveats.some((c) => /speed limiter that is a design choice/.test(c)));
    assert.ok(rep.caveats.some((c) => /Packaging is screening level/.test(c)));
    const acc = s.result("vehicle.acceptance@VEH");
    assert.equal(acc.outputs.packaging.value.occupantFit.status, "FAIL");
  });

  it("the checks are live: an edit to a component position reruns them", () => {
    const before = itf.outputs.interferences.value.filter((p) => /FUEL_CELL/.test(p.a + p.b)).length;
    assert.equal(before, 0);
    const e = s.edit([{ node: "FUEL_CELL", path: "position.x", value: 3.7 }]);
    assert.equal(e.ok, true);
    assert.ok(e.rerun.includes("package.interference@VEH"));
    assert.ok(s.result("package.interference@VEH").outputs.interferences.value.some((p) => /FUEL_CELL/.test(p.a + p.b)));
  });

  it("a design choice moves the result: a lower steering wheel hits the 95th male's knees", () => {
    const low = { ...LAYOUT_DESIGN_CHOICES, steeringWheelH17: { value: 0.5, basis: "design choice (test)" } };
    const r2 = carAcceptance(BRIEF, { layoutChoices: low, cadBody: false });
    const k = r2.session.result("package.occupant-fit@VEH").outputs.checks.value.find((c) => c.id === "steeringKnee.M95");
    assert.equal(k.pass, false);
  });

  it("the README has a Packaging section and the package a packaging.json", () => {
    const files = s.realizationPackage().files;
    assert.match(files["README.md"], /## Packaging \(occupant fit and interference\)/);
    assert.match(files["README.md"], /FAIL headroom\.SEAT_3\.M95/);
    assert.ok(files["engineering/packaging.json"]);
  });

  it("without a layout the car is not silently passed on packaging", () => {
    const b = buildCarFromLibrary(BRIEF, { packaging: false });
    assert.equal(b.ir.nodes.find((n) => n.id === "VEH").props.vehicle.packaging, undefined);
    const rep = carAcceptance(BRIEF, { packaging: false }).report;
    assert.ok(rep.caveats.some((c) => /Occupant fit and packaging are not checked/.test(c)));
  });
});
