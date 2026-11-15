// quantum-bloch-sphere-values.test.js
//
// FIX-quantum-003 regression pin: the walk found the Bloch Spheres
// panel blank after simulating H|0>. At branch state the simulator
// returns exactly the expected vector — H|0> is the +X eigenstate,
// Bloch (1, 0, 0), i.e. theta 90°, phi 0°, purity 1 — and the panel
// renders one sphere per returned vector. This pin holds the server
// half of that contract at the ticket's exact values.

import { test } from "node:test";
import assert from "node:assert/strict";

test("simulateCircuit H|0> returns the equatorial Bloch vector", async () => {
  globalThis._concordSTATE = {};
  const actions = new Map();
  const { default: registerQuantumActions } = await import("../domains/quantum.js");
  registerQuantumActions((domain, action, fn) => actions.set(`${domain}.${action}`, fn));
  const sim = actions.get("quantum.simulateCircuit");
  const r = sim({ actor: { userId: "w" } }, { id: null, data: {}, meta: {} }, {
    circuit: { qubits: 1, gates: [{ gate: "H", targets: [0] }] },
    shots: 16,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.bloch, [
    { qubit: 0, x: 1, y: 0, z: 0, purity: 1, mixed: false },
  ]);
});

test("stepCircuit frames each carry their Bloch vectors", async () => {
  globalThis._concordSTATE = {};
  const actions = new Map();
  const { default: registerQuantumActions } = await import("../domains/quantum.js");
  registerQuantumActions((domain, action, fn) => actions.set(`${domain}.${action}`, fn));
  const step = actions.get("quantum.stepCircuit");
  const r = step({ actor: { userId: "w" } }, { id: null, data: {}, meta: {} }, {
    circuit: { qubits: 1, gates: [{ gate: "H", targets: [0] }] },
  });
  assert.equal(r.ok, true);
  assert.equal(r.result.frames.length, 2);
  assert.equal(r.result.frames[0].bloch[0].z, 1); // INIT |0>
  assert.equal(r.result.frames[1].bloch[0].x, 1); // after H
});
