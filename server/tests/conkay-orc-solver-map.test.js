// server/tests/conkay-orc-solver-map.test.js
//
// SX-ORC-05 — orc.solver-map acceptance tests.
// Reference case (the catalogue's named case): a robot brief's
// subsystems each map to >= 1 solver or name the gap. Expected matches
// are derived from the registry's own declarations (the cited source
// is the registry contents): the test checks that named solvers exist
// and that the selected candidate for a need is a real top scorer —
// and that an unread input ("telepathy link") lands in the gap list
// verbatim, never dropped and never force-matched.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { solverMap, rankSolvers } from "../lib/conkay/orc/solver-map.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const ROBOT = {
  subsystems: [
    { name: "structure", needs: ["mass properties"] },
    { name: "actuation", needs: ["joint torque"] },
    { name: "power", needs: ["feasibility bounds"] },
    { name: "planning", needs: ["intent parse"] },
    { name: "comms", needs: ["telepathy link"] },
  ],
};

describe("SX-ORC-05 — reference case (robot brief: map or gap per subsystem)", () => {
  it("every subsystem maps to >= 1 existing solver or names its gap", () => {
    const r = solverMap(ROBOT);
    assert.ok(!r.notComputed, r.notComputed);
    for (const sub of r.outputs.map) {
      for (const e of sub.entries) {
        if (e.gap) {
          assert.ok(r.outputs.gaps.some((g) => g.subsystem === sub.subsystem && g.need === e.need), `gap for ${e.need} not listed`);
        } else {
          assert.ok(e.candidates.length >= 1, `${sub.subsystem}/${e.need} has no candidates and no gap`);
          for (const c of e.candidates) assert.ok(getSolver(c.solver), `candidate ${c.solver} is not registered`);
        }
      }
    }
    assert.equal(r.outputs.fullyMapped, false);
    assert.deepEqual(r.outputs.gaps.map((g) => g.need), ["telepathy link"]);
  });

  it("the selected candidates are the expected top matches from the registry's declarations", () => {
    const r = solverMap(ROBOT);
    const byNeed = {};
    for (const sub of r.outputs.map) for (const e of sub.entries) byNeed[e.need] = e.candidates?.[0]?.solver;
    assert.equal(byNeed["mass properties"], "cad.mass-properties-brep");
    assert.equal(byNeed["joint torque"], "actuation.joint-torque");
    assert.equal(byNeed["feasibility bounds"], "orc.feasibility");
    assert.equal(byNeed["intent parse"], "orc.intent-parse");
  });

  it("roles and tiers are labelled: one selected, the rest fast paths with tiers", () => {
    const ranked = rankSolvers("mass properties", listSolvers());
    assert.ok(ranked.length >= 2, "expected several mass-capable solvers");
    const r = solverMap({ subsystems: [{ name: "s", needs: ["mass properties"] }] });
    const cands = r.outputs.map[0].entries[0].candidates;
    assert.equal(cands[0].role, "selected");
    assert.ok(cands.slice(1).every((c) => c.role === "fast-path"));
    assert.ok(cands.every((c) => /^L[0-4]$/.test(c.tier)));
  });

  it("ranking is deterministic and score-ordered", () => {
    const a = rankSolvers("mass properties inertia", listSolvers());
    const b = rankSolvers("mass properties inertia", listSolvers());
    assert.deepEqual(a, b);
    for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].score >= a[i].score);
  });

  it("a subsystem with no declared needs maps to a named gap, not silence", () => {
    const r = solverMap({ subsystems: [{ name: "mystery", needs: [] }] });
    assert.equal(r.outputs.gaps.length, 1);
    assert.match(r.outputs.gaps[0].reason, /no needs declared/);
  });
});

describe("SX-ORC-05 — adversarial + honesty legs", () => {
  it("malformed subsystems are INVALID_INPUT / missing, named (SC-05)", async () => {
    await assertNothingAssumed((p) => solverMap(p), ROBOT, ["subsystems"], "orc.solver-map");
    assert.match(solverMap({ subsystems: [{ name: "x" }] }).notComputed, /missing_input:subsystems\[0\]\.needs/);
    assert.match(solverMap({ subsystems: [{ name: "x", needs: [42] }] }).notComputed, /INVALID_INPUT/);
    assert.match(solverMap({ subsystems: [{ needs: ["mass"] }] }).notComputed, /INVALID_INPUT: subsystems\[0\]\.name/);
  });

  it("citations leg: no out-of-domain citations (SC-05 helper)", () => {
    const s = getSolver("orc.solver-map");
    const raw = solverMap(ROBOT);
    assertCitationsDomain(raw, s, "orc.solver-map");
  });
});

describe("SX-ORC-05 — registry + IR reachability", () => {
  it("is registered at L1 with declarations", () => {
    const s = listSolvers().find((x) => x.id === "orc.solver-map");
    assert.ok(s, "orc.solver-map not in the registry");
    assert.equal(s.fidelity, 1);
    assert.ok(s.regime && s.tolerance && s.screening === true);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "orc5", name: "ORC5" },
      nodes: [
        { id: "B1", kind: "Part", name: "plan", props: { "orc.solver-map": ROBOT } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.solver-map@B1");
    assert.ok(env, "no orc.solver-map envelope");
    assert.equal(env.outputs.gaps.length, 1);
  });
});
