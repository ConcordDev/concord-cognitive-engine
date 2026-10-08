// ConKay physical-system compiler, first slice: Design IR, Design Graph,
// Solver Registry and the dependency / invalidation engine.
//
// The acceptance test from ~/.zuko/remaining-work/CONKAY-PHYSICAL-SYSTEM-
// COMPILER-2026-10-07.md: a bolt in a small assembly changes to stainless,
// and only the solvers that depend on it rerun (joint capacity, mass, cost),
// each returning a PASS/FAIL envelope with a receipt. The same edit as a
// sentence does the same thing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDesign, listSolvers } from "../lib/conkay/index.js";
import { compileDesignIR } from "../lib/conkay/compiler/design-ir.js";
import { DesignGraph } from "../lib/conkay/graph/design-graph.js";
import { DesignEngine } from "../lib/conkay/graph/engine.js";
import { registerSolver } from "../lib/conkay/physics/registry.js";
import { parseQuantity } from "../lib/conkay/compiler/units.js";

const KIP = 4448.2216152605;

function bracket({ shear = "40 kN", prices = true, bolts = { diameter: "20 mm", material: "astm-a325" } } = {}) {
  return {
    design: { id: "bracket", name: "Lap-splice bracket" },
    materials: prices
      ? { "astm-a325": { costPerKgUsd: "4 USD/kg", source: "test price" }, "iso-3506-a2-70": { costPerKgUsd: "9 USD/kg", source: "test price" } }
      : {},
    nodes: [
      { id: "A1", kind: "Assembly", name: "Bracket" },
      { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
      { id: "P2", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
      { id: "B1", kind: "Bolt", material: bolts.material, geometry: { shape: "bolt", diameter: bolts.diameter, length: "40 mm" } },
      { id: "B2", kind: "Bolt", material: bolts.material, geometry: { shape: "bolt", diameter: bolts.diameter, length: "40 mm" } },
      { id: "J1", kind: "Joint", name: "Splice", props: { shearPlanes: 1 } },
    ],
    edges: [
      ...["P1", "P2", "B1", "B2", "J1"].map((to) => ({ type: "CONTAINS", from: "A1", to })),
      ...["P1", "P2", "B1", "B2"].map((to) => ({ type: "CONTAINS", from: "J1", to })),
    ],
    loadCases: [{ id: "LC1", loads: [{ target: "J1", shear }] }],
    requirements: [{ id: "R1", label: "Bracket mass", of: { solver: "mass.assembly", target: "A1", output: "mass" }, max: "4 kg" }],
  };
}

function open(ir) {
  const o = openDesign(ir);
  assert.equal(o.ok, true, JSON.stringify(o.errors));
  return o.session;
}

const out = (s, id, k) => s.result(id).outputs[k].value;

describe("Solver registry", () => {
  it("lists every solver with its domain and fidelity", () => {
    const ids = listSolvers().map((s) => s.id);
    for (const id of ["mass.part", "mass.assembly", "cost.part", "cost.assembly", "joint.bolt-shear", "joint.bolt-bearing", "requirement.check"]) {
      assert.ok(ids.includes(id), id);
    }
    assert.equal(listSolvers().find((s) => s.id === "joint.bolt-shear").fidelity, 1);
  });

  it("bolt shear matches AISC Manual Table 7-1 (7/8 in A325-N, single shear: 24.3 kips)", () => {
    const s = open(bracket({ shear: "10 kN", bolts: { diameter: "0.875 in", material: "astm-a325" } }));
    const capKips = out(s, "joint.bolt-shear@J1", "governingCapacity") / KIP;
    // The Manual tabulates 0.75 × 54 ksi × 0.601 in² (area rounded) = 24.3; exact area gives 24.35.
    assert.ok(Math.abs(capKips - 24.3) < 0.1, `got ${capKips.toFixed(3)} kips`);
  });

  it("plate bearing matches the J3-6a hand calculation", () => {
    const s = open(bracket());
    const m = s.result("joint.bolt-bearing@J1").margins[0];
    // 0.75 × 2.4 × 20 mm × 10 mm × 400 MPa (A36 Fu) = 144 kN
    assert.ok(Math.abs(m.capacity - 144000) < 1e-6, String(m.capacity));
    assert.equal(m.demand, 20000);
  });

  it("every envelope is a receipt: inputs, solver version, fidelity, input hash", () => {
    const s = open(bracket());
    const e = s.result("joint.bolt-shear@J1");
    assert.equal(e.status, "PASS");
    assert.equal(e.solver.version, "1.0.0");
    assert.equal(e.solver.fidelity, "L1");
    assert.match(e.provenance.inputHash, /^[0-9a-f]{64}$/);
    assert.ok(e.inputs["B1.Fu"].source.includes("F3125"));
    assert.ok(e.margins.every((m) => m.utilization > 0 && m.utilization <= 1));
    // Same inputs, same hash.
    assert.equal(open(bracket()).result("joint.bolt-shear@J1").provenance.inputHash, e.provenance.inputHash);
  });

  it("an overloaded joint fails, with the margin that failed", () => {
    const s = open(bracket({ shear: "200 kN" }));
    const e = s.result("joint.bolt-shear@J1");
    assert.equal(e.status, "FAIL");
    assert.ok(e.margins.some((m) => m.utilization > 1));
  });
});

describe("Acceptance: change one bolt to stainless", () => {
  const AFFECTED = ["mass.part@B1", "cost.part@B1", "joint.bolt-shear@J1", "mass.assembly@A1", "cost.assembly@A1", "requirement.check@R1"].sort();

  it("reruns only what depends on the bolt's material", () => {
    const s = open(bracket());
    const before = { bearing: s.result("joint.bolt-bearing@J1"), p1: s.result("mass.part@P1") };
    const r = s.edit([{ node: "B1", path: "material", value: "iso-3506-a2-70" }]);
    assert.equal(r.ok, true);
    assert.deepEqual([...r.rerun].sort(), AFFECTED);
    assert.ok(r.reused.includes("joint.bolt-bearing@J1"), "bearing does not read bolt material");
    assert.ok(r.reused.includes("mass.part@B2"));
    // Reused results are the same objects, not recomputed copies.
    assert.equal(s.result("joint.bolt-bearing@J1"), before.bearing);
    assert.equal(s.result("mass.part@P1"), before.p1);
  });

  it("shows the consequences with before/after values", () => {
    const s = open(bracket());
    const r = s.edit([{ node: "B1", path: "material", value: "iso-3506-a2-70" }]);
    const shear = r.changes.find((c) => c.runId === "joint.bolt-shear@J1");
    assert.equal(shear.statusBefore, "PASS");
    assert.equal(shear.statusAfter, "WARN", "stainless is outside AISC J3.2, so it is flagged");
    // A2-70: 0.75 × 0.45 × 700 MPa × π·(20 mm)²/4
    assert.ok(Math.abs(shear.outputs.governingCapacity.after - 0.75 * 0.45 * 700e6 * Math.PI * 0.02 ** 2 / 4) < 1e-6);
    const cost = r.changes.find((c) => c.runId === "cost.part@B1");
    assert.ok(cost.outputs.cost.after > cost.outputs.cost.before);
    assert.match(s.result("joint.bolt-shear@J1").warnings[0], /screening extrapolation/);
  });

  it("the same edit as a sentence does the same thing and says how it read 'stainless'", () => {
    const a = open(bracket());
    const b = open(bracket());
    const viaOps = a.edit([{ node: "B1", path: "material", value: "iso-3506-a2-70" }]);
    const viaText = b.editText("make bolt B1 stainless");
    assert.equal(viaText.ok, true, viaText.error);
    assert.deepEqual(viaText.parsed.ops, [{ node: "B1", path: "material", value: "iso-3506-a2-70" }]);
    assert.match(viaText.parsed.notes[0], /A2-70/);
    assert.deepEqual([...viaText.rerun].sort(), [...viaOps.rerun].sort());
    assert.equal(b.result("joint.bolt-shear@J1").outputs.governingCapacity.value, a.result("joint.bolt-shear@J1").outputs.governingCapacity.value);
    assert.equal(b.graph.history.at(-1).text, "make bolt B1 stainless");
  });

  it("dependencies are the values each solver actually read", () => {
    const s = open(bracket());
    const bearing = s.engine.dependencies("joint.bolt-bearing@J1");
    assert.ok(bearing.includes("node:P1/geometry.thickness"));
    assert.ok(bearing.includes("node:B1/geometry.diameter"));
    assert.ok(!bearing.includes("node:B1/material"));
    assert.ok(s.engine.dependencies("joint.bolt-shear@J1").includes("material:astm-a325/ultimatePa"));
  });
});

describe("Other edits", () => {
  it("a plate thickness edit reruns bearing and the plate's mass, not bolt shear", () => {
    const s = open(bracket());
    const r = s.editText("set plate P1 thickness to 6 mm");
    assert.equal(r.ok, true, r.error);
    assert.ok(r.rerun.includes("joint.bolt-bearing@J1"));
    assert.ok(r.rerun.includes("mass.part@P1"));
    assert.ok(!r.rerun.includes("joint.bolt-shear@J1"));
    assert.ok(Math.abs(s.result("mass.part@P1").outputs.mass.value - 0.2 * 0.1 * 0.006 * 7850) < 1e-9);
  });

  it("'all bolts' edits every bolt", () => {
    const s = open(bracket());
    const r = s.editText("change all bolts to A490");
    assert.deepEqual(r.parsed.ops.map((o) => o.node).sort(), ["B1", "B2"]);
    assert.equal(s.graph.node("B2").material, "astm-a490");
  });

  it("a sentence it can't map is refused, and nothing changes", () => {
    const s = open(bracket());
    for (const t of ["make bolt B9 stainless", "make bolt B1 unobtainium", "set plate P1 thickness to 6 kg", "paint it red"]) {
      const r = s.editText(t);
      assert.equal(r.ok, false, t);
    }
    assert.equal(s.graph.revision, 0);
    assert.equal(s.graph.node("B1").material, "astm-a325");
  });

  it("a batch with one bad op leaves the graph unchanged", () => {
    const s = open(bracket());
    const r = s.edit([{ node: "B1", path: "material", value: "iso-3506-a2-70" }, { node: "P1", path: "geometry.thickness", value: -1 }]);
    assert.equal(r.ok, false);
    assert.equal(s.graph.node("B1").material, "astm-a325");
  });
});

describe("Honesty", () => {
  it("no price means NOT_COMPUTED, and the roll-up does not treat it as zero", () => {
    const s = open(bracket({ prices: false }));
    assert.equal(s.result("cost.part@B1").status, "NOT_COMPUTED");
    assert.match(s.result("cost.part@B1").reason, /no price/);
    assert.equal(s.result("cost.assembly@A1").status, "NOT_COMPUTED");
    assert.equal(s.result("cost.part@P1").status, "PASS", "A36 has a library price");
  });

  it("coverage reports physics with no solver as gaps", () => {
    const s = open(bracket());
    const j1 = s.coverage().find((c) => c.node === "J1");
    const galvanic = j1.domains.find((d) => d.domain === "corrosion.galvanic");
    assert.equal(galvanic.status, "not computed");
    assert.match(galvanic.reason, /no corrosion.galvanic solver/);
    const b1 = s.coverage().find((c) => c.node === "B1");
    assert.equal(b1.domains.find((d) => d.domain === "structural.shear").solver, "joint.bolt-shear");
    assert.equal(b1.domains.find((d) => d.domain === "fatigue").status, "not computed");
  });

  it("the bolt mass says the head and nut are not modelled", () => {
    const s = open(bracket());
    assert.match(s.result("mass.part@B1").assumptions[0], /head, nut/);
  });
});

describe("Design IR", () => {
  it("rejects unknown units, materials, kinds, shapes and bad values, all at once", () => {
    const ir = bracket();
    ir.nodes[1].geometry.thickness = "10 furlongs";
    ir.nodes[2].material = "unobtainium";
    ir.nodes[3].kind = "Gizmo";
    ir.nodes[4].geometry.diameter = "-5 mm";
    ir.edges.push({ type: "GLUED_TO", from: "P1", to: "P2" });
    const c = compileDesignIR(ir);
    assert.equal(c.ok, false);
    const text = c.errors.join("\n");
    for (const s of ["unknown unit", "unknown material", "unknown kind", "must be positive", "unknown type"]) assert.match(text, new RegExp(s));
  });

  it("converts every quantity to SI", () => {
    assert.ok(Math.abs(parseQuantity("0.875 in", "length").si - 0.022225) < 1e-12);
    assert.equal(parseQuantity("40 kN", "force").si, 40000);
    assert.equal(parseQuantity("10 kg", "length").ok, false);
    const g = DesignGraph.fromIR(bracket()).graph;
    assert.equal(g.node("P1").geometry.thickness, 0.01);
    assert.equal(g.loadCases[0].loads[0].shear, 40000);
  });
});

describe("Engine", () => {
  it("detects a dependency cycle instead of looping", () => {
    registerSolver({ id: "test.cycle-a", version: "0", domain: "test", fidelity: 0, method: "test", targets: () => ["X"], run: (ctx) => { ctx.result("test.cycle-b", "X"); return { outputs: {} }; } });
    registerSolver({ id: "test.cycle-b", version: "0", domain: "test", fidelity: 0, method: "test", targets: () => ["X"], run: (ctx) => { ctx.result("test.cycle-a", "X"); return { outputs: {} }; } });
    const g = DesignGraph.fromIR(bracket()).graph;
    const e = new DesignEngine(g, ["test.cycle-a", "test.cycle-b"]);
    e.runAll();
    assert.ok(e.results().some((r) => r.status === "ERROR" && /cycle/.test(r.error)));
  });
});

describe("Existing structural compute, wrapped", () => {
  const frame = (over = {}) => ({
    design: { id: "frame" },
    nodes: [
      { id: "G1", kind: "Beam", material: "steel-a992", props: { support: over.support || "simply-supported" }, geometry: { shape: "i-beam", length: "4 m", height: "300 mm", flangeWidth: "150 mm", flangeThickness: "12 mm", webThickness: "8 mm" } },
      { id: "C1", kind: "Beam", material: "steel-a992", props: { support: "simply-supported" }, geometry: { shape: "i-beam", length: over.columnLength || "6 m", height: "200 mm", flangeWidth: "200 mm", flangeThickness: "12 mm", webThickness: "8 mm" } },
    ],
    loadCases: [{ id: "LC1", loads: [{ target: "G1", pointLoad: "60 kN" }, { target: "C1", compression: "300 kN" }] }],
  });

  it("beam.fea matches the closed-form PL/4 and PL³/48EI", () => {
    const s = open(frame());
    const e = s.result("beam.fea@G1");
    const Ix = (150 * 300 ** 3) / 12 - (142 * 276 ** 3) / 12; // mm⁴
    assert.ok(Math.abs(e.outputs.maxStress.value / 1e6 - (60e3 * 4000 / 4) * 150 / Ix) < 1e-6);
    assert.ok(Math.abs(e.outputs.maxDeflection.value * 1000 - (60e3 * 4000 ** 3) / (48 * 200000 * Ix)) < 1e-6);
    assert.equal(e.solver.fidelity, "L2");
    assert.ok(e.engineReceipt?.solver, "carries the FEA engine's own receipt");
  });

  it("beam.euler-buckling matches π²EI/(KL)² on the weak axis", () => {
    const s = open(frame());
    const e = s.result("beam.euler-buckling@C1");
    const Iy = (2 * 12 * 200 ** 3) / 12 + (176 * 8 ** 3) / 12; // mm⁴
    const pcr = (Math.PI ** 2 * 200000 * Iy) / 6000 ** 2; // N
    assert.ok(Math.abs(e.outputs.criticalLoad.value - pcr) / pcr < 1e-9, `${e.outputs.criticalLoad.value} vs ${pcr}`);
    assert.equal(e.warnings.length, 0, "KL/r 118 is in the elastic range for A992");
  });

  it("a stocky column warns that Euler overestimates it", () => {
    const s = open(frame({ columnLength: "3 m" }));
    assert.match(s.result("beam.euler-buckling@C1").warnings[0], /inelastic/);
    assert.equal(s.result("beam.euler-buckling@C1").status, "WARN");
  });

  it("an unknown support is not computed, not quietly simply-supported", () => {
    const s = open(frame({ support: "glued" }));
    assert.equal(s.result("beam.fea@G1").status, "NOT_COMPUTED");
  });

  it("a beam edit reruns that beam only, and coverage shows bending and deflection", () => {
    const s = open(frame());
    const r = s.editText("set beam G1 height to 250 mm");
    assert.deepEqual([...r.rerun].sort(), ["beam.fea@G1", "cost.part@G1", "mass.part@G1"]);
    const g1 = s.coverage().find((c) => c.node === "G1");
    assert.equal(g1.domains.find((d) => d.domain === "structural.deflection").solver, "beam.fea");
    assert.equal(g1.domains.find((d) => d.domain === "structural.buckling").status, "not computed");
  });
});
