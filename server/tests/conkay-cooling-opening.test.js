// server/tests/conkay-cooling-opening.test.js
//
// Roadmap 5 item 3. The opening is the sourced core face. The air rise is
// the energy balance at the published fan flow. The conduction solver is
// not given an invented wall.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coolingOpening, AIR_300K } from "../lib/conkay/fluids/cooling-opening.js";
import { LOOP_CHOICES } from "../lib/conkay/fluids/coolant-loop.js";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { openDesign } from "../lib/conkay/index.js";
import { getComponent } from "../lib/conkay/components/index.js";

const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b}`);
const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const FT3 = 0.3048 ** 3;

describe("cooling opening energy balance", () => {
  it("60 ft³/min is one cubic foot per second", () => {
    const r = coolingOpening({
      heatW: 1007 * AIR_300K.rho * FT3, heatBasis: "test",
      fanCfm: 60, fanSource: "test",
      coreWidthIn: 10, coreHeightIn: 10, coreSource: "test",
    });
    near(r.fan.flowM3s, FT3, 1e-12, "flow");
    near(r.riseK, 1, 1e-12, "one kelvin");
    assert.equal(r.conductionUsed, false);
  });
});

describe("cooling opening on the car radiator", () => {
  it("uses the sourced core and the coolant-loop heat fraction", () => {
    const built = buildCarFromLibrary(BRIEF);
    const opened = openDesign(built.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.result("fluid.cooling-opening@RADIATOR");
    assert.ok(env, "solver did not run");
    assert.equal(env.status, "WARN");
    assert.equal(env.margins.length, 0);
    const o = env.outputs.opening.value;
    const rad = getComponent(built.ir.nodes.find((n) => n.id === "RADIATOR").props.component);
    const eng = getComponent(built.ir.nodes.find((n) => n.id === "ENGINE").props.component);
    const area = rad.dimensions.coreWidthIn * 0.0254 * rad.dimensions.coreHeightIn * 0.0254;
    near(o.opening.areaM2, area, 1e-12, "area");
    const heat = eng.ratings.peakPowerW.value * LOOP_CHOICES.heatToCoolantFraction.value;
    near(o.heatW, heat, 1e-12, "heat");
    const flow = rad.ratings.fanAirflowCfm.value * FT3 / 60;
    near(o.fan.flowM3s, flow, 1e-12, "fan");
    near(o.riseK, heat / (AIR_300K.rho * flow * AIR_300K.cp), 1e-12, "rise");
    assert.equal(o.conductionUsed, false);
    assert.match(o.conductionReason, /wall/);
    assert.match(o.heatRejectionNote, /not published/);
    assert.equal(env.outputs.conductionUsed.value, false);
    assert.ok(o.riseK > 30, `rise ${o.riseK} K is the screening, not a pass`);
    assert.ok(env.warnings.some((w) => /conduction solver is not used/i.test(w)));
  });
});
