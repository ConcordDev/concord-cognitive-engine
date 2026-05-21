// Contract tests for server/domains/quantum.js — a REAL gate-based
// statevector simulator (complex amplitude vector + unitary application),
// circuit analysis, error/noise modelling, QASM interop, algorithm
// templates, step-through execution, and persistent per-user circuits.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerQuantumActions from "../domains/quantum.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`quantum.${name}`);
  if (!fn) throw new Error(`quantum.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerQuantumActions(register); });

beforeEach(() => {
  // fresh in-memory state store per test so saved circuits don't leak
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// helper: probability of a basis state in a simulateCircuit result
function probOf(result, state) {
  const e = result.statevector.find((p) => p.state === state);
  return e ? e.probability : 0;
}

describe("quantum.gateLibrary", () => {
  it("returns a populated gate library, templates and noise presets", () => {
    const r = call("gateLibrary", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.gates.length >= 10);
    assert.ok(r.result.gates.some((g) => g.id === "H"));
    assert.ok(r.result.gates.some((g) => g.id === "CNOT" && g.qubits === 2));
    assert.ok(r.result.gates.some((g) => g.id === "RX" && g.parametric === true));
    assert.ok(r.result.templates.includes("bell"));
    assert.ok(r.result.noisePresets.includes("ideal"));
  });
});

describe("quantum.simulateCircuit — REAL statevector linear algebra", () => {
  it("rejects a missing circuit", () => {
    const r = call("simulateCircuit", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("H on |0> gives ~50/50 superposition", () => {
    const r = call("simulateCircuit", ctxA, { circuit: { qubits: 1, gates: [{ gate: "H", targets: [0] }] } });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(probOf(r.result, "0") - 0.5) < 1e-6);
    assert.ok(Math.abs(probOf(r.result, "1") - 0.5) < 1e-6);
  });

  it("X flips |0> to |1> deterministically", () => {
    const r = call("simulateCircuit", ctxA, { circuit: { qubits: 1, gates: [{ gate: "X", targets: [0] }] } });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(probOf(r.result, "1") - 1.0) < 1e-9);
    assert.ok(Math.abs(probOf(r.result, "0")) < 1e-9);
  });

  it("H then H is identity (returns to |0>)", () => {
    const r = call("simulateCircuit", ctxA, { circuit: { qubits: 1, gates: [{ gate: "H", targets: [0] }, { gate: "H", targets: [0] }] } });
    assert.ok(Math.abs(probOf(r.result, "0") - 1.0) < 1e-6);
  });

  it("Bell circuit (H + CNOT) produces a maximally-entangled |00>+|11> pair", () => {
    const r = call("simulateCircuit", ctxA, {
      circuit: { qubits: 2, gates: [
        { gate: "H", targets: [0] },
        { gate: "CNOT", controls: [0], targets: [0, 1] },
      ] },
    });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(probOf(r.result, "00") - 0.5) < 1e-6);
    assert.ok(Math.abs(probOf(r.result, "11") - 0.5) < 1e-6);
    assert.ok(probOf(r.result, "01") < 1e-9);
    assert.ok(probOf(r.result, "10") < 1e-9);
    assert.ok(r.result.maxEntanglement);
    assert.ok(r.result.entropy > 0.9);
  });

  it("statevector probabilities sum to ~1 and shots are emitted", () => {
    const r = call("simulateCircuit", ctxA, {
      circuit: { qubits: 3, gates: [{ gate: "H", targets: [0] }, { gate: "H", targets: [1] }, { gate: "H", targets: [2] }] },
      shots: 500,
    });
    assert.equal(r.ok, true);
    const sum = r.result.statevector.reduce((s, p) => s + p.probability, 0);
    assert.ok(Math.abs(sum - 1) < 1e-4);
    const shotSum = Object.values(r.result.measurements.counts).reduce((a, b) => a + b, 0);
    assert.equal(shotSum, 500);
    assert.equal(r.result.bloch.length, 3);
  });

  it("rejects circuits beyond the 12-qubit ceiling", () => {
    const r = call("simulateCircuit", ctxA, { circuit: { qubits: 14, gates: [] } });
    assert.equal(r.ok, false);
  });
});

describe("quantum.stepCircuit — gate-by-gate statevector animation", () => {
  it("emits one frame per gate plus the initial frame", () => {
    const r = call("stepCircuit", ctxA, {
      circuit: { qubits: 2, gates: [
        { gate: "H", targets: [0] },
        { gate: "CNOT", controls: [0], targets: [0, 1] },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalSteps, 3); // INIT + 2 gates
    assert.equal(r.result.frames[0].gate, "INIT");
    // after only the H gate, qubit 1 is still |0>
    const afterH = r.result.frames[1].statevector;
    assert.ok(afterH.find((p) => p.state === "00"));
    assert.ok(afterH.find((p) => p.state === "10"));
  });
});

describe("quantum.analyzeCircuit", () => {
  it("counts gates, depth, T-count and CNOT-count", () => {
    const r = call("analyzeCircuit", ctxA, {
      circuit: { qubits: 2, gates: [
        { gate: "H", targets: [0] },
        { gate: "T", targets: [0] },
        { gate: "CNOT", controls: [0], targets: [0, 1] },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalGates, 3);
    assert.equal(r.result.tCount, 1);
    assert.equal(r.result.cnotCount, 1);
    assert.match(r.result.faultToleranceCost, /T-gates/);
  });
});

describe("quantum.errorAnalysis", () => {
  it("ideal preset yields near-perfect fidelity", () => {
    const r = call("errorAnalysis", ctxA, {
      circuit: { qubits: 1, gates: [{ gate: "H", targets: [0] }] },
      preset: "ideal",
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.fidelityPercent > 99);
  });

  it("noisy preset degrades fidelity vs ideal", () => {
    const circuit = { qubits: 2, gates: [
      { gate: "H", targets: [0] },
      { gate: "CNOT", controls: [0], targets: [0, 1] },
      { gate: "T", targets: [1] },
    ] };
    const ideal = call("errorAnalysis", ctxA, { circuit, preset: "ideal" });
    const noisy = call("errorAnalysis", ctxA, { circuit, preset: "superconducting" });
    assert.ok(noisy.result.overallFidelity < ideal.result.overallFidelity);
  });
});

describe("quantum.noisePresets", () => {
  it("lists device noise presets with T1/T2 fields", () => {
    const r = call("noisePresets", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.presets.length >= 4);
    const ibm = r.result.presets.find((p) => p.id === "ibm_eagle");
    assert.ok(ibm && ibm.t1 > 0 && ibm.t2 > 0);
  });
});

describe("quantum.algorithmTemplate", () => {
  it("rejects an unknown template", () => {
    const r = call("algorithmTemplate", ctxA, { template: "nonsense" });
    assert.equal(r.ok, false);
  });

  it("builds a runnable Bell template", () => {
    const r = call("algorithmTemplate", ctxA, { template: "bell" });
    assert.equal(r.ok, true);
    assert.equal(r.result.circuit.qubits, 2);
    const sim = call("simulateCircuit", ctxA, { circuit: r.result.circuit });
    assert.ok(Math.abs(probOf(sim.result, "00") - 0.5) < 1e-6);
    assert.ok(Math.abs(probOf(sim.result, "11") - 0.5) < 1e-6);
  });

  it("builds a GHZ template that runs without error", () => {
    const r = call("algorithmTemplate", ctxA, { template: "ghz", qubits: 4 });
    assert.equal(r.ok, true);
    const sim = call("simulateCircuit", ctxA, { circuit: r.result.circuit });
    assert.equal(sim.ok, true);
    assert.ok(Math.abs(probOf(sim.result, "0000") - 0.5) < 1e-6);
    assert.ok(Math.abs(probOf(sim.result, "1111") - 0.5) < 1e-6);
  });
});

describe("quantum.exportQASM / importQASM round-trip", () => {
  it("exports a circuit to OpenQASM 2.0 text", () => {
    const r = call("exportQASM", ctxA, {
      circuit: { qubits: 2, gates: [
        { gate: "H", targets: [0] },
        { gate: "CNOT", controls: [0], targets: [0, 1] },
      ] },
    });
    assert.equal(r.ok, true);
    assert.match(r.result.qasm, /OPENQASM 2\.0/);
    assert.match(r.result.qasm, /h q\[0\]/);
    assert.match(r.result.qasm, /cx q\[0\],q\[1\]/);
  });

  it("imports QASM back into a runnable circuit", () => {
    const qasm = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];';
    const r = call("importQASM", ctxA, { qasm });
    assert.equal(r.ok, true);
    assert.equal(r.result.gatesParsed, 2);
    const sim = call("simulateCircuit", ctxA, { circuit: r.result.circuit });
    assert.ok(Math.abs(probOf(sim.result, "00") - 0.5) < 1e-6);
  });

  it("rejects empty QASM", () => {
    assert.equal(call("importQASM", ctxA, { qasm: "" }).ok, false);
  });
});

describe("quantum saved-circuit persistence (per-user)", () => {
  it("saves, lists, loads and deletes a circuit", () => {
    const circuit = { qubits: 2, gates: [{ gate: "H", targets: [0] }] };
    const saved = call("saveCircuit", ctxA, { circuit, name: "My Bell" });
    assert.equal(saved.ok, true);
    const id = saved.result.saved.id;

    const list = call("listCircuits", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.circuits.length, 1);
    assert.equal(list.result.circuits[0].name, "My Bell");

    const loaded = call("loadCircuit", ctxA, { id });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.result.circuit.qubits, 2);

    const del = call("deleteCircuit", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(call("listCircuits", ctxA, {}).result.circuits.length, 0);
  });

  it("does not leak saved circuits between users", () => {
    call("saveCircuit", ctxA, { circuit: { qubits: 1, gates: [] }, name: "A only" });
    assert.equal(call("listCircuits", ctxA, {}).result.circuits.length, 1);
    assert.equal(call("listCircuits", ctxB, {}).result.circuits.length, 0);
  });

  it("loadCircuit returns an error for an unknown id", () => {
    assert.equal(call("loadCircuit", ctxA, { id: "missing" }).ok, false);
  });
});
