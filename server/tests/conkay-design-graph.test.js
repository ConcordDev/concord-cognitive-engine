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
  // mass.cg@A1 reads the bolt's mass, so it reruns too (it stays NOT_COMPUTED: the bracket has no positions).
  const AFFECTED = ["mass.part@B1", "cost.part@B1", "joint.bolt-shear@J1", "mass.assembly@A1", "mass.cg@A1", "cost.assembly@A1", "requirement.check@R1"].sort();

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

  it("refuses an oversized design up front", () => {
    const c = compileDesignIR({ nodes: Array.from({ length: 2001 }, (_, i) => ({ id: `n${i}`, kind: "Part" })) });
    assert.equal(c.ok, false);
    assert.match(c.errors[0], /at most 2000/);
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

describe("Vehicle top speed", () => {
  const car = (over = {}) => ({
    design: { id: "car", name: "Test car" },
    nodes: [
      { id: "CAR1", kind: "Assembly", name: "Car", props: { vehicle: { dragCoefficient: 0.30, frontalArea: "2.0 m2", rollingResistance: 0.012, drivelineEfficiency: 0.9, ...over.vehicle } } },
      { id: "CH1", kind: "Part", name: "Chassis", material: "steel-a36", geometry: { shape: "box", length: "4 m", width: "1.8 m", height: "0.0177 m" } },
      { id: "E1", kind: "Actuator", name: "Engine", material: "aluminum-6061-t6", props: { maxPower: over.power || "300 kW" }, geometry: { shape: "box", length: "0.6 m", width: "0.6 m", height: "0.5 m" } },
    ],
    edges: [{ type: "CONTAINS", from: "CAR1", to: "CH1" }, { type: "CONTAINS", from: "CAR1", to: "E1" }],
    requirements: [{ id: "VMAX", label: "Top speed", of: { solver: "vehicle.top-speed", target: "CAR1", output: "topSpeed" }, min: "180 mph" }],
  });

  it("solves P·η = ½ρCdA·v³ + Crr·m·g·v", () => {
    const s = open(car());
    const e = s.result("vehicle.top-speed@CAR1");
    assert.equal(e.status, "PASS", e.reason);
    const v = e.outputs.topSpeed.value;
    const m = e.inputs.mass.value;
    const lhs = 300e3 * 0.9;
    const rhs = 0.5 * 1.225 * 0.30 * 2.0 * v ** 3 + 0.012 * m * 9.80665 * v;
    assert.ok(Math.abs(lhs - rhs) / lhs < 1e-9, `${lhs} vs ${rhs}`);
    assert.match(e.inputs.dragCoefficient.source, /not computed from geometry/);
  });

  it("checks the 180 mph requirement against the solved speed", () => {
    const s = open(car());
    const v = s.result("vehicle.top-speed@CAR1").outputs.topSpeed.value;
    const req = s.result("requirement.check@VMAX");
    assert.equal(req.status, v >= 180 * 0.44704 ? "PASS" : "FAIL");
  });

  it("'what top speed with 400 hp?' reruns top speed and the requirement, not the masses", () => {
    const s = open(car());
    const before = s.result("vehicle.top-speed@CAR1").outputs.topSpeed.value;
    const r = s.editText("set engine E1 power to 400 hp");
    assert.equal(r.ok, true, r.error);
    assert.deepEqual([...r.rerun].sort(), ["requirement.check@VMAX", "vehicle.top-speed@CAR1"]);
    const after = s.result("vehicle.top-speed@CAR1").outputs.topSpeed.value;
    assert.ok(after < before, "400 hp (298 kW) is a little less than 300 kW");
    assert.ok(Math.abs(s.graph.node("E1").props.maxPower - 400 * 745.6998715822702) < 1e-6);
  });

  it("a drag coefficient edit reruns the same two runs", () => {
    const s = open(car());
    const r = s.editText("set car CAR1 drag coefficient to 0.25");
    assert.equal(r.ok, true, r.error);
    assert.deepEqual([...r.rerun].sort(), ["requirement.check@VMAX", "vehicle.top-speed@CAR1"]);
    assert.equal(s.graph.node("CAR1").props.vehicle.dragCoefficient, 0.25);
  });

  it("missing vehicle data is not computed, and so is the requirement", () => {
    const s = open(car({ vehicle: { dragCoefficient: undefined } }));
    assert.equal(s.result("vehicle.top-speed@CAR1").status, "NOT_COMPUTED");
    assert.equal(s.result("requirement.check@VMAX").status, "NOT_COMPUTED");
  });
});

describe("Shells and the added materials", () => {
  const panel = (material) => ({
    design: { id: "panel" },
    nodes: [{ id: "S1", kind: "Part", name: "Roof panel", material, geometry: { shape: "shell", area: "2.4 m2", thickness: "2 mm" } }],
  });

  it("shell mass is area × thickness × density", () => {
    const s = open(panel("cfrp-quasi-iso"));
    const e = s.result("mass.part@S1");
    assert.ok(Math.abs(e.outputs.mass.value - 2.4 * 0.002 * 1550) < 1e-9);
    assert.equal(e.inputs.material.basis, "typical");
  });

  it("'make S1 carbon fibre' then 'set S1 thickness to 3 mm' recompute the panel mass", () => {
    const s = open(panel("aluminum-6061-t6"));
    assert.equal(s.editText("make S1 carbon fibre").ok, true);
    assert.equal(s.graph.node("S1").material, "cfrp-quasi-iso");
    assert.equal(s.editText("set S1 thickness to 3 mm").ok, true);
    assert.ok(Math.abs(s.result("mass.part@S1").outputs.mass.value - 2.4 * 0.003 * 1550) < 1e-9);
  });

  it("an area given as a length is refused", () => {
    const c = compileDesignIR({ nodes: [{ id: "S1", kind: "Part", material: "glass-soda-lime", geometry: { shape: "shell", area: "2 m", thickness: "4 mm" } }] });
    assert.equal(c.ok, false);
    assert.match(c.errors[0], /expected a area/);
  });

  it("composites and brittle materials have no yield, so nothing pretends they do", async () => {
    const { getMaterial } = await import("../lib/conkay/materials/index.js");
    for (const id of ["cfrp-quasi-iso", "glass-soda-lime", "cast-iron-gray-30"]) assert.equal(getMaterial(id).yieldPa, null, id);
    assert.equal(getMaterial("astm-a325").basis, "specified minimum");
  });
});

describe("Centre of gravity and axle loads", () => {
  // Two steel boxes on a 1 m spacing plus a point-mass engine block.
  const rig = (over = {}) => ({
    design: { id: "rig" },
    nodes: [
      { id: "V1", kind: "Assembly", name: "Rig", props: { vehicle: { frontAxleX: "0.5 m", rearAxleX: "3.0 m" } } },
      { id: "F1", kind: "Part", material: "steel-a36", geometry: { shape: "box", length: "0.5 m", width: "0.4 m", height: "0.2 m" }, position: { x: "1 m", y: "0 m", z: "0.3 m" } },
      { id: "R1", kind: "Part", material: "steel-a36", geometry: { shape: "box", length: "0.5 m", width: "0.4 m", height: "0.2 m" }, position: over.r1 || { x: "2 m", y: "0 m", z: "0.3 m" } },
      { id: "E1", kind: "Actuator", material: "aluminum-6061-t6", geometry: { shape: "cylinder", diameter: "0.3 m", length: "0.5 m" }, position: { x: "0.6 m", y: "0 m", z: "0.5 m" } },
    ],
    edges: ["F1", "R1", "E1"].map((to) => ({ type: "CONTAINS", from: "V1", to })),
  });

  it("CG and inertia match the hand sum", () => {
    const s = open(rig());
    const e = s.result("mass.cg@V1");
    assert.equal(e.status, "PASS", e.reason);
    const mb = 0.5 * 0.4 * 0.2 * 7850; // each box
    const me = Math.PI * 0.15 ** 2 * 0.5 * 2700; // engine
    const M = 2 * mb + me;
    const cgx = (mb * 1 + mb * 2 + me * 0.6) / M;
    const cgz = (2 * mb * 0.3 + me * 0.5) / M;
    assert.ok(Math.abs(e.outputs.cgX.value - cgx) < 1e-12);
    assert.ok(Math.abs(e.outputs.cgZ.value - cgz) < 1e-12);
    const ownYY = (mb * (0.5 ** 2 + 0.2 ** 2)) / 12;
    const Iyy = 2 * ownYY + mb * ((1 - cgx) ** 2 + (0.3 - cgz) ** 2) + mb * ((2 - cgx) ** 2 + (0.3 - cgz) ** 2) + me * ((0.6 - cgx) ** 2 + (0.5 - cgz) ** 2);
    assert.ok(Math.abs(e.outputs.Iyy.value - Iyy) / Iyy < 1e-12);
    assert.match(e.assumptions.join(" "), /point masses.*E1/);
  });

  it("axle loads split the weight by moment balance", () => {
    const s = open(rig());
    const cg = s.result("mass.cg@V1").outputs;
    const a = s.result("vehicle.axle-loads@V1").outputs;
    assert.ok(Math.abs(a.frontShare.value - (3.0 - cg.cgX.value) / 2.5) < 1e-12);
    assert.ok(Math.abs(a.frontAxleLoad.value + a.rearAxleLoad.value - cg.mass.value * 9.80665) < 1e-9);
  });

  it("moving a part reruns the CG and axle loads, not any mass", () => {
    const s = open(rig());
    const r = s.editText("set R1 x position to 2.5 m");
    assert.equal(r.ok, true, r.error);
    assert.deepEqual([...r.rerun].sort(), ["mass.cg@V1", "vehicle.axle-loads@V1"]);
  });

  it("a part with no position makes the CG not computed, not placed at the origin", () => {
    const ir = rig();
    delete ir.nodes[2].position;
    const s = open(ir);
    assert.equal(s.result("mass.cg@V1").status, "NOT_COMPUTED");
    assert.match(s.result("mass.cg@V1").reason, /R1 \(no position\)/);
    assert.equal(s.result("vehicle.axle-loads@V1").status, "NOT_COMPUTED");
  });

  it("a CG behind the rear axle warns", () => {
    const s = open(rig({ r1: { x: "40 m", y: "0 m", z: "0.3 m" } }));
    assert.equal(s.result("vehicle.axle-loads@V1").status, "WARN");
  });
});

describe("Brief → requirements", () => {
  it("reads the car brief's three numeric targets and keeps the rest as intent", async () => {
    const { parseBrief } = await import("../lib/conkay/compiler/requirement-parser.js");
    const r = parseBrief("a car that weighs 2,500 lb, does 180 mph, seats 4, with a futuristic aerodynamic look");
    const by = Object.fromEntries(r.requirements.map((q) => [q.metric, q]));
    assert.ok(Math.abs(by.mass.max.si - 2500 * 0.45359237) < 1e-9);
    assert.equal(by.mass.source, "weighs 2,500 lb");
    assert.ok(Math.abs(by.topSpeed.min.si - 180 * 0.44704) < 1e-9);
    assert.equal(by.seats.min.si, 4);
    assert.match(r.intent, /futuristic aerodynamic look/);
  });

  it("reads the aircraft brief, and says the bare distance was read as range", async () => {
    const { parseBrief } = await import("../lib/conkay/compiler/requirement-parser.js");
    const r = parseBrief("500 kg electric aircraft, 2 people, 800 miles");
    const by = Object.fromEntries(r.requirements.map((q) => [q.metric, q]));
    assert.equal(by.mass.max.si, 500);
    assert.equal(by.seats.min.si, 2);
    assert.ok(Math.abs(by.range.min.si - 800 * 1609.344) < 1e-6);
    assert.match(by.range.note, /read as range/);
    assert.equal(r.intent, "electric aircraft");
  });

  it("does not turn '500 plants' into seats; wind and budget are read", async () => {
    const { parseBrief } = await import("../lib/conkay/compiler/requirement-parser.js");
    const r = parseBrief("greenhouse for 500 plants, 120 mph wind, upstate NY year-round, solar, under $40k");
    const metrics = r.requirements.map((q) => q.metric).sort();
    assert.deepEqual(metrics, ["budget", "designWindSpeed"]);
    assert.match(r.intent, /500 plants/);
  });

  it("a brief with no numbers yields no invented targets", async () => {
    const { parseBrief } = await import("../lib/conkay/compiler/requirement-parser.js");
    const r = parseBrief("a nice chair");
    assert.deepEqual(r.requirements, []);
    assert.match(r.note, /no numeric targets/);
  });
});

describe("Feasibility before geometry", () => {
  const run = async (brief, bounds) => {
    const { parseBrief } = await import("../lib/conkay/compiler/requirement-parser.js");
    const { checkFeasibility } = await import("../lib/conkay/compiler/feasibility.js");
    return checkFeasibility(parseBrief(brief), bounds);
  };

  it("acceptance: a 500 kg, 2-person, 800-mile electric aircraft fails, with why and what would work", async () => {
    const r = await run("500 kg electric aircraft, 2 people, 800 miles");
    assert.equal(r.status, "FAIL");
    const s = r.results[0];
    // Hand calc: K = 300·3600·0.85/9.80665·30; battery share = 1 − 0.35 − 154/500.
    const K = (300 * 3600 * 0.85 / 9.80665) * 30;
    const share = 1 - 0.35 - 154 / 500;
    assert.ok(Math.abs(s.outputs.maxRange.value - K * share) < 1e-6);
    assert.match(s.reason, /597 mi, short of 800 mi/);
    const alt = Object.fromEntries(s.alternatives.map((a) => [a.change, a]));
    assert.ok(Math.abs(alt["raise battery specific energy"].value - (800 * 1609.344 * 9.80665) / (0.85 * 30 * share) / 3600) < 1e-6);
    assert.ok(Math.abs(alt["raise total mass"].value - 154 / (0.65 - (800 * 1609.344) / K)) < 1e-6);
    assert.equal(alt["carry fewer people"].value, 1);
    assert.match(s.inputs.liftToDrag.basis, /optimistic/);
  });

  it("the same aircraft with a 1,000 kg budget passes the screen (and says a design still has to show it)", async () => {
    const r = await run("1000 kg electric aircraft, 2 people, 800 miles");
    assert.equal(r.status, "PASS");
    assert.match(r.results[0].reason, /still has to show it/);
  });

  it("bounds can be overridden, and a heavier payload than the mass allows is explained", async () => {
    const r = await run("300 kg electric aircraft, 4 people, 50 miles");
    assert.equal(r.status, "FAIL");
    assert.match(r.results[0].reason, /no mass left for a battery/);
    const lower = await run("500 kg electric aircraft, 2 people, 800 miles", { liftToDrag: 15 });
    assert.equal(lower.results[0].inputs.liftToDrag.basis, "given");
  });

  it("a kind of design with no screen is not called feasible", async () => {
    const r = await run("a car that weighs 2,500 lb, does 180 mph, seats 4");
    assert.equal(r.status, "NO_SCREEN");
  });
});
