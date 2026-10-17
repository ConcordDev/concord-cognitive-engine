// Car stance pass (car-design brief item 0): sourced 20 in wheels on the electric car, near-flush fenders, and the
// tub's front rails and rear quarter boxes derived from the wheel wells (they were fixed |y| measured on the 18 in
// body: the larger tyre's wells reached into them and the body kernel thrashed for 30 min trying to cover them).
//  [TS]  tiresize.com, Michelin Pilot Sport 4S 275/35R20: "275/35ZR20 | 102Y XL BSW | … | 27.6" | 10.9" | 9-11" |
//        … | 1874 lbs | 50 psi | 186 mph | 28 lbs".
//  [APX] apexwheels.com, VS-5RS 20x10" ET32 5x114.3 / 66.1: "OFFSET 32mm", "LOAD RATING 1,600 lbs", "WEIGHT 20.7 lbs".
// Passing these tests is not a fitment trial or a road test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCarFromLibrary, vehicleConfiguration } from "../lib/conkay/compiler/car-from-library.js";
import { tubLandmarks, wellLandmarks, TUB_DESIGN_CHOICES, ELECTRIC_TUB_WALLS } from "../lib/conkay/structural/car-tub.js";
import { getComponent, selectComponent } from "../lib/conkay/components/index.js";
import { ELECTRIC_BODY_CHOICES } from "../lib/conkay/cad/body-params.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const build = (fuel) => buildCarFromLibrary(BRIEF, { config: fuel ? { fuelType: fuel } : {} });
const y = (b, id) => parseFloat(b.ir.nodes.find((n) => n.id === id).position.y);

describe("sourced 20 in set", () => {
  it("[TS] the 275/35ZR20 tyre's numbers are the listing's, converted to SI", () => {
    const t = getComponent("tyre.michelin.pilot-sport-4s.275-35zr20-102y-xl");
    assert.equal(t.dimensions.overallDiameterM, 0.70104); // 27.6 in
    assert.equal(t.dimensions.sectionWidthM, 0.27686); // 10.9 in
    assert.deepEqual(t.dimensions.rimWidthRangeIn, [9, 11]);
    assert.equal(t.ratings.loadIndex, 102);
    assert.ok(Math.abs(t.ratings.maxLoadKg - 1874 * 0.45359237) < 0.1);
    assert.ok(Math.abs(t.mass.kg - 28 * 0.45359237) < 1e-3);
    assert.equal(t.applicability.establishedMaxSpeedKmh, 300);
    assert.match(t.dimensions.source.title, /1874 lbs \| 50 psi \| 186 mph \| 28 lbs/);
  });
  it("[APX] the VS-5RS wheel's numbers are the manufacturer's", () => {
    const w = getComponent("wheel.apex.vs-5rs.20x10-et32-5x114.3-66.1");
    assert.deepEqual([w.dimensions.diameterIn, w.dimensions.widthIn, w.dimensions.insetMm, w.dimensions.boltPattern], [20, 10, 32, "5x114.3"]);
    assert.ok(Math.abs(w.mass.kg - 20.7 * 0.45359237) < 1e-3);
    assert.match(w.mass.massState.source.title, /WEIGHT 20\.7 lbs/);
  });
  it("the electric car chooses 20 in (a labelled design choice); the front-engine car keeps 18 in", () => {
    const ev = vehicleConfiguration({ requirements: [] }, { fuelType: "electric" });
    assert.equal(ev.config.wheelDiameterIn, 20);
    assert.match(ev.sources.wheelDiameterIn, /design choice \(20 in wheels/);
    assert.equal(vehicleConfiguration({ requirements: [] }, {}).config.wheelDiameterIn, 18);
    const tyres = selectComponent("tyres", { ...ev.config, wheelWidthIn: 10 });
    assert.equal(tyres.chosen.id, "tyre.michelin.pilot-sport-4s.275-35zr20-102y-xl");
  });
  it("the electric body's fender cover is 5 mm, with its basis", () => {
    assert.equal(ELECTRIC_BODY_CHOICES.fenderCoverM.value, 0.005);
    assert.match(ELECTRIC_BODY_CHOICES.fenderCoverM.basis, /15 mm over maxWidth/);
  });
});

describe("tub members follow the wheel wells", () => {
  const fe = build(null), ev = build("electric");
  it("the well walls are the kernel's: |y| - (r sin θ + w/2 cos θ) - archClearance (front), |y| - w/2 - archClearance (rear)", () => {
    const L = tubLandmarks(ev.ir);
    const th = (39.8 * Math.PI) / 180, r = 0.70104 / 2, hw = 0.27686 / 2;
    assert.ok(Math.abs(L.frontWellInnerY - (0.8 - (r * Math.sin(th) + hw * Math.cos(th)) - 0.04)) < 1e-4, `${L.frontWellInnerY}`);
    assert.ok(Math.abs(L.rearWellInnerY - (0.8 - hw - 0.04)) < 1e-4, `${L.rearWellInnerY}`);
    assert.deepEqual(wellLandmarks({ nodes: [] }, { tyres: [] }), {});
  });
  it("front-engine (18 in): unchanged at the chosen |y| 0.41 and 0.585", () => {
    assert.equal(Math.abs(y(fe, "TUB_RAIL_FL")), TUB_DESIGN_CHOICES.frontRailY.value);
    assert.equal(Math.abs(y(fe, "TUB_QTR_L")), TUB_DESIGN_CHOICES.quarterY.value);
  });
  it("electric (20 in): rails to |y| 0.38 and quarter boxes to 0.57, each ≥ wellGapM inside its well wall", () => {
    const L = tubLandmarks(ev.ir);
    assert.equal(Math.abs(y(ev, "TUB_RAIL_FL")), 0.38);
    assert.equal(Math.abs(y(ev, "TUB_QTR_L")), 0.57);
    assert.ok(L.frontWellInnerY - (0.38 + 0.035) >= TUB_DESIGN_CHOICES.wellGapM.value - 1e-9);
    assert.ok(L.rearWellInnerY - (0.57 + 0.04) >= TUB_DESIGN_CHOICES.wellGapM.value - 1e-9);
  });
  it("electric: the rail and kick walls carry the stance's torsion repair (5 mm, 9 mm) with the measured basis", () => {
    assert.equal(ELECTRIC_TUB_WALLS.rail.value, 0.005);
    assert.equal(ELECTRIC_TUB_WALLS.kick.value, 0.009);
    assert.match(ev.ir.nodes.find((n) => n.id === "TUB_RAIL_FL").geometry.wall, /^0\.005/);
    assert.match(fe.ir.nodes.find((n) => n.id === "TUB_RAIL_FL").geometry.wall, /^0\.003/);
  });
});
