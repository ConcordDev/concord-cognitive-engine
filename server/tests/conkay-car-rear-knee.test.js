// Rear knee room measured against the front seatback where the rear knee is (2026-10-17), not against its rearmost point.
//
// SAE J1100 6.2.27 L48 (text read, archive.org/download/gov.law.sae.j1100.2001): "The minimum dimension within a lateral
// space 127 mm either side of the occupant centerline, measured from the Knee Pivot Center to the back of the front
// seatback, minus 51 mm (2 in)." The standard names no height; the Knee Pivot Center is the rear occupant's knee, so the
// interference is with the seatback's rear face at THAT height (an interpretation, stated in references.json). The
// reclined bucket back's rearmost point is its top, ~0.3 m above the knee and much further aft.
// The required clearance is unchanged: 0 mm after the 51 mm allowance, plus the layout's 25 mm design margin.
// A passing test here is not a physical validation of the car.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { openDesign } from "../lib/conkay/index.js";
import { PACKAGING_REFERENCES as REFS, seatOccupant, rearLowerLegBoxes } from "../lib/conkay/packaging/occupant.js";
import { sgrpFrontSeats, rearKneeL48, rearLegsToFrontSeats, L48_LATERAL_BAND_M } from "../lib/conkay/packaging/checks.js";
import { separation } from "../lib/conkay/packaging/geometry.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const b = buildCarFromLibrary(BRIEF, { config: { fuelType: "electric", motorId: "motor.cascadia.im-375-dz" }, cadBody: false });
const pkg = b.ir.nodes.find((n) => n.id === "VEH").props.vehicle.packaging;
const dc = Object.fromEntries(Object.entries(pkg.designChoices).map(([k, v]) => [k, v.value]));
const seatDims = pkg.seatFront.dims;
const inputs = pkg.layoutRevision.inputs;
const hz = dc.floorZ + dc.h30;
const seats = sgrpFrontSeats(seatDims, { x: inputs.sgRPFrontX, hz, torsoDeg: dc.torsoDeg, floorZ: dc.floorZ, backT: dc.frontSeatBackThicknessM, frontSeatY: dc.frontSeatY });
const rearOcc = (x, side = -1) => seatOccupant("F5", { id: side < 0 ? "SEAT_3" : "SEAT_4", hPoint: { x, y: side * dc.rearSeatY, z: dc.floorZ + dc.rearH31 }, torsoDeg: dc.rearTorsoDeg, posture: "rear", floorZ: dc.floorZ });
const L48 = REFS.saeJ1100.definitions.L48.subtractMm / 1000;
const H = dc.rearSgRPX;

describe("the reference: SAE J1100 6.2.27 L48", () => {
  it("quotes the standard's text (read from the public.resource.org posting) and states the interpretation", () => {
    const l = REFS.saeJ1100.definitions.L48;
    assert.equal(l.section, "6.2.27");
    assert.match(l.text, /Knee Pivot Center to the back of the front seatback, minus 51 mm/);
    assert.equal(l.subtractMm, 51);
    assert.match(l.interpretation, /interpretation/i);
    assert.match(l.interpretation, /knee pivot'?s? height|height of the knee pivot/i);
    assert.equal(L48_LATERAL_BAND_M, 0.127);
  });
});

describe("the seatback's rear face at a height", () => {
  const sb = seats[0];
  it("is a line reclined at the torso angle: further aft with height, and the top is the old 'rearmost point'", () => {
    const lo = sb.rearXAt(0.3), hi = sb.rearXAt(0.8);
    near(hi - lo, 0.5 * Math.tan((dc.torsoDeg * Math.PI) / 180), 1e-9);
    assert.ok(sb.rearXAt(0.415) < sb.rearX - 0.25, "at the rear knee's height the face is >0.25 m ahead of the seat's rearmost point");
  });
  it("matches the seat box's own geometry (a point on the back box's rear face)", () => {
    const back = sb.boxes.find((x) => /:back$/.test(x.id));
    // the rear face midpoint: centre + half-thickness along the rearward normal
    const n = [Math.cos((dc.torsoDeg * Math.PI) / 180), 0, -Math.sin((dc.torsoDeg * Math.PI) / 180)];
    const mid = [back.center[0] + n[0] * back.half[0], back.center[2] + n[2] * back.half[0]];
    near(sb.rearXAt(mid[1]), mid[0], 1e-9);
  });
  it("clamps to the back's extent (below the cushion top, above the published maximum height)", () => {
    assert.equal(sb.rearXAt(0), sb.rearXAt(sb.cushionTopZ));
    near(sb.rearXAt(9), sb.rearX - dc.frontSeatBackThicknessM * Math.cos((dc.torsoDeg * Math.PI) / 180) + dc.frontSeatBackThicknessM / Math.cos((dc.torsoDeg * Math.PI) / 180), 1e-9);
    assert.equal(sb.rearXAt(9), sb.rearXAt(dc.floorZ + seatDims.maxHeightM));
  });
});

describe("(a) the derived layout passes the new checks, every rear occupant and both rear seats", () => {
  const s = openDesign(b.ir).session;
  const checks = s.result("package.occupant-fit@VEH").outputs.checks.value;
  it("rearKnee and rearFoot exist for both rear seats and pass", () => {
    for (const id of ["rearKnee.SEAT_3.F5", "rearKnee.SEAT_4.F5", "rearFoot.SEAT_3.F5", "rearFoot.SEAT_4.F5"]) {
      const c = checks.find((x) => x.id === id);
      assert.ok(c, id); assert.ok(c.pass, `${id} ${c.value}`);
    }
    assert.deepEqual(checks.filter((c) => /^rear(Knee|Foot)\./.test(c.id) && !c.pass), []);
  });
  it("the knee value is the design margin (25 mm) at the rear H-point the derivation chose, within its 1 mm rounding", () => {
    for (const side of [-1, 1]) {
      const v = rearKneeL48(rearOcc(H, side), seats, L48) * 1000;
      assert.ok(v >= dc.rearKneeMarginM * 1000 - 1e-6 && v < dc.rearKneeMarginM * 1000 + 1.5, `${v}`);
    }
    assert.equal(inputs.rearSgRPGovernor, "knee (L48 at knee height)");
    assert.ok(inputs.kneeSgRPX <= H && H - inputs.kneeSgRPX < 0.001 + 1e-9);
  });
  it("the knee height used is the rear occupant's knee pivot (F5 calf link above the ankle), measured, not typed", () => {
    const o = rearOcc(H);
    near(o.landmarks.knee[1] - dc.floorZ, o.dims.lateralMalleolusHeight + o.dims.calfLink, 1e-9);
    assert.equal(inputs.kneeGoverning.occupant, "F5");
    near(inputs.kneeGoverning.kneeHeightAboveFloorM, o.dims.lateralMalleolusHeight + o.dims.calfLink, 1e-4);
  });
  it("the rear H-point is ahead of the old top-of-seatback value (3.458 m)", () => {
    assert.ok(H < 3.458);
    const old = inputs.frontSeatRearX + L48 + dc.rearKneeMarginM + inputs.kneeAheadOfHPointM; // the earlier reference, to the seat's rearmost point
    near(old, 3.458, 0.0015); // (inputs are rounded to 0.1 mm; the layout rounded the exact value up to 1 mm)
    assert.ok(old - H > 0.2, "the saving is the seatback top's lean over the knee-height face");
  });
});

describe("(b) the check bites: a rear seat pushed forward puts the knee into the real seatback", () => {
  it("L48 falls 1:1 with the rear H-point and turns negative", () => {
    const at = (x) => rearKneeL48(rearOcc(x), seats, L48);
    near(at(H) - at(H - 0.05), 0.05, 1e-9);
    assert.ok(at(H) > 0);
    assert.ok(at(H - dc.rearKneeMarginM - 0.001) < 0, "1 mm past the design margin the knee is inside the seatback");
    assert.ok(at(H - 0.1) < -0.07);
  });
  it("the package check fails when the layout's rear H-point is pushed forward", () => {
    const moved = JSON.parse(JSON.stringify(b.ir));
    const veh = moved.nodes.find((n) => n.id === "VEH");
    veh.props.vehicle.packaging.designChoices.rearSgRPX.value = H - 0.06;
    const checks = openDesign(moved).session.result("package.occupant-fit@VEH").outputs.checks.value;
    const knee = checks.filter((c) => /^rearKnee\./.test(c.id));
    assert.equal(knee.length, 2);
    for (const c of knee) { assert.equal(c.pass, false, c.id); assert.equal(c.threshold, 0); assert.ok(c.value < 0); }
  });
  it("no front seatback in the 127 mm lateral band means no L48 constraint (not a pass by default of a wrong seat)", () => {
    const far = seats.map((st) => ({ ...st, y: st.y + 2 }));
    assert.equal(rearKneeL48(rearOcc(H), far, L48), null);
  });
});

describe("(c) the feet and shin hit the front seat's base and lower back when the rear seat is too far forward", () => {
  it("clear at the derived rear H-point, intersecting just ahead of the foot limit", () => {
    for (const side of [-1, 1]) assert.ok(rearLegsToFrontSeats(rearOcc(H, side), seats, dc.floorZ) >= 0);
    assert.ok(inputs.footSgRPX < H);
    assert.ok(rearLegsToFrontSeats(rearOcc(inputs.footSgRPX + 0.0005), seats, dc.floorZ) >= 0);
    assert.ok(rearLegsToFrontSeats(rearOcc(inputs.footSgRPX - 0.002), seats, dc.floorZ) < 0);
    assert.ok(rearLegsToFrontSeats(rearOcc(H - 0.1), seats, dc.floorZ) < -0.05);
  });
  it("further forward the toes hit the seat cushion (the base), and at the limit the shin meets the seatback's lower rear face", () => {
    const sep = (x, part, boxId) => {
      const o = rearOcc(x);
      return Math.min(...rearLowerLegBoxes(o, dc.floorZ).filter((q) => q.part === part).flatMap((f) => seats.flatMap((st) => st.boxes.filter((sb) => boxId.test(sb.id)).map((sb) => separation(f, sb).separation))));
    };
    assert.ok(sep(inputs.footSgRPX - 0.002, "shin", /:back$/) < 0, "at the limit it is the shin against the back");
    assert.ok(sep(inputs.footSgRPX - 0.1, "foot", /:cushion$/) < 0, "pushed 100 mm further the toes are inside the cushion box (the base, solid to the floor)");
    assert.ok(sep(H, "foot", /:cushion$/) > 0.05 && sep(H, "shin", /:back$/) > 0);
  });
  it("the package check fails on the feet when the rear H-point is pushed forward (and the rear leg boxes are not body envelopes)", () => {
    const moved = JSON.parse(JSON.stringify(b.ir));
    moved.nodes.find((n) => n.id === "VEH").props.vehicle.packaging.designChoices.rearSgRPX.value = H - 0.06;
    const checks = openDesign(moved).session.result("package.occupant-fit@VEH").outputs.checks.value;
    const foot = checks.filter((c) => /^rearFoot\./.test(c.id));
    assert.equal(foot.length, 2);
    for (const c of foot) { assert.equal(c.pass, false, c.id); assert.equal(c.threshold, 0); }
    const o = rearOcc(H);
    assert.ok(!o.boxes.some((q) => q.part === "shin" || q.part === "foot"), "the shin/foot boxes are for the clearance check only");
  });
});

describe("(d) no clearance requirement changed", () => {
  it("the L48 allowance is 51 mm, the design margin 25 mm, the check threshold 0 mm", () => {
    assert.equal(REFS.saeJ1100.definitions.L48.subtractMm, 51);
    assert.equal(dc.rearKneeMarginM, 0.025);
    const s = openDesign(b.ir).session;
    const checks = s.result("package.occupant-fit@VEH").outputs.checks.value;
    for (const c of checks.filter((x) => /^rear(Knee|Foot)\./.test(x.id))) { assert.equal(c.threshold, 0); assert.equal(c.comparator, ">="); }
  });
  it("a car seating every checked occupant in the rear keeps the earlier reference (its layout is unchanged)", () => {
    const full = buildCarFromLibrary(BRIEF, { config: { fuelType: "electric", motorId: "motor.cascadia.im-375-dz" }, rearSeating: "full", cadBody: false });
    const p = full.ir.nodes.find((n) => n.id === "VEH").props.vehicle.packaging;
    assert.equal(p.designChoices.rearSgRPX.value, 3.486);
    assert.match(p.layoutRevision.inputs.rearSgRPGovernor, /seatback top/);
    // and its layout still passes the knee-height L48 and the foot check (those are the less strict readings)
    const checks = openDesign(full.ir).session.result("package.occupant-fit@VEH").outputs.checks.value;
    assert.deepEqual(checks.filter((c) => /^rear(Knee|Foot)\./.test(c.id) && !c.pass), []);
  });
});

function near(a, b2, tol, msg) { assert.ok(Math.abs(a - b2) <= tol, `${msg || ""} ${a} vs ${b2} (tol ${tol})`); }
