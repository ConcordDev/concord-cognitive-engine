// server/tests/conkay-hardpoints.test.js
//
// Roadmap 5 item 4. The hardpoints are the tub's axle-line nodes. The S550
// arms are not given coordinates the library does not publish.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { openDesign } from "../lib/conkay/index.js";
import { TUB_DESIGN_CHOICES } from "../lib/conkay/structural/car-tub.js";

const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= Math.max(1e-9, rel * Math.abs(b)), `${msg}: ${a} vs ${b}`);
const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";

describe("suspension hardpoints on the tub", () => {
  it("names the four axle-line nodes and the members that meet them", () => {
    const opened = openDesign(buildCarFromLibrary(BRIEF).ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.result("structure.hardpoints@CHASSIS");
    assert.ok(env, "solver did not run");
    assert.equal(env.status, "WARN");
    assert.equal(env.margins.length, 0);
    assert.equal(env.outputs.armsLocated.value, false);
    const rows = env.outputs.hardpoints.value.hardpoints;
    assert.deepEqual(rows.map((r) => r.id), ["FA.L", "FA.R", "QA.L", "QA.R"]);
    const y = TUB_DESIGN_CHOICES.frontRailY.value;
    const fl = rows[0];
    near(fl.y, y, 1e-9, "front left y");
    near(fl.x, opened.session.graph.get("VEH", "props.vehicle.frontAxleX"), 1e-9, "front x");
    const members = fl.path.map((p) => p.member).sort();
    assert.deepEqual(members, ["rail-fL1", "rail-fL2"]);
    assert.ok(fl.path.some((p) => p.other === "FWR.L"), "path reaches the firewall node");
    const rl = rows[2];
    assert.ok(rl.path.some((p) => p.member.startsWith("qtr-")), "rear path is the quarter box");
    const ax = opened.session.result("vehicle.axle-loads@VEH");
    assert.equal(ax.status, "NOT_COMPUTED");
    assert.match(ax.reason, /BODY_SHELL/);
    assert.equal(fl.staticLoadN, null);
    assert.equal(rl.staticLoadN, null);
    assert.equal(env.outputs.hardpoints.value.armsLocated, false);
    assert.ok(env.warnings.some((w) => /no hardpoint dimensions/.test(w)));
    assert.ok(env.warnings.some((w) => /Axle loads were not available/.test(w)));
  });
});
