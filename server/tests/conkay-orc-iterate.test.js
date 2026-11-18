// server/tests/conkay-orc-iterate.test.js
//
// SX-ORC-08 — orc.iterate acceptance tests.
// Reference case (the catalogue's named case): the golden briefs
// converge. The golden brief here is the loop machinery's own —
// the Sentinel M1 robot design, which carries two deliberate
// faults (an undersized battery configuration and a weak bracket
// section) that bounded design variables repair. Expected values
// are the loop's own filed behaviour (its suite asserts the same
// convergence and the same accepted repairs against the same
// design): converged, zero final FAILs, requirements unchanged.
// The kernel-settle tier (SXE-21) is NOT_COMPUTED in every run.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { iterate } from "../lib/conkay/orc/iterate.js";
import { buildSentinelM1IR, DESIGN_VARIABLES, EXCLUDED_SOLVERS } from "../lib/conkay/demos/sentinel-m1.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertCitationsDomain } from "./_conkay-honesty.mjs";

const GOLDEN = () => ({ design: buildSentinelM1IR(), variables: DESIGN_VARIABLES, excludeSolvers: EXCLUDED_SOLVERS });

describe("SX-ORC-08 — reference case (the golden robot converges under bounded repairs)", () => {
  it("converges: both deliberate faults repaired, no final FAIL, requirements untouched", () => {
    const r = iterate(GOLDEN());
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.converged, true);
    assert.equal(r.outputs.finalFailures.length, 0);
    assert.equal(r.outputs.requirementsUnchanged, true);
    const accepted = r.outputs.repairs.filter((x) => x.result === "accepted");
    assert.ok(accepted.length >= 2, `expected at least the two fault repairs, got ${accepted.length}`);
    assert.ok(accepted.some((x) => x.variable === "battery.parallel"), "the battery fault is repaired by its bounded variable");
    const initialFails = r.outputs.initialChecks.filter((c) => c.status === "FAIL");
    assert.ok(initialFails.length >= 2, "the deliberate faults are visible in the initial checks");
  });

  it("without the battery variable the loop does NOT converge — and only LISTS the requirement change", () => {
    const props = GOLDEN();
    props.variables = DESIGN_VARIABLES.filter((v) => v.id !== "battery.parallel");
    const r = iterate(props);
    assert.equal(r.outputs.converged, false);
    const opt = r.outputs.requirementOptions.find((o) => o.runId === "requirement.check@R-duration");
    assert.ok(opt, "the unfixable check produces a requirement option");
    assert.match(opt.option, /relax/);
    assert.equal(opt.applied, false);
    assert.ok(r.warnings.some((w) => /did NOT converge/.test(w)));
  });
});

describe("SX-ORC-08 — engine honesty + adversarial legs", () => {
  it("every run carries the kernel-settle tier NOT_COMPUTED engine_unavailable:sxe-21, and excludes itself", () => {
    const r = iterate(GOLDEN());
    assert.equal(r.outputs.engineTier.status, "NOT_COMPUTED");
    assert.equal(r.outputs.engineTier.reason, "engine_unavailable:sxe-21");
    assert.ok(r.outputs.excludedSolvers.includes("orc.iterate"), "recursion guard: the loop never runs itself");
  });

  it("a design variable touching a locked input refuses the run, named (bounded variables)", () => {
    const r = iterate({
      design: buildSentinelM1IR(),
      variables: [{ id: "cheat", node: "payload", options: [{ label: "20", set: { "props.mass": 20 } }, { label: "5", set: { "props.mass": 5 } }] }],
    });
    assert.match(r.notComputed, /INVALID_INPUT: .*locked input/);
  });

  it("malformed inputs are INVALID_INPUT / missing, named (SC-05)", () => {
    assert.match(iterate({}).notComputed, /missing_input:design/);
    assert.match(iterate({ design: buildSentinelM1IR() }).notComputed, /missing_input:variables/);
    assert.match(iterate({ design: buildSentinelM1IR(), variables: DESIGN_VARIABLES, maxIterations: 0 }).notComputed, /maxIterations must be an integer/);
    assert.match(iterate({ design: { nodes: "nope" }, variables: DESIGN_VARIABLES }).notComputed, /missing_input:design/);
  });

  it("citations leg (SC-05): no out-of-domain citations", () => {
    const r = iterate(GOLDEN());
    assertCitationsDomain(r, getSolver("orc.iterate"), "orc.iterate");
  });
});

describe("SX-ORC-08 — registry + IR reachability", () => {
  it("is registered at L3 with declarations and the SXE-21 engine dependency", () => {
    const s = listSolvers().find((x) => x.id === "orc.iterate");
    assert.ok(s, "orc.iterate not in the registry");
    assert.equal(s.fidelity, 3);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
    assert.deepEqual(getSolver("orc.iterate").engineDependent, ["sxe-21"]);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "orc8", name: "ORC8" },
      nodes: [
        { id: "A1", kind: "Assembly", name: "loop", props: { "orc.iterate": GOLDEN() } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.iterate@A1");
    assert.ok(env, "no orc.iterate envelope");
    assert.equal(env.outputs.converged, true);
  });
});
