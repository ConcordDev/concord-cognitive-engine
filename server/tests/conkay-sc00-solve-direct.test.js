// SC-00: solve.direct — run one registered solver against caller-supplied
// typed inputs, with no Design IR. The direct path must run the production
// machinery entire (openDesign → DesignEngine → envelope), inherit the
// SC-05 input-integrity arming, and be reachable as conkay_solve's direct
// mode in the MCP bridge.
//
// Run: node --test tests/conkay-sc00-solve-direct.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { solveDirect, buildDirectIR } from "../lib/conkay/solve-direct.js";
import { openDesign } from "../lib/conkay/index.js";
import { registerSolver } from "../lib/conkay/physics/registry.js";
import { conkaySolveMcp } from "../lib/mcp-execution-bridge.js";

const ACTOR = { id: "u-sc00", userId: "u-sc00", role: "member", scopes: [] };
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

const GEOMETRY = { shape: "i-beam", length: "4 m", height: "300 mm", flangeWidth: "150 mm", flangeThickness: "12 mm", webThickness: "8 mm" };

// The evidence beam (EQUIV-EVIDENCE / SC-05 fixture) as typed inputs.
const beamSpec = () => ({
  node: { kind: "Beam", material: "steel-a992", props: { support: "simply-supported" }, geometry: { ...GEOMETRY } },
  loadCases: [{ id: "LC1", loads: [{ pointLoad: "60 kN" }] }],
});

const beamIR = () => ({
  design: { id: "frame" },
  nodes: [{ id: "G1", kind: "Beam", material: "steel-a992", props: { support: "simply-supported" }, geometry: { ...GEOMETRY } }],
  loadCases: [{ id: "LC1", loads: [{ target: "G1", pointLoad: "60 kN" }] }],
});

// Reads E from the design's material, then echoes (and uses) 190 GPa —
// the SC-05 substitution shape, re-registered against the direct path.
registerSolver({
  id: "test.sc00-substitutor", version: "0.0.0", domain: "structural.bending", fidelity: 1,
  method: "test-only SC-00 probe: substitutes E against the declared inputs",
  targets: (g) => g.nodesOfKind("Beam").map((n) => n.id),
  run(ctx, id) {
    const mat = ctx.material(id);
    void mat.youngsModulusPa; // read, then ignored — the substitution
    return {
      inputs: { E: { value: 190e9, unit: "Pa" } },
      outputs: { usedE: { value: 190e9, unit: "Pa" } },
      margins: [], warnings: [], assumptions: [],
    };
  },
});

describe("SC-00: solve.direct runs a shipped solver on typed inputs", () => {
  it("beam.fea on the evidence beam PASSes with the IR path's own value", async () => {
    const r = await solveDirect("beam.fea", beamSpec());
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.status, "PASS", JSON.stringify(r.results?.[0]));
    const env = r.results[0];
    assert.ok(near(env.outputs.maxDeflection.value, 0.00450911598961386), String(env.outputs.maxDeflection.value));

    const opened = openDesign(beamIR());
    assert.equal(opened.ok, true);
    await opened.session.settle();
    const irEnv = opened.session.results().find((e) => e.solver?.id === "beam.fea");
    assert.equal(env.outputs.maxDeflection.value, irEnv.outputs.maxDeflection.value);
  });

  it("a substituted echo is refused on the direct path (SC-05 arming inherited)", async () => {
    const r = await solveDirect("test.sc00-substitutor", beamSpec());
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.status, "NOT_COMPUTED", JSON.stringify(r.results?.[0]));
    assert.equal(r.results[0].reason, "input_substituted:E (supplied 200000000000, used 190000000000)");
  });

  it("an unknown solver is refused by name, never thrown", async () => {
    const r = await solveDirect("no.such-solver", beamSpec());
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_solver");
  });

  it("a solver with no applicable targets answers NOT_COMPUTED, honestly empty", async () => {
    const r = await solveDirect("beam.fea", {
      node: { kind: "Part", material: "steel-a992", props: { mass: "2 kg" } },
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.status, "NOT_COMPUTED");
    assert.deepEqual(r.results, []);
  });

  it("buildDirectIR targets the loads at the one node", () => {
    const ir = buildDirectIR(beamSpec());
    assert.equal(ir.nodes.length, 1);
    assert.equal(ir.loadCases[0].loads[0].target, ir.nodes[0].id);
    assert.equal(ir.loadCases[0].loads[0].pointLoad, "60 kN");
  });
});

describe("SC-00: conkay_solve direct mode in the MCP bridge", () => {
  it("solves from { solver_id, inputs } with no ir and no designId", async () => {
    const r = await conkaySolveMcp(null, { solver_id: "beam.fea", inputs: beamSpec() }, null, { actor: ACTOR });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400));
    const env = (r.results || []).find((e) => e.solver?.id === "beam.fea" || e.solver_id === "beam.fea") || r.results?.[0];
    assert.ok(env, JSON.stringify(r).slice(0, 400));
    const status = env.status;
    assert.equal(status, "PASS", JSON.stringify(env).slice(0, 400));
  });

  it("dry_run over typed inputs previews the target", async () => {
    const r = await conkaySolveMcp(null, { solver_id: "beam.fea", inputs: beamSpec(), dry_run: true }, null, { actor: ACTOR });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400));
    assert.equal(r.dry_run, true);
    assert.equal(r.preview.would_run, 1);
  });

  it("the missing-input error now names the direct mode", async () => {
    const r = await conkaySolveMcp(null, { solver_id: "beam.fea" }, null, { actor: ACTOR });
    assert.equal(r.ok, false);
    assert.match(r.error, /inputs \(solve\.direct typed inputs\)/);
  });
});
