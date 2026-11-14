// GB-1538 / FIX-quantum-002 + FIX-quantum-003 — head-check pins.
// quantum-002: a 1-qubit circuit (H on q0) must simulate as 1 qubit with
// two basis states — not 2 qubits / four rows. quantum-003: the same
// simulation must carry a Bloch vector for q0 at theta 90° (x ≈ 1) so
// the Bloch Spheres panel has a sphere to draw.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerQuantumActions from "../domains/quantum.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function simulate(circuit) {
  const fn = ACTIONS.get("quantum.simulateCircuit");
  return fn({ actor: { userId: "u1" } }, { id: null, data: {}, meta: {} }, { circuit, shots: 64 });
}

before(() => { registerQuantumActions(register); });

describe("quantum simulateCircuit qubit count + Bloch vector (FIX-quantum-002/-003)", () => {
  it("a 1-qubit H circuit simulates as exactly 1 qubit with 2 basis states", () => {
    const r = simulate({ qubits: 1, gates: [{ gate: "H", targets: [0], controls: [], params: {} }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.qubits, 1);
    assert.equal(r.result.statevector.length, 2);
    const probs = Object.fromEntries(r.result.statevector.map((p) => [p.state, p.probability]));
    assert.ok(Math.abs(probs["0"] - 0.5) < 1e-9 && Math.abs(probs["1"] - 0.5) < 1e-9);
  });

  it("the Bloch vector for H|0> sits at theta 90 degrees (x = 1, z = 0)", () => {
    const r = simulate({ qubits: 1, gates: [{ gate: "H", targets: [0], controls: [], params: {} }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.bloch.length, 1);
    const b = r.result.bloch[0];
    assert.ok(Math.abs(b.x - 1) < 1e-9, `x=${b.x}`);
    assert.ok(Math.abs(b.z) < 1e-9, `z=${b.z}`);
  });

  it("a 2-qubit circuit still simulates as 2 (no over-correction)", () => {
    const r = simulate({ qubits: 2, gates: [{ gate: "H", targets: [0], controls: [], params: {} }] });
    assert.equal(r.result.qubits, 2);
    // probabilityTable lists the populated basis states: H on q0 fills
    // |00> and |10> at 0.5 each.
    const probs = Object.fromEntries(r.result.statevector.map((p) => [p.state, p.probability]));
    assert.deepEqual(Object.keys(probs).sort(), ["00", "10"]);
    assert.ok(Math.abs(probs["00"] - 0.5) < 1e-9 && Math.abs(probs["10"] - 0.5) < 1e-9);
    assert.equal(r.result.bloch.length, 2);
  });
});
