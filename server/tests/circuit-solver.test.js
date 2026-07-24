/**
 * Cross-System Multi-Physics CAD — DC circuit solver (electrical leg).
 *
 * Per CLAUDE.md's "compute-don't-guess" doctrine: every expected value
 * below is a hand-computed textbook result (voltage divider, series
 * Ohm's law, parallel reciprocal-sum) — never a value pasted from the
 * solver's own output. Where the network is simple enough to check by
 * hand, we do; the tolerance (1e-9) reflects plain double-precision
 * floating-point roundoff in a small (2-4 node) Gaussian elimination —
 * tight enough to catch a real formula bug, loose enough to absorb
 * legitimate FP noise.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { solveCircuit } from "../lib/simulation/circuit-solver.js";

const TOL = 1e-9;

describe("solveCircuit — voltage divider (textbook)", () => {
  // Classic two-resistor voltage divider: V source across R1 (top) + R2
  // (bottom) in series, ground at the bottom rail, node "mid" between
  // R1 and R2. Textbook answer: V(mid) = V_source * R2 / (R1 + R2).
  const V = 12; // volts
  const R1 = 1000; // ohms
  const R2 = 2000; // ohms

  const model = {
    nodes: [{ id: "top" }, { id: "mid" }, { id: "gnd" }],
    elements: [
      { id: "Vs", type: "voltage_source", nodeA: "top", nodeB: "gnd", value: V },
      { id: "R1", type: "resistor", nodeA: "top", nodeB: "mid", value: R1 },
      { id: "R2", type: "resistor", nodeA: "mid", nodeB: "gnd", value: R2 },
    ],
    groundNodeId: "gnd",
  };

  it("solves the midpoint voltage to the textbook divider formula", () => {
    const result = solveCircuit(model);
    assert.equal(result.ok, true);
    const expectedMid = V * (R2 / (R1 + R2)); // = 12 * 2000/3000 = 8V
    assert.ok(Math.abs(expectedMid - 8) < 1e-12, "sanity: hand arithmetic itself is 8V");
    assert.ok(
      Math.abs(result.nodeVoltages.mid - expectedMid) < TOL,
      `expected mid=${expectedMid}, got ${result.nodeVoltages.mid}`
    );
    assert.ok(Math.abs(result.nodeVoltages.top - V) < TOL, "top node is pinned to the source voltage");
    assert.equal(result.nodeVoltages.gnd, 0);
  });

  it("branch currents through R1 and R2 match V/R_total and satisfy KCL at the midpoint", () => {
    const result = solveCircuit(model);
    const iTotal = V / (R1 + R2); // = 12/3000 = 0.004 A = 4 mA
    assert.ok(Math.abs(iTotal - 0.004) < 1e-12, "sanity check on hand arithmetic");
    assert.ok(Math.abs(result.branchCurrents.R1 - iTotal) < TOL);
    assert.ok(Math.abs(result.branchCurrents.R2 - iTotal) < TOL);
    // Series circuit: same current flows through R1 and R2 (KCL at "mid": no other branch).
    assert.ok(Math.abs(result.branchCurrents.R1 - result.branchCurrents.R2) < TOL);
  });

  it("source current equals V/R_total (derived via KCL residual, not read off a variable)", () => {
    const result = solveCircuit(model);
    const iExpected = V / (R1 + R2);
    assert.ok(Math.abs(result.branchCurrents.Vs - iExpected) < TOL,
      `expected source current ${iExpected}, got ${result.branchCurrents.Vs}`);
  });

  it("energy conservation: power delivered by the source equals total power dissipated (real cross-check, not asserted by construction)", () => {
    const result = solveCircuit(model);
    const totalDissipated = result.powerByElement.R1 + result.powerByElement.R2;
    const delivered = result.powerByElement.Vs;
    assert.ok(Math.abs(delivered - totalDissipated) < 1e-9,
      `delivered=${delivered}, dissipated=${totalDissipated}`);
    // And matches the textbook P = V*I_total independently.
    const expectedPower = V * (V / (R1 + R2));
    assert.ok(Math.abs(delivered - expectedPower) < 1e-9);
  });
});

describe("solveCircuit — series resistor network (textbook Ohm's law)", () => {
  // Three resistors in series across a source: total current = V / (R1+R2+R3).
  const V = 24;
  const R1 = 100, R2 = 220, R3 = 330;
  const model = {
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "gnd" }],
    elements: [
      { id: "Vs", type: "voltage_source", nodeA: "a", nodeB: "gnd", value: V },
      { id: "R1", type: "resistor", nodeA: "a", nodeB: "b", value: R1 },
      { id: "R2", type: "resistor", nodeA: "b", nodeB: "c", value: R2 },
      { id: "R3", type: "resistor", nodeA: "c", nodeB: "gnd", value: R3 },
    ],
    groundNodeId: "gnd",
  };

  it("total current matches V / R_total for all three series resistors", () => {
    const result = solveCircuit(model);
    assert.equal(result.ok, true);
    const rTotal = R1 + R2 + R3; // 650 ohms
    const iExpected = V / rTotal; // 24/650 = 0.036923076923076926 A
    assert.ok(Math.abs(iExpected - 0.036923076923076926) < 1e-15, "sanity check");
    for (const key of ["R1", "R2", "R3"]) {
      assert.ok(
        Math.abs(result.branchCurrents[key] - iExpected) < TOL,
        `${key}: expected ${iExpected}, got ${result.branchCurrents[key]}`
      );
    }
  });

  it("node voltages match the running IR-drop from the source", () => {
    const result = solveCircuit(model);
    const i = V / (R1 + R2 + R3);
    assert.ok(Math.abs(result.nodeVoltages.a - V) < TOL);
    assert.ok(Math.abs(result.nodeVoltages.b - (V - i * R1)) < TOL);
    assert.ok(Math.abs(result.nodeVoltages.c - (V - i * R1 - i * R2)) < TOL);
  });
});

describe("solveCircuit — parallel resistor network (textbook reciprocal-sum)", () => {
  // Two resistors in parallel across a source: R_eq = 1 / (1/R1 + 1/R2);
  // branch currents split as V/R1 and V/R2 and must sum to the source current.
  const V = 10;
  const R1 = 100;
  const R2 = 400;
  const model = {
    nodes: [{ id: "top" }, { id: "gnd" }],
    elements: [
      { id: "Vs", type: "voltage_source", nodeA: "top", nodeB: "gnd", value: V },
      { id: "R1", type: "resistor", nodeA: "top", nodeB: "gnd", value: R1 },
      { id: "R2", type: "resistor", nodeA: "top", nodeB: "gnd", value: R2 },
    ],
    groundNodeId: "gnd",
  };

  it("equivalent resistance via the reciprocal-sum formula matches the total source current", () => {
    const result = solveCircuit(model);
    assert.equal(result.ok, true);
    const rEq = 1 / (1 / R1 + 1 / R2); // = 1/(0.01+0.0025) = 80 ohms
    assert.ok(Math.abs(rEq - 80) < 1e-12, "sanity check on hand arithmetic");
    const iTotalExpected = V / rEq; // 10/80 = 0.125 A
    assert.ok(Math.abs(result.branchCurrents.Vs - iTotalExpected) < TOL);
  });

  it("branch currents split correctly and sum to the total source current (KCL)", () => {
    const result = solveCircuit(model);
    const i1Expected = V / R1; // 0.1 A
    const i2Expected = V / R2; // 0.025 A
    assert.ok(Math.abs(result.branchCurrents.R1 - i1Expected) < TOL);
    assert.ok(Math.abs(result.branchCurrents.R2 - i2Expected) < TOL);
    const sum = result.branchCurrents.R1 + result.branchCurrents.R2;
    assert.ok(Math.abs(sum - result.branchCurrents.Vs) < TOL,
      `branch currents (${result.branchCurrents.R1} + ${result.branchCurrents.R2} = ${sum}) must sum to source current ${result.branchCurrents.Vs}`);
  });
});

describe("solveCircuit — current source into a grounded resistor (textbook Ohm's law, no voltage source at all)", () => {
  it("V = I * R for a single current source driving a single resistor to ground", () => {
    const I = 0.002; // 2 mA
    const R = 5000; // ohms
    const model = {
      nodes: [{ id: "n1" }, { id: "gnd" }],
      elements: [
        { id: "Is", type: "current_source", nodeA: "gnd", nodeB: "n1", value: I },
        { id: "R1", type: "resistor", nodeA: "n1", nodeB: "gnd", value: R },
      ],
      groundNodeId: "gnd",
    };
    const result = solveCircuit(model);
    assert.equal(result.ok, true);
    const expectedV = I * R; // 0.002 * 5000 = 10V
    assert.ok(Math.abs(expectedV - 10) < 1e-12, "sanity check");
    assert.ok(Math.abs(result.nodeVoltages.n1 - expectedV) < TOL);
    assert.ok(Math.abs(result.branchCurrents.R1 - I) < TOL, "all injected current must flow through the only resistor");
  });
});

describe("solveCircuit — honest failure cases (never a fabricated numeric result)", () => {
  it("rejects a node with no element touching it at all (genuinely disconnected)", () => {
    const model = {
      nodes: [{ id: "a" }, { id: "gnd" }, { id: "floater" }],
      elements: [
        { id: "Vs", type: "voltage_source", nodeA: "a", nodeB: "gnd", value: 5 },
        { id: "R1", type: "resistor", nodeA: "a", nodeB: "gnd", value: 100 },
      ],
      groundNodeId: "gnd",
    };
    const result = solveCircuit(model);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "disconnected_node");
    assert.equal(result.nodeId, "floater");
    assert.equal(result.nodeVoltages, undefined, "no fabricated voltages on failure");
  });

  it("rejects a resistor mesh with no path to the declared ground node (singular matrix — no absolute reference)", () => {
    // "gnd" exists as a node but NOTHING in `elements` touches it — the
    // rest of the network (a-b-c chain) floats: only voltage DIFFERENCES
    // are determined, never absolute node voltages. The assembled
    // conductance matrix for a resistor mesh with zero ties to ground is
    // a genuine textbook singular (rank-deficient) case, not a bug — this
    // is exactly the case ground references exist to prevent.
    const model = {
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "gnd" }],
      elements: [
        { id: "R1", type: "resistor", nodeA: "a", nodeB: "b", value: 100 },
        { id: "R2", type: "resistor", nodeA: "b", nodeB: "c", value: 200 },
        // "gnd" is a valid node id but is touched by NOTHING, so it is
        // simultaneously the reference node (skipped by the disconnected-
        // node check by design) and completely unconnected to a,b,c.
      ],
      groundNodeId: "gnd",
    };
    const result = solveCircuit(model);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "singular_matrix");
    assert.equal(result.nodeVoltages, undefined);
  });

  it("rejects a floating voltage source (neither terminal is ground) as an honest scope limitation, not a silent wrong answer", () => {
    const model = {
      nodes: [{ id: "a" }, { id: "b" }, { id: "gnd" }],
      elements: [
        { id: "Vs", type: "voltage_source", nodeA: "a", nodeB: "b", value: 5 }, // floating — neither end is gnd
        { id: "R1", type: "resistor", nodeA: "a", nodeB: "gnd", value: 100 },
        { id: "R2", type: "resistor", nodeA: "b", nodeB: "gnd", value: 100 },
      ],
      groundNodeId: "gnd",
    };
    const result = solveCircuit(model);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "floating_voltage_source_unsupported");
  });

  it("rejects an unknown ground node id", () => {
    const result = solveCircuit({
      nodes: [{ id: "a" }, { id: "b" }],
      elements: [{ id: "R1", type: "resistor", nodeA: "a", nodeB: "b", value: 100 }],
      groundNodeId: "not-a-real-node",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "ground_node_not_found");
  });

  it("rejects a non-positive resistor value", () => {
    const result = solveCircuit({
      nodes: [{ id: "a" }, { id: "gnd" }],
      elements: [
        { id: "Vs", type: "voltage_source", nodeA: "a", nodeB: "gnd", value: 5 },
        { id: "R1", type: "resistor", nodeA: "a", nodeB: "gnd", value: 0 },
      ],
      groundNodeId: "gnd",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_resistor_value");
  });

  it("rejects a dangling node reference on an element", () => {
    const result = solveCircuit({
      nodes: [{ id: "a" }, { id: "gnd" }],
      elements: [{ id: "R1", type: "resistor", nodeA: "a", nodeB: "does-not-exist", value: 100 }],
      groundNodeId: "gnd",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_node_reference");
  });

  it("rejects non-finite element values (NaN/Infinity) instead of propagating them", () => {
    // The generic finiteness check runs before the resistor-specific
    // positivity check, so Infinity/NaN surface as invalid_element_value
    // (still an honest, real reason — never silently coerced to a number).
    const result = solveCircuit({
      nodes: [{ id: "a" }, { id: "gnd" }],
      elements: [{ id: "R1", type: "resistor", nodeA: "a", nodeB: "gnd", value: Infinity }],
      groundNodeId: "gnd",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_element_value");
  });
});
