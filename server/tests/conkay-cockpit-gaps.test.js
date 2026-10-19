// Cockpit gaps: priced common materials, robotics screening checks,
// mass.cg vs mass.budget honesty, and the design-brief compiler.
// Does not boot server.js.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDesign } from "../lib/conkay/index.js";
import { getMaterial } from "../lib/conkay/materials/index.js";
import { limbHoldingTorque, walkBalance, G } from "../lib/conkay/physics/solvers/robotics.js";
import { compileDesignBrief } from "../lib/conkay/compiler/design-brief.js";
import { createCslToolGate, MACRO_DISPATCH_TOOLS } from "../lib/csl-router.js";
import { CHAT_RESPOND_TOOLS } from "../lib/chat-tool-surface.js";
import { executeToolCall } from "../lib/chat-agent.js";
import { conkayCompileBriefMcp } from "../lib/mcp-execution-bridge.js";
import { HERMES_USER_ID, BRIDGE_RISK, authorizeBridgeCall } from "../lib/mcp-hermes-identity.js";

const PLATE = (id, material, extra = {}) => ({
  id,
  kind: "Plate",
  material,
  geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" },
  ...extra,
});

function plateDesign(material) {
  return openDesign({
    design: { id: "plate" },
    nodes: [PLATE("P1", material)],
    edges: [],
    loadCases: [],
    requirements: [],
  });
}

describe("common materials have a screening price", () => {
  it("keeps fasteners unpriced", () => {
    assert.equal(getMaterial("astm-a325").costPerKgUsd, null);
  });

  it("prices 5052, 7075 and ABS and computes cost.part", () => {
    assert.equal(getMaterial("aluminum-5052-h32").costPerKgUsd, 3.2);
    assert.match(getMaterial("aluminum-5052-h32").costSource, /[Ss]creening/);
    assert.equal(getMaterial("aluminum-7075-t6").costPerKgUsd, 6.5);
    assert.equal(getMaterial("abs-plastic").costPerKgUsd, 2.0);

    for (const name of ["aluminum-5052", "aluminum-7075-t6", "abs"]) {
      const opened = plateDesign(name);
      assert.equal(opened.ok, true, opened.errors?.join("; "));
      const cost = opened.session.result("cost.part@P1");
      assert.equal(cost.status, "PASS", `${name}: ${cost.status} ${cost.reason || ""}`);
      assert.ok(cost.outputs.cost.value > 0, name);
      assert.match(String(cost.inputs.price.source), /screening|indicative|library/i);
    }

    const priced = plateDesign("aluminum-5052");
    const mass = priced.session.result("mass.part@P1").outputs.mass.value;
    const cost = priced.session.result("cost.part@P1").outputs.cost.value;
    assert.ok(Math.abs(cost - mass * 3.2) < 1e-9);
  });
});

describe("stated mass wins, and CG says when it disagrees with the budget", () => {
  it("flags a stated mass that disagrees with geometry and still uses the stated mass", () => {
    const opened = openDesign({
      design: { id: "heavy" },
      nodes: [{
        id: "P1",
        kind: "Plate",
        material: "steel-a36",
        geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" },
        props: { mass: "20 kg", massSource: "weighed on a scale" },
      }],
      edges: [],
      loadCases: [],
      requirements: [],
    });
    assert.equal(opened.ok, true, opened.errors?.join("; "));
    const env = opened.session.result("mass.part@P1");
    assert.equal(env.outputs.mass.value, 20);
    assert.ok(env.outputs.geometryMass.value > 0);
    assert.notEqual(env.outputs.geometryMass.value, 20);
    assert.equal(env.status, "WARN");
    assert.ok(env.warnings.some((w) => /mass inconsistency: stated 20 kg/.test(w)));
  });

  it("CG uses stated masses and warns when the budget excludes the unstated ones", () => {
    const opened = openDesign({
      design: { id: "split" },
      nodes: [
        { id: "A", kind: "Assembly", props: { massBudget: true } },
        {
          id: "S",
          kind: "Part",
          position: { x: 0, y: 0, z: 0 },
          props: {
            mass: 10,
            massState: { state: "sourced", source: { url: "https://example.com/scale" }, variant: "scale-1" },
          },
        },
        {
          id: "U",
          kind: "Part",
          position: { x: "1 m", y: 0, z: 0 },
          props: { mass: "5 kg", massSource: "guess, not a mass state" },
        },
        { id: "ACT", kind: "Actuator", props: { logical: true } },
      ],
      edges: ["S", "U", "ACT"].map((to) => ({ type: "CONTAINS", from: "A", to })),
      loadCases: [],
      requirements: [],
    });
    assert.equal(opened.ok, true, opened.errors?.join("; "));
    const cg = opened.session.result("mass.cg@A");
    assert.notEqual(cg.status, "NOT_COMPUTED", cg.reason);
    assert.equal(cg.outputs.mass.value, 15);
    assert.ok(cg.warnings.some((w) => /mass\.cg 15 kg/.test(w) && /mass\.budget known mass is 10 kg/.test(w)));
    const budget = opened.session.result("mass.budget@A");
    assert.equal(budget.outputs.knownMass.value, 10);
  });
});

describe("robotics limb torque and walk balance", () => {
  it("holding torque is m·g·L·sin(θ) with the COM fraction", () => {
    const t = limbHoldingTorque({ massKg: 2, lengthM: 0.4, comFraction: 1, angleFromVerticalRad: Math.PI / 2 });
    assert.ok(Math.abs(t.torqueNm - 2 * G * 0.4) < 1e-9);
  });

  it("walk margin is footWidth/2 − stanceWidth/2", () => {
    const fail = walkBalance({ massKg: 60, stanceWidthM: 0.2, footWidthM: 0.08 });
    assert.ok(Math.abs(fail.singleSupportMarginM - (0.04 - 0.1)) < 1e-12);
    const pass = walkBalance({ massKg: 60, stanceWidthM: 0.06, footWidthM: 0.1 });
    assert.ok(Math.abs(pass.singleSupportMarginM - (0.05 - 0.03)) < 1e-12);
  });

  it("the limb-torque solver fails closed without a length and checks a rated actuator", () => {
    const opened = openDesign({
      design: { id: "arm" },
      nodes: [
        { id: "A", kind: "Assembly" },
        {
          id: "L",
          kind: "Limb",
          props: {
            limb: {
              length: "0.4 m",
              massKg: "2 kg",
              comFraction: 1,
              angleFromVertical: `${Math.PI / 2} rad`,
              ratedTorqueNm: "20 Nm",
            },
          },
        },
      ],
      edges: [{ type: "CONTAINS", from: "A", to: "L" }],
      loadCases: [],
      requirements: [],
    });
    assert.equal(opened.ok, true, opened.errors?.join("; "));
    const env = opened.session.result("robotics.limb-torque@L");
    assert.equal(env.status, "PASS", env.reason || env.failures);
    assert.ok(Math.abs(env.outputs.holdingTorque.value - 2 * G * 0.4) < 1e-6);
    assert.equal(env.solver.screening, true);

    const missing = openDesign({
      design: { id: "nolength" },
      nodes: [{ id: "L", kind: "Limb", props: { limb: { massKg: "2 kg" } } }],
      edges: [],
      loadCases: [],
      requirements: [],
    });
    assert.equal(missing.ok, true, missing.errors?.join("; "));
    const gap = missing.session.result("robotics.limb-torque@L");
    assert.equal(gap.status, "NOT_COMPUTED");
    assert.match(gap.reason, /length/);
  });

  it("a narrow foot fails single support; a wide foot passes", () => {
    const run = (stance, foot) => openDesign({
      design: { id: "walk" },
      nodes: [{
        id: "R",
        kind: "Assembly",
        props: {
          walk: {
            massKg: "60 kg",
            stanceWidth: stance,
            footWidth: foot,
            ratedAnkleTorqueNm: "1000 Nm",
          },
        },
      }],
      edges: [],
      loadCases: [],
      requirements: [],
    });
    const narrow = run("0.2 m", "0.08 m");
    const bad = narrow.session.result("robotics.walk-balance@R");
    assert.equal(bad.status, "FAIL");
    assert.ok(Math.abs(bad.outputs.singleSupportMargin.value - -0.06) < 1e-9);
    assert.ok(bad.failures[0].includes("0.060 m"));
    const wide = run("0.06 m", "0.1 m");
    const good = wide.session.result("robotics.walk-balance@R");
    assert.equal(good.status, "PASS", good.reason || JSON.stringify(good.failures));
    assert.ok(Math.abs(good.outputs.singleSupportMargin.value - 0.02) < 1e-9);
  });
});

describe("compileDesignBrief", () => {
  it("refuses a robot brief that omits mass or length", () => {
    const r = compileDesignBrief("biped robot, thigh 0.4 m");
    assert.equal(r.ok, false);
    assert.match(r.error, /mass/);
  });

  it("does not invent stance or foot width, and a car brief still delegates", () => {
    const robot = compileDesignBrief("biped robot 60 kg, thigh 0.4 m");
    assert.equal(robot.ok, true);
    assert.equal(robot.ir.nodes.find((n) => n.id === "ROBOT").props.walk.stanceWidth, undefined);
    assert.equal(robot.ir.nodes.find((n) => n.id === "ROBOT").props.walk.footWidth, undefined);
    assert.ok(robot.warnings.some((w) => /NOT_COMPUTED/.test(w)));
    const kinds = new Set(robot.ir.nodes.map((n) => n.kind));
    assert.ok(kinds.has("Limb") && kinds.has("Joint") && kinds.has("Actuator"));

    const car = compileDesignBrief("a car that weighs 2,500 lb, does 180 mph, seats 4");
    assert.equal(car.ok, true);
    assert.equal(car.architecture, "road-vehicle");
  });

  it("opens a full brief and runs torque and walk checks", () => {
    const compiled = compileDesignBrief("biped robot 60 kg, thigh 0.4 m, shin 0.4 m, stance 0.2 m, foot 0.08 m, actuator 48 Nm");
    assert.equal(compiled.ok, true, compiled.error);
    const opened = openDesign(compiled.ir);
    assert.equal(opened.ok, true, opened.errors?.join("; "));
    const torque = opened.session.result("robotics.limb-torque@LIMB_L");
    assert.ok(["PASS", "FAIL", "WARN"].includes(torque.status), torque.reason);
    // No link mass: whole-robot mass, COM at mid-link, horizontal.
    const expected = 60 * G * 0.4 * 0.5;
    assert.ok(Math.abs(torque.outputs.holdingTorque.value - expected) < 1e-6, String(torque.outputs.holdingTorque.value));
    assert.ok(torque.warnings.some((w) => /upper bound/.test(w)));
    const walk = opened.session.result("robotics.walk-balance@ROBOT");
    assert.equal(walk.status, "FAIL");
    assert.ok(walk.outputs.singleSupportMargin.value < 0);
  });
});

describe("chat.respond tools stay outside the CSL macro gate", () => {
  it("catalog includes the bridge tools and CSL does not route them", async () => {
    const names = CHAT_RESPOND_TOOLS.map((t) => t.name);
    for (const n of ["list_lens_actions", "conkay_solver_list", "conkay_solve", "conkay_ir_schema", "conkay_compile_brief"]) {
      assert.ok(names.includes(n), n);
      assert.equal(MACRO_DISPATCH_TOOLS.has(n), false, n);
    }
    assert.equal(MACRO_DISPATCH_TOOLS.has("run_lens_action"), true);
    let cslCalls = 0;
    const gate = createCslToolGate({
      runCsl: async () => { cslCalls += 1; return { ok: false, reason: "should_not_run" }; },
    });
    const passed = await gate({ tool: "conkay_solve", params: { solver_id: "mass.part" } });
    assert.equal(passed.ok, true);
    assert.equal(passed.cslRouted, false);
    assert.equal(cslCalls, 0);
    const gated = await gate({ tool: "run_lens_action", params: { domain: "dtu", action: "search" } });
    assert.equal(cslCalls, 1);
    assert.equal(gated.cslRouted, true);
    assert.equal(gated.ok, false);
  });

  it("conkay_compile_brief runs through the agent tool and denies a lens-only key", async () => {
    const denied = authorizeBridgeCall({
      actor: { id: HERMES_USER_ID, scopes: ["mcp:lens:read"] },
      tool: "conkay_compile_brief",
      risk: BRIDGE_RISK.READ,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "scope_denied");

    const actor = { id: "user-1", userId: "user-1" };
    const viaTool = await executeToolCall(
      { actor, userId: "user-1" },
      async () => ({ ok: false }),
      new Map(),
      { tool: "conkay_compile_brief", params: { text: "limb 0.4 m, link mass 2 kg, actuator 20 Nm" } },
    );
    assert.equal(viaTool.ok, true, viaTool.error);
    assert.equal(viaTool.via, "mcp_execution_bridge");
    assert.ok(viaTool.ir.nodes.some((n) => n.kind === "Limb"));

    const missing = await conkayCompileBriefMcp(null, { brief: "" }, null, { actor });
    assert.equal(missing.ok, false);
  });
});
