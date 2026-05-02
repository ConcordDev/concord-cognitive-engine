/**
 * Quantum Circuit Simulator — Statevector simulation
 *
 * Deterministic (no randomness in simulation itself).
 * measureCircuit() uses weighted random collapse.
 * Supports: H, X, Y, Z, S, T, Rx, Ry, Rz, CNOT, CZ, SWAP, Toffoli
 *
 * No external dependencies. Pure JavaScript complex arithmetic.
 */

// ── Complex Number Ops ────────────────────────────────────────────────────────

const c = {
  add:  ([ar, ai], [br, bi]) => [ar + br, ai + bi],
  sub:  ([ar, ai], [br, bi]) => [ar - br, ai - bi],
  mul:  ([ar, ai], [br, bi]) => [ar * br - ai * bi, ar * bi + ai * br],
  scale: ([r, i], s) => [r * s, i * s],
  abs2: ([r, i]) => r * r + i * i,
  abs:  ([r, i]) => Math.sqrt(r * r + i * i),
  conj: ([r, i]) => [r, -i],
};

const SQRT2_INV = 1 / Math.sqrt(2);

// ── Single-Qubit Gate Matrices (2×2 complex) ─────────────────────────────────
// Each gate is [[a,b],[c,d]] where each entry is [re, im]

const GATES = {
  I:    [[[1, 0], [0, 0]], [[0, 0], [1, 0]]],
  H:    [[[SQRT2_INV, 0], [SQRT2_INV, 0]], [[SQRT2_INV, 0], [-SQRT2_INV, 0]]],
  X:    [[[0, 0], [1, 0]], [[1, 0], [0, 0]]],
  Y:    [[[0, 0], [0, -1]], [[0, 1], [0, 0]]],
  Z:    [[[1, 0], [0, 0]], [[0, 0], [-1, 0]]],
  S:    [[[1, 0], [0, 0]], [[0, 0], [0, 1]]],   // Phase gate e^(iπ/2)
  Sdg:  [[[1, 0], [0, 0]], [[0, 0], [0, -1]]],  // S†
  T:    [[[1, 0], [0, 0]], [[0, 0], [SQRT2_INV, SQRT2_INV]]],
  Tdg:  [[[1, 0], [0, 0]], [[0, 0], [SQRT2_INV, -SQRT2_INV]]],
};

function rotGate(axis, theta) {
  const cos = Math.cos(theta / 2);
  const sin = Math.sin(theta / 2);
  if (axis === 'x') return [[[cos, 0], [0, -sin]], [[0, -sin], [cos, 0]]];
  if (axis === 'y') return [[[cos, 0], [-sin, 0]], [[sin, 0], [cos, 0]]];
  // z
  return [[[cos, -sin], [0, 0]], [[0, 0], [cos, sin]]];
}

// ── Statevector Helpers ───────────────────────────────────────────────────────

function zeroState(numQubits) {
  const size = 1 << numQubits;
  const sv   = new Array(size).fill(null).map(() => [0, 0]);
  sv[0]      = [1, 0];
  return sv;
}

function applyGateSingle(sv, gate, target, numQubits) {
  const size  = sv.length;
  const out   = sv.slice();
  const tBit  = numQubits - 1 - target; // qubit 0 = most significant bit

  for (let i = 0; i < size; i++) {
    if (i & (1 << tBit)) continue; // process pairs
    const j = i | (1 << tBit);
    const a = sv[i], b = sv[j];
    out[i] = c.add(c.mul(gate[0][0], a), c.mul(gate[0][1], b));
    out[j] = c.add(c.mul(gate[1][0], a), c.mul(gate[1][1], b));
  }
  return out;
}

function applyCNOT(sv, control, target, numQubits) {
  const size = sv.length;
  const out  = sv.slice();
  const cBit = numQubits - 1 - control;
  const tBit = numQubits - 1 - target;

  for (let i = 0; i < size; i++) {
    if (!(i & (1 << cBit))) continue; // control must be |1>
    if (i & (1 << tBit))   continue; // process |c=1, t=0> pairs
    const j = i | (1 << tBit);       // flip target bit
    out[i] = sv[j];
    out[j] = sv[i];
  }
  return out;
}

function applyCZ(sv, control, target, numQubits) {
  const size = sv.length;
  const out  = sv.slice();
  const cBit = numQubits - 1 - control;
  const tBit = numQubits - 1 - target;

  for (let i = 0; i < size; i++) {
    if ((i & (1 << cBit)) && (i & (1 << tBit))) {
      out[i] = c.scale(sv[i], -1);
    }
  }
  return out;
}

function applySWAP(sv, q1, q2, numQubits) {
  const size = sv.length;
  const out  = sv.slice();
  const b1   = numQubits - 1 - q1;
  const b2   = numQubits - 1 - q2;

  for (let i = 0; i < size; i++) {
    const bit1 = (i >> b1) & 1;
    const bit2 = (i >> b2) & 1;
    if (bit1 !== bit2) {
      const j = i ^ (1 << b1) ^ (1 << b2);
      if (i < j) { out[i] = sv[j]; out[j] = sv[i]; }
    }
  }
  return out;
}

function applyToffoli(sv, c1, c2, target, numQubits) {
  const size = sv.length;
  const out  = sv.slice();
  const cb1  = numQubits - 1 - c1;
  const cb2  = numQubits - 1 - c2;
  const tBit = numQubits - 1 - target;

  for (let i = 0; i < size; i++) {
    if (!(i & (1 << cb1)) || !(i & (1 << cb2))) continue;
    if (i & (1 << tBit)) continue;
    const j = i | (1 << tBit);
    out[i] = sv[j]; out[j] = sv[i];
  }
  return out;
}

// ── Public: Apply Gate ────────────────────────────────────────────────────────

export function applyGate(statevector, gateSpec, numQubits) {
  const { type, target, control, control2, theta } = gateSpec;

  switch (type.toUpperCase()) {
    case 'H':   return applyGateSingle(statevector, GATES.H, target, numQubits);
    case 'X':   return applyGateSingle(statevector, GATES.X, target, numQubits);
    case 'Y':   return applyGateSingle(statevector, GATES.Y, target, numQubits);
    case 'Z':   return applyGateSingle(statevector, GATES.Z, target, numQubits);
    case 'S':   return applyGateSingle(statevector, GATES.S, target, numQubits);
    case 'SDG': return applyGateSingle(statevector, GATES.Sdg, target, numQubits);
    case 'T':   return applyGateSingle(statevector, GATES.T, target, numQubits);
    case 'TDG': return applyGateSingle(statevector, GATES.Tdg, target, numQubits);
    case 'RX':  return applyGateSingle(statevector, rotGate('x', theta ?? 0), target, numQubits);
    case 'RY':  return applyGateSingle(statevector, rotGate('y', theta ?? 0), target, numQubits);
    case 'RZ':  return applyGateSingle(statevector, rotGate('z', theta ?? 0), target, numQubits);
    case 'CNOT': return applyCNOT(statevector, control, target, numQubits);
    case 'CX':   return applyCNOT(statevector, control, target, numQubits);
    case 'CZ':   return applyCZ(statevector, control, target, numQubits);
    case 'SWAP': return applySWAP(statevector, control, target, numQubits);
    case 'CCX':
    case 'TOFFOLI': return applyToffoli(statevector, control, control2 ?? 0, target, numQubits);
    case 'I':   return statevector.slice();
    default:
      throw new Error(`Unknown gate type: ${type}`);
  }
}

// ── Shannon Entropy ───────────────────────────────────────────────────────────

function entropy(probs) {
  let h = 0;
  for (const p of probs) {
    if (p > 1e-12) h -= p * Math.log2(p);
  }
  return h;
}

// ── Public: Simulate Circuit ──────────────────────────────────────────────────

export function simulateCircuit({ qubits = 1, gates = [] }) {
  if (qubits < 1 || qubits > 20) throw new Error('qubits must be 1–20');

  let sv = zeroState(qubits);
  const gateLog = [];

  for (const gate of gates) {
    try {
      sv = applyGate(sv, gate, qubits);
      gateLog.push({ gate: gate.type, ok: true });
    } catch (e) {
      gateLog.push({ gate: gate.type, ok: false, error: e.message });
    }
  }

  const size  = sv.length;
  const probs = sv.map(amp => c.abs2(amp));
  const total = probs.reduce((s, p) => s + p, 0);
  const normProbs = probs.map(p => p / (total || 1));

  const stateProbabilities = normProbs.map((p, i) => ({
    state: i.toString(2).padStart(qubits, '0'),
    probability: parseFloat(p.toFixed(6)),
    amplitude: {
      re: parseFloat(sv[i][0].toFixed(6)),
      im: parseFloat(sv[i][1].toFixed(6)),
    },
  })).filter(s => s.probability > 1e-9);

  return {
    ok: true,
    qubits,
    gateCount: gates.length,
    stateProbabilities,
    statevector: sv.map(([r, i]) => [parseFloat(r.toFixed(8)), parseFloat(i.toFixed(8))]),
    entropy: parseFloat(entropy(normProbs).toFixed(4)),
    gateLog,
  };
}

// ── Public: Measure Circuit ───────────────────────────────────────────────────

export function measureCircuit(statevector, shots = 1) {
  const probs = statevector.map(amp => c.abs2(amp));
  const total = probs.reduce((s, p) => s + p, 0);
  const norm  = probs.map(p => p / (total || 1));
  const numQubits = Math.round(Math.log2(statevector.length));

  const results = {};
  for (let s = 0; s < shots; s++) {
    let r = Math.random(), cumul = 0;
    let outcome = statevector.length - 1;
    for (let i = 0; i < norm.length; i++) {
      cumul += norm[i];
      if (r <= cumul) { outcome = i; break; }
    }
    const bitStr = outcome.toString(2).padStart(numQubits, '0');
    results[bitStr] = (results[bitStr] || 0) + 1;
  }

  return {
    ok: true,
    shots,
    results,
    mostLikely: Object.entries(results).sort((a, b) => b[1] - a[1])[0]?.[0],
  };
}

// ── Public: Circuit Depth ─────────────────────────────────────────────────────

export function circuitDepth(gates) {
  // Critical path: per-qubit last-used cycle
  const qubitCycle = {};
  let maxDepth = 0;

  for (const gate of gates) {
    const qubits = [gate.target, gate.control, gate.control2].filter(q => q !== undefined);
    const cycle  = Math.max(...qubits.map(q => qubitCycle[q] || 0)) + 1;
    qubits.forEach(q => { qubitCycle[q] = cycle; });
    if (cycle > maxDepth) maxDepth = cycle;
  }

  return maxDepth;
}

// ── Public: Analyze Circuit ───────────────────────────────────────────────────

export function analyzeCircuit({ qubits = 1, gates = [] }) {
  const sim     = simulateCircuit({ qubits, gates });
  const depth   = circuitDepth(gates);
  const gateFreq = {};
  for (const g of gates) gateFreq[g.type] = (gateFreq[g.type] || 0) + 1;

  const singleQubitGates = ['H', 'X', 'Y', 'Z', 'S', 'T', 'RX', 'RY', 'RZ', 'SDG', 'TDG', 'I'];
  const twoQubitGates    = ['CNOT', 'CX', 'CZ', 'SWAP'];
  const threeQubitGates  = ['CCX', 'TOFFOLI'];

  return {
    ...sim,
    depth,
    gateCount: gates.length,
    gateFrequency: gateFreq,
    singleQubitCount: gates.filter(g => singleQubitGates.includes(g.type?.toUpperCase())).length,
    twoQubitCount:    gates.filter(g => twoQubitGates.includes(g.type?.toUpperCase())).length,
    threeQubitCount:  gates.filter(g => threeQubitGates.includes(g.type?.toUpperCase())).length,
  };
}
