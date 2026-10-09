// tests/conkay-diff-envelope.test.js
//
// The differential housing's dimensions are not published: the library brackets
// them (package box above, the enclosed 8.8 in ring gear below), and the
// ride-height layout is re-derived at both bounds.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCarFromLibrary, differentialEnvelope } from "../lib/conkay/compiler/car-from-library.js";
import { getComponent } from "../lib/conkay/components/index.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";

describe("differential envelope bounds and the ride-height layout at each", () => {
  const veh = () => buildCarFromLibrary(BRIEF, { cadBody: false }).ir.nodes.find((n) => n.id === "VEH").props.vehicle;
  const rev = veh().packaging.layoutRevision;

  it("the differential housing's size is bracketed: package (upper) and enclosed 8.8 in ring gear (lower)", () => {
    const e = getComponent("differential.ford.super-8.8-irs.m-4001-88355b");
    assert.equal(e.dimensions.state, "estimated");
    assert.equal(e.dimensions.bounds.heightM.low, 8.8 * 0.0254);
    assert.equal(e.dimensions.bounds.heightM.high, e.dimensions.heightM);
    assert.equal(e.dimensions.bounds.widthM.low, null);
    const lo = differentialEnvelope(e, "ringGearHeight").dimensions;
    assert.deepEqual([lo.lengthM, lo.widthM, lo.heightM], [0.22352, 0.5334, 0.22352]);
    assert.equal(differentialEnvelope(e, "package"), e);
    assert.throws(() => differentialEnvelope(e, "guess"), /unknown diffEnvelope/);
  });

  it("ride-height sensitivity: the package needs a 45 mm rise (4.82 deg halfshafts); the ring-gear bound needs none", () => {
    const [pkg, ring] = rev.groundClearance.diffEnvelopeSensitivity.rows;
    const tyreR = 0.3264;
    assert.deepEqual([pkg.envelope, ring.envelope], ["package", "ringGearHeight"]);
    assert.equal(pkg.bottomZBeforeRiseM, Math.round((tyreR - 0.4318 / 2) * 1e4) / 1e4);   // 0.1105 < 0.155 required
    assert.equal(pkg.diffRiseM, 0.045);
    assert.equal(pkg.halfshaftAngleDeg, 4.82);
    assert.equal(ring.bottomZBeforeRiseM, Math.round((tyreR - 0.22352 / 2) * 1e4) / 1e4); // 0.2146 > 0.155: not binding
    assert.equal(ring.diffRiseM, 0);
    assert.equal(ring.halfshaftAngleDeg, 0);
    assert.equal(ring.binding, false);
    assert.equal(rev.groundClearance.diffEnvelope, "package");
  });

  it("the layout re-derived at the ring-gear bound: no rise, and the rear axle comes forward", () => {
    const lo = buildCarFromLibrary(BRIEF, { cadBody: false, diffEnvelope: "ringGearHeight" }).ir.nodes.find((n) => n.id === "VEH").props.vehicle;
    const hi = veh();
    assert.equal(lo.packaging.designChoices.diffRiseM.value, 0);
    assert.equal(hi.packaging.designChoices.diffRiseM.value, 0.045);
    assert.equal(parseFloat(hi.rearAxleX), 3.966);
    assert.equal(parseFloat(lo.rearAxleX), 3.843);
    assert.equal(lo.packaging.layoutRevision.groundClearance.diffEnvelope, "ringGearHeight");
  });
});
