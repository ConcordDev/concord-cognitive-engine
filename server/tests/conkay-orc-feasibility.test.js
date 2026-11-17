// server/tests/conkay-orc-feasibility.test.js
//
// SX-ORC-04 — orc.feasibility acceptance tests.
// Reference cases (the catalogue's named cases): the Breguet range
// closed form and the Carnot bound, recomputed here from the textbook
// formulas (Anderson; Çengel) — never read back from the solver.
// A claim past a bound is a successful computation with an
// exceeds-bound verdict (envelope WARN), never a softened pass and
// never a solver failure. Best-case technology inputs (the battery
// ceiling) are labelled defaulted assumptions when used.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { feasibilityBound } from "../lib/conkay/orc/feasibility.js";
import { getSolver, listSolvers, envelope } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertEchoIntegrity, assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const rel = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

describe("SX-ORC-04 — reference cases (textbook closed forms)", () => {
  it("Carnot bound: 1 - Tc/Th, and a claim past it is exceeds-bound", () => {
    const r = feasibilityBound({ bound: "carnot", hotK: 600, coldK: 300 });
    assert.ok(rel(r.outputs.boundValue, 0.5));
    assert.equal(r.outputs.verdict, "bound-only");
    const over = feasibilityBound({ bound: "carnot", hotK: 600, coldK: 300, claimed: 0.75 });
    assert.equal(over.outputs.verdict, "exceeds-bound");
    assert.ok(over.warnings.some((w) => /exceeds the carnot bound/.test(w)));
    const env = envelope(getSolver("orc.feasibility"), "X", over, { runtimeMs: 1, revision: 0 });
    assert.equal(env.status, "WARN");
    const within = feasibilityBound({ bound: "carnot", hotK: 600, coldK: 300, claimed: 0.4 });
    assert.equal(within.outputs.verdict, "within-bound");
    assert.ok(within.outputs.margin > 0);
  });

  it("Breguet electric range: eta * (E*/g) * (L/D) * battery fraction", () => {
    const r = feasibilityBound({ bound: "breguet-electric", efficiency: 0.8, specificEnergyWhKg: 250, liftDrag: 15, batteryFraction: 0.3 });
    const expected = 0.8 * ((250 * 3600) / 9.80665) * 15 * 0.3;
    assert.ok(rel(r.outputs.boundValue, expected), `${r.outputs.boundValue} vs ${expected}`);
    assert.ok(r.outputs.boundValue > 300_000 && r.outputs.boundValue < 360_000, "sanity: ~330 km");
  });

  it("rocket equation: dv = Isp * g0 * ln(m0/mf)", () => {
    const r = feasibilityBound({ bound: "rocket", ispS: 300, initialMassKg: 1000, finalMassKg: 400 });
    assert.ok(rel(r.outputs.boundValue, 300 * 9.80665 * Math.log(2.5)));
  });

  it("Betz bound is exactly 16/27", () => {
    const r = feasibilityBound({ bound: "betz", claimed: 0.65 });
    assert.ok(rel(r.outputs.boundValue, 16 / 27));
    assert.equal(r.outputs.verdict, "exceeds-bound");
  });

  it("specific-energy: the default ceiling is a LABELLED defaulted assumption; an input ceiling is not", () => {
    const d = feasibilityBound({ bound: "specific-energy", claimed: 250 });
    assert.equal(d.outputs.boundValue, 300);
    assert.equal(d.outputs.verdict, "within-bound");
    assert.ok(d.assumptions.some((a) => a.field === "ceilingWhKg" && a.kind === "defaulted"));
    const o = feasibilityBound({ bound: "specific-energy", ceilingWhKg: 500, claimed: 450 });
    assert.equal(o.outputs.boundValue, 500);
    assert.equal(o.assumptions.length, 0);
  });

  it("trend sweep: Carnot bound rises with hot-side temperature", () => {
    const a = feasibilityBound({ bound: "carnot", hotK: 400, coldK: 300 });
    const b = feasibilityBound({ bound: "carnot", hotK: 900, coldK: 300 });
    assert.ok(b.outputs.boundValue > a.outputs.boundValue);
  });
});

describe("SX-ORC-04 — adversarial + honesty legs", () => {
  it("invalid inputs are INVALID_INPUT naming the field", () => {
    assert.match(feasibilityBound({ bound: "carnot", hotK: -5, coldK: 300 }).notComputed, /INVALID_INPUT: hotK/);
    assert.match(feasibilityBound({ bound: "carnot", hotK: 300, coldK: 600 }).notComputed, /INVALID_INPUT: coldK/);
    assert.match(feasibilityBound({ bound: "rocket", ispS: 300, initialMassKg: 400, finalMassKg: 1000 }).notComputed, /INVALID_INPUT: finalMassKg/);
    assert.match(feasibilityBound({ bound: "breguet-electric", efficiency: 1.5, specificEnergyWhKg: 250, liftDrag: 15, batteryFraction: 0.3 }).notComputed, /INVALID_INPUT: efficiency/);
    assert.match(feasibilityBound({ bound: "carnot", hotK: 1e300, coldK: 300 }).notComputed, /INVALID_INPUT: hotK/);
  });

  it("missing fields and unknown bounds are NOT_COMPUTED, named (SC-05)", async () => {
    await assertNothingAssumed((p) => feasibilityBound(p), { bound: "carnot", hotK: 600, coldK: 300 }, ["hotK"], "orc.feasibility");
    assert.match(feasibilityBound({ bound: "warp-drive" }).notComputed, /unknown_bound/);
    assert.match(feasibilityBound({}).notComputed, /missing_input:bound/);
  });

  it("echo integrity + citations through the envelope (SC-05)", () => {
    const s = getSolver("orc.feasibility");
    const raw = feasibilityBound({ bound: "carnot", hotK: 600, coldK: 300 });
    assertEchoIntegrity(raw, { hotK: 600, coldK: 300 }, "orc.feasibility");
    const env = envelope(s, "X", raw, { runtimeMs: 1, revision: 0, supplied: { hotK: 600, coldK: 300 }, ignored: [] });
    assert.equal(env.status, "PASS");
    assertCitationsDomain(env, s, "orc.feasibility");
  });
});

describe("SX-ORC-04 — registry + IR reachability", () => {
  it("is registered at L1 with declarations", () => {
    const s = listSolvers().find((x) => x.id === "orc.feasibility");
    assert.ok(s, "orc.feasibility not in the registry");
    assert.equal(s.fidelity, 1);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === true);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "orc4", name: "ORC4" },
      nodes: [
        { id: "B1", kind: "Part", name: "plant", props: { "orc.feasibility": { bound: "carnot", hotK: 600, coldK: 300, claimed: 0.4 } } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.feasibility@B1");
    assert.ok(env, "no orc.feasibility envelope");
    assert.equal(env.outputs.verdict, "within-bound");
  });
});
