// server/tests/conkay-orc-system-architecture.test.js
//
// SX-ORC-03 — orc.system-architecture acceptance tests.
// Reference case (the catalogue's named case): a robot brief yields
// >= 10 subsystems, each with a parent requirement. The ten are the
// ticket's own declared taxonomy; every subsystem parents on the root
// requirement (the brief verbatim), and ORC-02's system requirements
// are allocated by the declared table — a metric with no declared
// allocation (budget) is listed unallocated with its reason, never
// force-fit. Known kinds keep their compiled architecture instead.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { systemArchitecture, TAXONOMY } from "../lib/conkay/orc/system-architecture.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const ROBOT = "a bipedal robot that weighs 20 kg, does 3 m/s, runs 4 hours on a charge";

describe("SX-ORC-03 — reference case (robot -> >=10 subsystems, each parented)", () => {
  it("synthesizes the full declared taxonomy for an open-domain brief", () => {
    const r = systemArchitecture({ text: ROBOT });
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.architecture.kind, "generic");
    assert.ok(r.outputs.subsystemCount >= 10, `got ${r.outputs.subsystemCount}`);
    assert.equal(r.outputs.subsystemCount, TAXONOMY.length);
    for (const s of r.outputs.subsystems) {
      assert.equal(s.parentRequirement, "REQ-SYS-ROOT", `${s.id} has a parent requirement`);
    }
    assert.equal(r.outputs.rootRequirement.source, ROBOT, "the root requirement is the brief verbatim");
  });

  it("allocates ORC-02's system requirements by the declared table; budget stays unallocated with its reason", () => {
    const r = systemArchitecture({ text: "a car that weighs 2,500 lb, does 180 mph, seats 4, costs under 40000 dollars" });
    // The car compiles, so coverage runs through the CONTAINS tree instead.
    assert.equal(r.outputs.architecture.kind, "compiled");
    const g = systemArchitecture({ text: ROBOT });
    const byId = Object.fromEntries(g.outputs.subsystems.map((s) => [s.id, s]));
    assert.ok(byId["SUB-structure"].allocatedRequirements.some((x) => /mass/i.test(x)), "mass flows to structure");
    assert.ok(byId["SUB-power"].allocatedRequirements.length > 0, "mass/range flow to power");
    const budget = systemArchitecture({ text: "a drone that costs under $900" });
    const un = budget.outputs.requirementCoverage.unallocated.find((u) => u.metric === "budget");
    assert.ok(un, "budget is named unallocated");
    assert.match(un.reason, /rolls up/);
  });

  it("known kinds keep their compiled architecture, with the generic as the trade-study alternative", () => {
    const r = systemArchitecture({ text: "a car that weighs 2,500 lb, does 180 mph, seats 4" });
    assert.equal(r.outputs.architecture.kind, "compiled");
    assert.equal(r.outputs.architecture.id, "road-vehicle");
    assert.ok(r.outputs.subsystemCount >= 10);
    assert.ok(r.outputs.subsystems.every((s) => s.parentRequirement === "REQ-SYS-ROOT"));
    assert.deepEqual(r.outputs.alternatives.map((a) => a.kind), ["compiled", "generic"]);
    const wheels = r.outputs.subsystems.find((s) => s.id === "WHEELS");
    assert.ok(wheels, "compiled subsystems are the compiled nodes");
  });
});

describe("SX-ORC-03 — honesty legs", () => {
  it("carries the SXE-21 engine leg NOT_COMPUTED beside the synthesis, labelled", () => {
    const r = systemArchitecture({ text: ROBOT });
    assert.equal(r.outputs.engineTier.status, "NOT_COMPUTED");
    assert.equal(r.outputs.engineTier.reason, "engine_unavailable:sxe-21");
  });

  it("content-free and missing text are NOT_COMPUTED, named (SC-05)", async () => {
    await assertNothingAssumed((p) => systemArchitecture(p), { text: ROBOT }, ["text"], "orc.system-architecture");
    assert.match(systemArchitecture({ text: "hello there friend" }).notComputed, /no_parseable_design_content/);
  });

  it("citations leg: no out-of-domain citations (SC-05 helper)", () => {
    assertCitationsDomain(systemArchitecture({ text: ROBOT }), getSolver("orc.system-architecture"), "orc.system-architecture");
  });

  it("is deterministic: two runs are deep-equal", () => {
    assert.deepEqual(systemArchitecture({ text: ROBOT }).outputs, systemArchitecture({ text: ROBOT }).outputs);
  });
});

describe("SX-ORC-03 — registry + IR reachability", () => {
  it("is registered at L2 with declarations", () => {
    const s = listSolvers().find((x) => x.id === "orc.system-architecture");
    assert.ok(s, "orc.system-architecture not in the registry");
    assert.equal(s.fidelity, 2);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === true);
    assert.deepEqual(getSolver("orc.system-architecture").engineDependent, ["sxe-21"]);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "orc3", name: "ORC3" },
      nodes: [
        { id: "A1", kind: "Part", name: "arch", props: { "orc.systemArchitecture": { text: ROBOT } } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.system-architecture@A1");
    assert.ok(env, "no orc.system-architecture envelope");
    assert.equal(env.outputs.subsystemCount, 10);
  });
});
