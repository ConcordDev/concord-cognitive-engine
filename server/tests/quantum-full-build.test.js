// Quantum full-lens build — verb contracts the frontend renders against.
//
// The first pass crashed the lens on two undefined reads: Run on
// 'counts', Analyze on 'includes'. Both attach to fields the frontend
// reads directly off these verbs' results — measurements.counts and
// faultToleranceCost — so the contracts are pinned here at the verb,
// with the frontend suites pinning the render side. Also pinned: the
// parametric data model (params.theta drives the engine — RX(π) flips
// |0⟩ to |1⟩) and the save/list/load/delete persistence family the
// Save wiring reaches (the §9 re-pass fixture name is used verbatim).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerQuantumActions from "../domains/quantum.js";

const ACTIONS = new Map();
function registrar(domain, name, fn) {
  assert.equal(domain, "quantum");
  ACTIONS.set(name, fn);
}
function run(name, input = {}, userId = "user-a") {
  const fn = ACTIONS.get(name);
  assert.ok(fn, `quantum.${name} is registered`);
  return fn({ actor: { userId }, userId }, null, input);
}

const BELL = {
  qubits: 2,
  gates: [
    { gate: "H", targets: [0] },
    { gate: "CNOT", controls: [0], targets: [0, 1] },
  ],
};

before(() => {
  globalThis._concordSTATE = {};
  registerQuantumActions(registrar);
});

describe("simulateCircuit — the Run contract (F1)", () => {
  it("returns measurements.counts over the Bell outcomes, summing to shots", () => {
    const r = run("simulateCircuit", { circuit: BELL, shots: 1024 });
    assert.equal(r.ok, true);
    const counts = r.result.measurements.counts;
    assert.ok(counts && typeof counts === "object", "measurements.counts is an object");
    assert.equal(r.result.measurements.shots, 1024);
    const keys = Object.keys(counts);
    assert.ok(keys.length >= 1 && keys.every((k) => k === "00" || k === "11"),
      `counts keys are Bell outcomes only, got ${keys}`);
    assert.equal(keys.reduce((s, k) => s + counts[k], 0), 1024);
    const sv = Object.fromEntries(r.result.statevector.map((p) => [p.state, p.probability]));
    assert.equal(sv["00"], 0.5);
    assert.equal(sv["11"], 0.5);
  });
});

describe("analyzeCircuit — the Analyze contract (F2)", () => {
  it("returns every field the analysis panel reads, faultToleranceCost a string", () => {
    const r = run("analyzeCircuit", { circuit: BELL });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.faultToleranceCost, "string");
    assert.ok(r.result.faultToleranceCost.includes("Clifford"));
    assert.equal(r.result.totalGates, 2);
    assert.equal(r.result.cnotCount, 1);
    assert.equal(r.result.tCount, 0);
  });
});

describe("parametric data model (F3's server half)", () => {
  it("RX(π) on q[0] flips |0⟩ to |1⟩ with probability 1 via params.theta", () => {
    const r = run("simulateCircuit", {
      circuit: { qubits: 1, gates: [{ gate: "RX", targets: [0], params: { theta: Math.PI } }] },
      shots: 16,
    });
    assert.equal(r.ok, true);
    const sv = Object.fromEntries(r.result.statevector.map((p) => [p.state, p.probability]));
    assert.equal(sv["1"], 1);
    assert.deepEqual(r.result.measurements.counts, { "1": 16 });
  });

  it("QASM export carries the angle and import restores it", () => {
    const circuit = { qubits: 1, gates: [{ gate: "RZ", targets: [0], params: { theta: 1.25 } }] };
    const exp = run("exportQASM", { circuit });
    assert.equal(exp.ok, true);
    assert.ok(exp.result.qasm.includes("rz(1.25) q[0];"), exp.result.qasm);
    const imp = run("importQASM", { qasm: exp.result.qasm });
    assert.equal(imp.ok, true);
    assert.equal(imp.result.circuit.gates[0].gate, "RZ");
    assert.equal(imp.result.circuit.gates[0].params.theta, 1.25);
  });
});

describe("persistence family — save/list/load/delete (F4's wiring target)", () => {
  it("a circuit saves under a name, lists, loads back exactly, and deletes", () => {
    const name = "PR2QUANT-UNIQUE-STRING-1031";
    const s = run("saveCircuit", { circuit: BELL, name });
    assert.equal(s.ok, true);
    assert.equal(s.result.saved.name, name);
    const id = s.result.saved.id;

    const list = run("listCircuits", {});
    assert.equal(list.result.circuits.length, 1);
    assert.equal(list.result.circuits[0].gateCount, 2);

    const loaded = run("loadCircuit", { id });
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.result.circuit, BELL);

    // another user's list stays empty — the store is per-user
    assert.equal(run("listCircuits", {}, "user-b").result.circuits.length, 0);

    const del = run("deleteCircuit", { id });
    assert.equal(del.ok, true);
    assert.equal(run("listCircuits", {}).result.circuits.length, 0);
  });
});
