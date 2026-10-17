// Car stance pass 3 (car-design brief item 0): the electric car is a 2+2 (owner, 2026-10-17: a 2+2 rather than
// lowering the rear seating). The rear seats are sized for occasional use by the smallest ADULT in the repo's
// ANSUR II table (F5); that is a design choice, the occupant's dimensions are sourced (Gordon et al. 2014,
// NATICK/TR-15/007). The rear H-point, the rear axle and the cabin then follow from the existing derivation
// (car-layout.js deriveRearPackage): nothing is hand-tuned. The front seats keep F5, F95 and M95.
//
// Measured on 2026-10-17 (stance-2 -> 2+2): rear H-point x 3.486 -> 3.458 m, rear axle 4.309 -> 4.251 m (with the iM-375 motor module the power repair selects).
// The body kernel results (roof peak, overall length, Cd, torsion, clearances) are in the PR description: they need
// a 20-30 minute OCC run, so this file pins the layout derivation and the packaging checks, not the kernel.
// A passing test here is not a physical validation of the car.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { REAR_2PLUS2_OCCUPANTS } from "../lib/conkay/compiler/car-layout.js";
import { ANTHROPOMETRY, occupantDims } from "../lib/conkay/packaging/occupant.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const build = (opts = {}) => buildCarFromLibrary(BRIEF, { config: { fuelType: "electric", motorId: "motor.cascadia.im-375-dz" }, cadBody: false, ...opts });
const pkg = (b) => b.ir.nodes.find((n) => n.id === "VEH").props.vehicle.packaging;
const axle = (b) => parseFloat(b.ir.nodes.find((n) => n.id === "VEH").props.vehicle.rearAxleX);

describe("2+2 rear occupant basis", () => {
  it("is the 5th-percentile female of the ANSUR II table, with the report pages cited", () => {
    assert.deepEqual([...REAR_2PLUS2_OCCUPANTS.keys], ["F5"]);
    const d = ANTHROPOMETRY.dimensions;
    assert.equal(d.stature.mm.F5, 1525); assert.equal(d.stature.reportPage, 193);
    assert.equal(d.buttockKneeLength.mm.F5, 541); assert.equal(d.buttockKneeLength.reportPage, 81);
    assert.equal(d.thighLink.mm.F5, 340); assert.equal(d.thighLink.reportPage, 289);
    assert.equal(occupantDims("F5").stature, 1.525);
    assert.match(ANTHROPOMETRY.source.title, /NATICK\/TR-15\/007/);
    for (const s of ["occasional use", "p.193", "p.81", "p.289", "NATICK/TR-15/007", "no child dimensions"]) assert.ok(REAR_2PLUS2_OCCUPANTS.basis.includes(s), s);
  });
  it("is smaller than the 95th male on every rear-fit dimension (it is not a relabel)", () => {
    for (const k of ["stature", "buttockKneeLength", "thighLink", "calfLink", "sittingHeight", "hipBreadthSitting"]) assert.ok(occupantDims("F5")[k] < occupantDims("M95")[k], k);
  });
  it("the electric car records it in the packaging and the layout revision; the front seats keep their occupants", () => {
    const p = pkg(build());
    assert.deepEqual(p.rearOccupantKeys, ["F5"]);
    assert.equal(p.rearOccupantBasis, REAR_2PLUS2_OCCUPANTS.basis);
    assert.deepEqual(p.occupantKeys, ["F5", "F95", "M95"]);
    const row = p.layoutRevision.changes.find((c) => c.parameter === "rear occupants");
    assert.deepEqual(row.new, ["F5"]);
    assert.match(row.reason, /ANSUR II/);
  });
  it("the front-engine car is unchanged: every checked occupant sits in the rear", () => {
    const p = pkg(buildCarFromLibrary(BRIEF, { cadBody: false }));
    assert.equal(p.rearOccupantKeys, undefined);
  });
});

describe("the cabin follows the occupant through the existing derivation", () => {
  const full = build({ rearSeating: "full" }), two = build();
  it("rearSeating 'full' reproduces the stance-2 layout (rear H-point 3.486 m, rear axle 4.309 m, iM-375)", () => {
    assert.equal(pkg(full).designChoices.rearSgRPX.value, 3.486);
    assert.equal(axle(full), 4.309);
  });
  it("the 2+2 rear H-point moves forward 28 mm and the rear axle 58 mm; the front package does not move", () => {
    assert.equal(pkg(two).designChoices.rearSgRPX.value, 3.458);
    assert.equal(axle(two), 4.251);
    assert.equal(pkg(two).firewallX, pkg(full).firewallX);
    assert.equal(pkg(two).designChoices.ahpX.value, pkg(full).designChoices.ahpX.value);
    assert.match(pkg(two).designChoices.rearSgRPX.basis, /derived/);
  });
  it("the rear H-point is the derivation's value for the F5 knee, not a typed number", () => {
    const m = pkg(two).layoutRevision.inputs;
    assert.deepEqual(m.rearOccupants, ["F5"]);
    assert.ok(m.kneeAheadOfHPointM > 0);
    assert.ok(m.kneeAheadOfHPointM < pkg(full).layoutRevision.inputs.kneeAheadOfHPointM);
  });
});

describe("packaging checks follow the occupant, none are loosened", () => {
  it("only the F5 scenario has rear seats; the rear knee check (J1100 L48, threshold 0) exists for F5 only", async () => {
    const { openDesign } = await import("../lib/conkay/index.js");
    const b = build();
    const s = openDesign(b.ir).session;
    const checks = s.result("package.occupant-fit@VEH").outputs.checks.value;
    const knee = checks.filter((c) => /^rearKnee\./.test(c.id));
    assert.deepEqual(knee.map((c) => c.id).sort(), ["rearKnee.SEAT_3.F5", "rearKnee.SEAT_4.F5"]);
    for (const c of knee) { assert.equal(c.threshold, 0); assert.ok(c.pass, `${c.id} ${c.value}`); }
    assert.ok(!checks.some((c) => /^(entry|headroom|shoulder|hipShell)\.SEAT_[34]\.(M95|F95)$/.test(c.id)));
    assert.ok(checks.some((c) => c.id === "W4.F5") && !checks.some((c) => c.id === "W4.M95"));
    // the rear occupants do not interfere with the differential, motor module or each other (separating-axis gaps)
    const inter = s.result("package.interference@VEH").outputs;
    assert.deepEqual(inter.interferences.value ?? inter.interferences, []);
  });
});
