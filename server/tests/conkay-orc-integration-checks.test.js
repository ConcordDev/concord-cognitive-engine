// server/tests/conkay-orc-integration-checks.test.js
//
// SX-ORC-06 — orc.integration-checks acceptance tests.
// Reference case (the catalogue's named case): a deliberately broken
// interface FAILs naming both sides. The closures are arithmetic the
// test states by hand: 1000 W supplied against 800 consumed + 200
// losses closes exactly; a heat loop generating 450 W and rejecting
// 400 W does not. Expected verdicts follow from those numbers, never
// from the solver's own output repackaged.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { integrationChecks } from "../lib/conkay/orc/integration-checks.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertCitationsDomain } from "./_conkay-honesty.mjs";

const HEALTHY = {
  power: { suppliedW: 1000, consumedW: 800, lossesW: 200 },
  heatLoops: [{ id: "main", generatedW: 450, rejectedW: 450 }],
  mass: { actualKg: 18.5, targetKg: 20 },
  cg: { actualM: [0.01, 0, 0.3], targetM: [0, 0, 0.3], toleranceM: 0.02 },
  interfaces: [
    { id: "bus", kind: "voltage", a: { volts: 28 }, b: { volts: 28 } },
    { id: "umbilical", kind: "connector", a: { type: "XT90" }, b: { type: "XT90" } },
    { id: "coolant", kind: "flow", a: { capacityKgS: 0.5 }, b: { demandKgS: 0.4 } },
    { id: "mount", kind: "thread", a: { designation: "M6x1" }, b: { designation: "M6x1" } },
  ],
  clearances: [{ id: "rotor-tip", gapMm: 2.5, requiredMm: 2 }],
  loadPaths: [{ id: "leg", segments: [["hip", "knee"], ["knee", "ankle"], ["ankle", "foot"]] }],
};

describe("SX-ORC-06 — healthy system + reference case (broken interface FAILs naming both sides)", () => {
  it("a consistent system PASSes every check, with residuals reported", () => {
    const r = integrationChecks(HEALTHY);
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.verdict, "PASS");
    assert.equal(r.outputs.counts.failed, 0);
    const power = r.outputs.checks.find((c) => c.check === "power-closure");
    assert.equal(power.residual, 0);
    assert.equal(power.toleranceSource, "default-relative-1e-9");
  });

  it("REFERENCE: a 28 V bus feeding a 24 V device FAILs, naming both sides and both values", () => {
    const broken = structuredClone(HEALTHY);
    broken.interfaces[0].b.volts = 24;
    const r = integrationChecks(broken);
    assert.equal(r.outputs.verdict, "FAIL");
    const bus = r.outputs.checks.find((c) => c.check === "interface:bus");
    assert.equal(bus.status, "FAIL");
    assert.match(bus.detail, /side a declares 28 V, side b declares 24 V/);
  });

  it("a heat loop that generates more than it rejects FAILs its closure with the residual", () => {
    const r = integrationChecks({ heatLoops: [{ id: "main", generatedW: 450, rejectedW: 400 }] });
    const heat = r.outputs.checks.find((c) => c.check.startsWith("heat-closure"));
    assert.equal(heat.status, "FAIL");
    assert.equal(heat.residual, 50);
    assert.equal(r.outputs.verdict, "FAIL");
  });

  it("power that does not close FAILs; a declared tolerance is honoured and reported as declared", () => {
    const r = integrationChecks({ power: { suppliedW: 1000, consumedW: 800, lossesW: 150 } });
    assert.equal(r.outputs.checks[0].status, "FAIL");
    assert.equal(r.outputs.checks[0].residual, 50);
    const tolerated = integrationChecks({ power: { suppliedW: 1000, consumedW: 800, lossesW: 199.5, toleranceW: 1 } });
    assert.equal(tolerated.outputs.checks[0].status, "PASS");
    assert.equal(tolerated.outputs.checks[0].toleranceSource, "declared");
  });

  it("mass over target, CG out of tolerance, undersized flow, interference and a broken load path each FAIL with their detail", () => {
    const r = integrationChecks({
      mass: { actualKg: 21, targetKg: 20 },
      cg: { actualM: [0.05, 0, 0], targetM: [0, 0, 0], toleranceM: 0.02 },
      interfaces: [{ id: "coolant", kind: "flow", a: { capacityKgS: 0.3 }, b: { demandKgS: 0.4 } }],
      clearances: [{ id: "tip", gapMm: 1, requiredMm: 2 }],
      loadPaths: [{ id: "leg", segments: [["hip", "knee"], ["ankle", "foot"]] }],
    });
    assert.equal(r.outputs.verdict, "FAIL");
    assert.equal(r.outputs.counts.failed, 5);
    assert.match(r.outputs.checks.find((c) => c.check === "mass-target").detail, /EXCEEDS target 20 kg by 1 kg/);
    assert.match(r.outputs.checks.find((c) => c.check === "interface:coolant").detail, /UNDERSIZED: side a capacity 0.3 kg\/s is below side b demand 0.4 kg\/s/);
    assert.match(r.outputs.checks.find((c) => c.check.startsWith("load-path")).detail, /BROKEN at segment 1: segment 0 ends at "knee" but segment 1 starts at "ankle"/);
  });
});

describe("SX-ORC-06 — honesty + adversarial legs", () => {
  it("undeclared sections are NOT_RUN, named — never silently passed; an empty input computes nothing", () => {
    const r = integrationChecks({ power: { suppliedW: 10, consumedW: 9, lossesW: 1 } });
    assert.equal(r.outputs.verdict, "PASS");
    assert.ok(r.outputs.notRun.length >= 5);
    assert.ok(r.outputs.notRun.some((n) => n.check === "interface-compatibility"));
    assert.match(integrationChecks({}).notComputed, /no_checks_declared/);
  });

  it("malformed inputs are INVALID_INPUT, named (SC-05)", () => {
    assert.match(integrationChecks({ power: { suppliedW: NaN, consumedW: 1, lossesW: 1 } }).notComputed, /power requires finite/);
    assert.match(integrationChecks({ power: { suppliedW: -5, consumedW: 1, lossesW: 1 } }).notComputed, /must be non-negative/);
    assert.match(integrationChecks({ interfaces: [{ id: "x", kind: "wireless", a: {}, b: {} }] }).notComputed, /kind "wireless" is not in the vocabulary/);
    assert.match(integrationChecks({ cg: { actualM: [0, 0, 0], targetM: [0, 0, 0] } }).notComputed, /cg\.toleranceM must be a positive finite/);
    assert.match(integrationChecks({ interfaces: [{ id: "x", kind: "voltage", a: { volts: 28 } }] }).notComputed, /requires both sides/);
  });

  it("echo + citations legs (SC-05): inputs echoed exactly; no out-of-domain citations", () => {
    const r = integrationChecks(HEALTHY);
    assert.deepEqual(r.inputs, HEALTHY, "inputs echoed exactly as submitted");
    assertCitationsDomain(r, getSolver("orc.integration-checks"), "orc.integration-checks");
  });
});

describe("SX-ORC-06 — registry + IR reachability", () => {
  it("is registered at L3 with declarations and no engine dependency", () => {
    const s = listSolvers().find((x) => x.id === "orc.integration-checks");
    assert.ok(s, "orc.integration-checks not in the registry");
    assert.equal(s.fidelity, 3);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
    assert.deepEqual(getSolver("orc.integration-checks").engineDependent, []);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "orc6", name: "ORC6" },
      nodes: [
        { id: "S1", kind: "Assembly", name: "robot", props: { "orc.integrationChecks": HEALTHY } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.integration-checks@S1");
    assert.ok(env, "no orc.integration-checks envelope");
    assert.equal(env.outputs.verdict, "PASS");
  });
});
