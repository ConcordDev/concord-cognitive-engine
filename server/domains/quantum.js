// server/domains/quantum.js
// Domain actions for quantum computing: a REAL gate-based statevector simulator
// (complex amplitude vector + unitary gate application — no LLM in the math
// path), circuit analysis, error/noise modelling, QASM import/export,
// algorithm templates, step-through execution, Bloch-vector readout, and
// persistent per-user saved circuits.

export default function registerQuantumActions(registerLensAction) {
  // ─── Persistent per-user circuit store ──────────────────────────────
  function getQState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.quantumLens) STATE.quantumLens = {};
    if (!(STATE.quantumLens.circuits instanceof Map)) STATE.quantumLens.circuits = new Map(); // userId -> Array
    return STATE.quantumLens;
  }
  function saveQ() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const qId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const qActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const qUserCircuits = (s, userId) => { if (!s.circuits.has(userId)) s.circuits.set(userId, []); return s.circuits.get(userId); };

  // ─── Gate metadata + 2x2 unitary builders ───────────────────────────
  // A single-qubit gate matrix is [[a,b],[c,d]] with each entry [re, im].
  const SQ2 = 1 / Math.SQRT2;
  function staticGate(name, label, m) { return { name, label, qubits: 1, matrix: m }; }

  // matrix entries are objects {re, im}
  const C = (re, im = 0) => ({ re, im });

  const STATIC_GATES = {
    H: staticGate("H", "Hadamard", [[C(SQ2), C(SQ2)], [C(SQ2), C(-SQ2)]]),
    X: staticGate("X", "Pauli-X", [[C(0), C(1)], [C(1), C(0)]]),
    Y: staticGate("Y", "Pauli-Y", [[C(0), C(0)], [C(0), C(0)]]), // overwritten below
    Z: staticGate("Z", "Pauli-Z", [[C(1), C(0)], [C(0), C(-1)]]),
    S: staticGate("S", "Phase (S)", [[C(1), C(0)], [C(0), C(0, 1)]]),
    SDG: staticGate("SDG", "S-dagger", [[C(1), C(0)], [C(0), C(0, -1)]]),
    T: staticGate("T", "T-gate", [[C(1), C(0)], [C(0), C(SQ2, SQ2)]]),
    TDG: staticGate("TDG", "T-dagger", [[C(1), C(0)], [C(0), C(SQ2, -SQ2)]]),
    I: staticGate("I", "Identity", [[C(1), C(0)], [C(0), C(1)]]),
  };
  STATIC_GATES.Y.matrix = [[C(0), C(0, -1)], [C(0, 1), C(0)]];

  // Two/three-qubit & measurement gates (handled procedurally in applyCircuit)
  const MULTI_GATES = {
    CNOT: { name: "CNOT", label: "CNOT", qubits: 2 },
    CX: { name: "CX", label: "CNOT", qubits: 2 },
    CZ: { name: "CZ", label: "Controlled-Z", qubits: 2 },
    SWAP: { name: "SWAP", label: "SWAP", qubits: 2 },
    TOFFOLI: { name: "TOFFOLI", label: "Toffoli (CCX)", qubits: 3 },
    CCX: { name: "CCX", label: "Toffoli (CCX)", qubits: 3 },
    MEASURE: { name: "MEASURE", label: "Measure", qubits: 1 },
  };
  // Parametric single-qubit gates: RX, RY, RZ, P (phase), U
  const PARAM_GATES = ["RX", "RY", "RZ", "P", "U1"];

  function gateLibrary() {
    const lib = [];
    for (const k of Object.keys(STATIC_GATES)) {
      const g = STATIC_GATES[k];
      lib.push({ id: g.name, label: g.label, qubits: 1, parametric: false });
    }
    for (const k of ["RX", "RY", "RZ", "P"]) {
      lib.push({ id: k, label: `${k} rotation`, qubits: 1, parametric: true, param: "theta" });
    }
    for (const k of ["CNOT", "CZ", "SWAP", "TOFFOLI", "MEASURE"]) {
      const g = MULTI_GATES[k] || { label: "Measure", qubits: 1 };
      lib.push({ id: k, label: g.label, qubits: g.qubits, parametric: false });
    }
    return lib;
  }

  // Build a 2x2 matrix for a parametric rotation gate.
  function paramMatrix(gateId, theta) {
    const t = Number(theta) || 0;
    const c = Math.cos(t / 2), s = Math.sin(t / 2);
    switch (gateId) {
      case "RX": return [[C(c), C(0, -s)], [C(0, -s), C(c)]];
      case "RY": return [[C(c), C(-s)], [C(s), C(c)]];
      case "RZ": return [[C(Math.cos(-t / 2), Math.sin(-t / 2)), C(0)],
        [C(0), C(Math.cos(t / 2), Math.sin(t / 2))]];
      case "P": case "U1": return [[C(1), C(0)], [C(0), C(Math.cos(t), Math.sin(t))]];
      default: return null;
    }
  }

  function resolveSingleMatrix(gateId, step) {
    if (STATIC_GATES[gateId]) return STATIC_GATES[gateId].matrix;
    if (PARAM_GATES.includes(gateId)) {
      const theta = step?.params?.theta ?? step?.theta ?? step?.angle ?? 0;
      return paramMatrix(gateId, theta);
    }
    return null;
  }

  // ─── Core statevector engine ────────────────────────────────────────
  // Returns { ok, stateReal, stateImag, dim, nQubits, gateCount, steps, error }
  // steps[] holds a deep snapshot after each gate when `capture` is true.
  function applyCircuit(circuit, opts = {}) {
    const nQubits = Math.max(1, Math.floor(Number(circuit?.qubits) || 1));
    if (nQubits > 12) return { ok: false, error: "Simulation limited to 12 qubits (2^12 amplitudes)." };
    const dim = 1 << nQubits;
    const sr = new Float64Array(dim);
    const si = new Float64Array(dim);
    sr[0] = 1;
    const gates = Array.isArray(circuit?.gates) ? circuit.gates : [];
    const capture = !!opts.capture;
    const steps = [];
    let gateCount = 0;
    const bitMask = (q) => 1 << (nQubits - 1 - q);

    const applySingle = (matrix, target) => {
      const [[a, b], [c, d]] = matrix;
      for (let i = 0; i < dim; i++) {
        if ((i & bitMask(target)) === 0) {
          const j = i | bitMask(target);
          const re0 = sr[i], im0 = si[i], re1 = sr[j], im1 = si[j];
          // new |0⟩ = a*amp0 + b*amp1
          sr[i] = (a.re * re0 - a.im * im0) + (b.re * re1 - b.im * im1);
          si[i] = (a.re * im0 + a.im * re0) + (b.re * im1 + b.im * re1);
          // new |1⟩ = c*amp0 + d*amp1
          sr[j] = (c.re * re0 - c.im * im0) + (d.re * re1 - d.im * im1);
          si[j] = (c.re * im0 + c.im * re0) + (d.re * im1 + d.im * re1);
        }
      }
    };

    for (const step of gates) {
      const gateId = String(step?.gate || "").toUpperCase();
      if (!gateId) continue;
      const targets = Array.isArray(step.targets) ? step.targets
        : (step.target != null ? [step.target] : []);
      const controls = Array.isArray(step.controls) ? step.controls : [];

      if (gateId === "MEASURE" || gateId === "M" || gateId === "BARRIER") {
        // measurement / barrier do not alter the statevector in this model
        gateCount++;
        if (capture) steps.push({ gate: gateId, real: Array.from(sr), imag: Array.from(si) });
        continue;
      }

      if (gateId === "CNOT" || gateId === "CX") {
        const ctrl = controls[0] ?? targets[0] ?? 0;
        const tgt = targets.length >= 2 ? targets[1] : (targets[0] ?? 1);
        for (let i = 0; i < dim; i++) {
          if (i & bitMask(ctrl)) {
            const j = i ^ bitMask(tgt);
            if (j > i) { [sr[i], sr[j]] = [sr[j], sr[i]]; [si[i], si[j]] = [si[j], si[i]]; }
          }
        }
        gateCount++;
      } else if (gateId === "CZ") {
        const ctrl = controls[0] ?? targets[0] ?? 0;
        const tgt = targets.length >= 2 ? targets[1] : (targets[0] ?? 1);
        for (let i = 0; i < dim; i++) {
          if ((i & bitMask(ctrl)) && (i & bitMask(tgt))) { sr[i] = -sr[i]; si[i] = -si[i]; }
        }
        gateCount++;
      } else if (gateId === "SWAP") {
        const q1 = targets[0] ?? 0, q2 = targets[1] ?? 1;
        for (let i = 0; i < dim; i++) {
          const b1 = (i & bitMask(q1)) ? 1 : 0, b2 = (i & bitMask(q2)) ? 1 : 0;
          if (b1 !== b2) {
            const j = i ^ bitMask(q1) ^ bitMask(q2);
            if (j > i) { [sr[i], sr[j]] = [sr[j], sr[i]]; [si[i], si[j]] = [si[j], si[i]]; }
          }
        }
        gateCount++;
      } else if (gateId === "TOFFOLI" || gateId === "CCX") {
        const cs = controls.length >= 2 ? controls : targets.slice(0, 2);
        const tgt = targets.length >= 3 ? targets[2]
          : (controls.length >= 2 ? targets[0] : targets[2]) ?? (targets[targets.length - 1] ?? 2);
        const c0 = cs[0] ?? 0, c1 = cs[1] ?? 1;
        for (let i = 0; i < dim; i++) {
          if ((i & bitMask(c0)) && (i & bitMask(c1))) {
            const j = i ^ bitMask(tgt);
            if (j > i) { [sr[i], sr[j]] = [sr[j], sr[i]]; [si[i], si[j]] = [si[j], si[i]]; }
          }
        }
        gateCount++;
      } else {
        // single-qubit (static or parametric), optionally controlled
        const matrix = resolveSingleMatrix(gateId, step);
        if (!matrix) continue; // skip unknown gates
        const tgt = targets[0] ?? 0;
        if (controls.length > 0) {
          // generic controlled single-qubit gate: apply only on basis states
          // where every control bit is 1
          const ctrlMask = controls.reduce((m, q) => m | bitMask(q), 0);
          const [[a, b], [c, d]] = matrix;
          for (let i = 0; i < dim; i++) {
            if ((i & ctrlMask) === ctrlMask && (i & bitMask(tgt)) === 0) {
              const j = i | bitMask(tgt);
              if ((j & ctrlMask) !== ctrlMask) continue;
              const re0 = sr[i], im0 = si[i], re1 = sr[j], im1 = si[j];
              sr[i] = (a.re * re0 - a.im * im0) + (b.re * re1 - b.im * im1);
              si[i] = (a.re * im0 + a.im * re0) + (b.re * im1 + b.im * re1);
              sr[j] = (c.re * re0 - c.im * im0) + (d.re * re1 - d.im * im1);
              si[j] = (c.re * im0 + c.im * re0) + (d.re * im1 + d.im * re1);
            }
          }
        } else {
          applySingle(matrix, tgt);
        }
        gateCount++;
      }
      if (capture) steps.push({ gate: gateId, real: Array.from(sr), imag: Array.from(si) });
    }
    return { ok: true, stateReal: sr, stateImag: si, dim, nQubits, gateCount, steps };
  }

  // Probability table for a statevector.
  function probabilityTable(sr, si, nQubits, limit = 64) {
    const dim = 1 << nQubits;
    const probs = [];
    for (let i = 0; i < dim; i++) {
      const p = sr[i] * sr[i] + si[i] * si[i];
      if (p > 1e-12) {
        probs.push({
          index: i,
          state: i.toString(2).padStart(nQubits, "0"),
          probability: Math.round(p * 1e8) / 1e8,
          amplitude: { re: Math.round(sr[i] * 1e6) / 1e6, im: Math.round(si[i] * 1e6) / 1e6 },
        });
      }
    }
    probs.sort((a, b) => b.probability - a.probability);
    return probs.slice(0, limit);
  }

  // Shannon entropy of the measurement distribution.
  function distributionEntropy(probs) {
    let h = 0;
    for (const p of probs) if (p.probability > 0) h -= p.probability * Math.log2(p.probability);
    return Math.round(h * 1e4) / 1e4;
  }

  // Single-qubit Bloch vector from the full statevector (reduced density matrix).
  function blochVectors(sr, si, nQubits) {
    const dim = 1 << nQubits;
    const out = [];
    for (let q = 0; q < nQubits; q++) {
      const mask = 1 << (nQubits - 1 - q);
      // reduced density matrix entries
      let r00 = 0, r11 = 0, r01re = 0, r01im = 0;
      for (let i = 0; i < dim; i++) {
        const partner = i | mask;
        if ((i & mask) === 0) {
          r00 += sr[i] * sr[i] + si[i] * si[i];
          // ρ01 = Σ amp(i_with_0) * conj(amp(i_with_1))
          r01re += sr[i] * sr[partner] + si[i] * si[partner];
          r01im += si[i] * sr[partner] - sr[i] * si[partner];
        } else {
          r11 += sr[i] * sr[i] + si[i] * si[i];
        }
      }
      const x = 2 * r01re;
      const y = 2 * r01im;
      const z = r00 - r11;
      const purity = Math.sqrt(x * x + y * y + z * z);
      out.push({
        qubit: q,
        x: Math.round(x * 1e4) / 1e4,
        y: Math.round(y * 1e4) / 1e4,
        z: Math.round(z * 1e4) / 1e4,
        purity: Math.round(purity * 1e4) / 1e4,
        mixed: purity < 0.999,
      });
    }
    return out;
  }

  // ─── Algorithm templates (starter circuits) ─────────────────────────
  function buildTemplate(id, n) {
    const tid = String(id || "").toLowerCase();
    if (tid === "bell" || tid === "entanglement") {
      return {
        name: "Bell State (Φ+)",
        qubits: 2,
        gates: [{ gate: "H", targets: [0] }, { gate: "CNOT", controls: [0], targets: [0, 1] }],
      };
    }
    if (tid === "ghz") {
      const q = Math.max(3, Math.min(8, Number(n) || 3));
      const gates = [{ gate: "H", targets: [0] }];
      for (let i = 0; i < q - 1; i++) gates.push({ gate: "CNOT", controls: [i], targets: [i, i + 1] });
      return { name: `GHZ State (${q} qubits)`, qubits: q, gates };
    }
    if (tid === "qft") {
      const q = Math.max(2, Math.min(6, Number(n) || 3));
      const gates = [];
      for (let i = 0; i < q; i++) {
        gates.push({ gate: "H", targets: [i] });
        for (let j = i + 1; j < q; j++) {
          gates.push({ gate: "P", controls: [j], targets: [i], params: { theta: Math.PI / (1 << (j - i)) } });
        }
      }
      for (let i = 0; i < Math.floor(q / 2); i++) {
        gates.push({ gate: "SWAP", targets: [i, q - 1 - i] });
      }
      return { name: `Quantum Fourier Transform (${q} qubits)`, qubits: q, gates };
    }
    if (tid === "grover") {
      // 2-qubit Grover searching |11⟩
      return {
        name: "Grover Search (2 qubits, marks |11⟩)",
        qubits: 2,
        gates: [
          { gate: "H", targets: [0] }, { gate: "H", targets: [1] },
          { gate: "CZ", controls: [0], targets: [0, 1] },
          { gate: "H", targets: [0] }, { gate: "H", targets: [1] },
          { gate: "X", targets: [0] }, { gate: "X", targets: [1] },
          { gate: "CZ", controls: [0], targets: [0, 1] },
          { gate: "X", targets: [0] }, { gate: "X", targets: [1] },
          { gate: "H", targets: [0] }, { gate: "H", targets: [1] },
        ],
      };
    }
    if (tid === "teleport" || tid === "teleportation") {
      return {
        name: "Quantum Teleportation",
        qubits: 3,
        gates: [
          { gate: "H", targets: [0] },
          { gate: "H", targets: [1] }, { gate: "CNOT", controls: [1], targets: [1, 2] },
          { gate: "CNOT", controls: [0], targets: [0, 1] },
          { gate: "H", targets: [0] },
          { gate: "MEASURE", targets: [0] }, { gate: "MEASURE", targets: [1] },
          { gate: "CNOT", controls: [1], targets: [1, 2] },
          { gate: "CZ", controls: [0], targets: [0, 2] },
        ],
      };
    }
    if (tid === "deutsch") {
      return {
        name: "Deutsch-Jozsa (balanced oracle)",
        qubits: 2,
        gates: [
          { gate: "X", targets: [1] },
          { gate: "H", targets: [0] }, { gate: "H", targets: [1] },
          { gate: "CNOT", controls: [0], targets: [0, 1] },
          { gate: "H", targets: [0] },
          { gate: "MEASURE", targets: [0] },
        ],
      };
    }
    if (tid === "superposition") {
      const q = Math.max(1, Math.min(8, Number(n) || 3));
      return { name: `Uniform Superposition (${q} qubits)`, qubits: q, gates: Array.from({ length: q }, (_, i) => ({ gate: "H", targets: [i] })) };
    }
    return null;
  }
  const TEMPLATE_IDS = ["bell", "ghz", "qft", "grover", "teleport", "deutsch", "superposition"];

  // ─── QASM import / export ───────────────────────────────────────────
  function circuitToQASM(circuit) {
    const n = Math.max(1, Math.floor(Number(circuit?.qubits) || 1));
    const lines = ["OPENQASM 2.0;", 'include "qelib1.inc";', `qreg q[${n}];`, `creg c[${n}];`];
    for (const step of (circuit?.gates || [])) {
      const g = String(step?.gate || "").toUpperCase();
      const t = Array.isArray(step.targets) ? step.targets : (step.target != null ? [step.target] : []);
      const ctrl = Array.isArray(step.controls) ? step.controls : [];
      const theta = step?.params?.theta ?? step?.theta;
      const qr = (i) => `q[${i}]`;
      if (g === "MEASURE" || g === "M") { lines.push(`measure ${qr(t[0] ?? 0)} -> c[${t[0] ?? 0}];`); continue; }
      if (g === "CNOT" || g === "CX") { lines.push(`cx ${qr(ctrl[0] ?? t[0])},${qr(t[1] ?? t[0])};`); continue; }
      if (g === "CZ") { lines.push(`cz ${qr(ctrl[0] ?? t[0])},${qr(t[1] ?? t[0])};`); continue; }
      if (g === "SWAP") { lines.push(`swap ${qr(t[0])},${qr(t[1])};`); continue; }
      if (g === "TOFFOLI" || g === "CCX") {
        const cs = ctrl.length >= 2 ? ctrl : t.slice(0, 2);
        lines.push(`ccx ${qr(cs[0])},${qr(cs[1])},${qr(t[t.length - 1])};`); continue;
      }
      if (["RX", "RY", "RZ", "P"].includes(g)) {
        const op = g === "P" ? "p" : g.toLowerCase();
        lines.push(`${op}(${theta ?? 0}) ${qr(t[0] ?? 0)};`); continue;
      }
      if (STATIC_GATES[g]) { lines.push(`${g.toLowerCase()} ${qr(t[0] ?? 0)};`); continue; }
    }
    return lines.join("\n");
  }

  function qasmToCircuit(qasm) {
    const text = String(qasm || "");
    let qubits = 1;
    const gates = [];
    const lines = text.split(/[;\n]/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^(OPENQASM|include|creg)/i.test(line)) continue;
      const qreg = line.match(/^qreg\s+\w+\[(\d+)\]/i);
      if (qreg) { qubits = Math.max(qubits, parseInt(qreg[1], 10)); continue; }
      const meas = line.match(/^measure\s+\w+\[(\d+)\]/i);
      if (meas) { gates.push({ gate: "MEASURE", targets: [parseInt(meas[1], 10)] }); continue; }
      // parametric: op(theta) q[i]
      const param = line.match(/^(rx|ry|rz|p|u1)\s*\(([^)]+)\)\s+\w+\[(\d+)\]/i);
      if (param) {
        gates.push({ gate: param[1].toUpperCase(), targets: [parseInt(param[3], 10)], params: { theta: Number(param[2]) || 0 } });
        continue;
      }
      // two-qubit: cx q[a],q[b]
      const two = line.match(/^(cx|cz|swap)\s+\w+\[(\d+)\]\s*,\s*\w+\[(\d+)\]/i);
      if (two) {
        const op = two[1].toLowerCase();
        const a = parseInt(two[2], 10), b = parseInt(two[3], 10);
        if (op === "cx") gates.push({ gate: "CNOT", controls: [a], targets: [a, b] });
        else if (op === "cz") gates.push({ gate: "CZ", controls: [a], targets: [a, b] });
        else gates.push({ gate: "SWAP", targets: [a, b] });
        continue;
      }
      const ccx = line.match(/^ccx\s+\w+\[(\d+)\]\s*,\s*\w+\[(\d+)\]\s*,\s*\w+\[(\d+)\]/i);
      if (ccx) {
        gates.push({ gate: "TOFFOLI", controls: [parseInt(ccx[1], 10), parseInt(ccx[2], 10)], targets: [parseInt(ccx[1], 10), parseInt(ccx[2], 10), parseInt(ccx[3], 10)] });
        continue;
      }
      // single-qubit static: h q[i]
      const single = line.match(/^(h|x|y|z|s|sdg|t|tdg|id)\s+\w+\[(\d+)\]/i);
      if (single) {
        const id = single[1].toUpperCase() === "ID" ? "I" : single[1].toUpperCase();
        gates.push({ gate: id, targets: [parseInt(single[2], 10)] });
        continue;
      }
    }
    return { qubits: Math.max(1, qubits), gates };
  }

  // ─── Noise model presets ────────────────────────────────────────────
  const NOISE_PRESETS = {
    ideal: { label: "Ideal (noiseless)", t1: 1e9, t2: 1e9, gateErrorRate: 0, twoQubitGateError: 0, readoutError: 0, gateTime: 0.05 },
    ibm_eagle: { label: "IBM Eagle (127q)", t1: 120, t2: 90, gateErrorRate: 0.0003, twoQubitGateError: 0.008, readoutError: 0.015, gateTime: 0.05 },
    ibm_heron: { label: "IBM Heron (133q)", t1: 200, t2: 150, gateErrorRate: 0.0002, twoQubitGateError: 0.004, readoutError: 0.01, gateTime: 0.04 },
    superconducting: { label: "Generic superconducting", t1: 80, t2: 60, gateErrorRate: 0.001, twoQubitGateError: 0.012, readoutError: 0.02, gateTime: 0.06 },
    trapped_ion: { label: "Trapped ion", t1: 10000, t2: 1000, gateErrorRate: 0.0001, twoQubitGateError: 0.003, readoutError: 0.005, gateTime: 10 },
  };

  // ─── Macro: gateLibrary ─────────────────────────────────────────────
  registerLensAction("quantum", "gateLibrary", (_ctx, _artifact, _params) => {
    try {
      return { ok: true, result: { gates: gateLibrary(), templates: TEMPLATE_IDS, noisePresets: Object.keys(NOISE_PRESETS) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Macro: simulateCircuit ─────────────────────────────────────────
  registerLensAction("quantum", "simulateCircuit", (_ctx, artifact, params) => {
    try {
      const circuit = params?.circuit || artifact?.data?.circuit;
      if (!circuit) return { ok: false, error: "No circuit data. Expected { qubits, gates }." };
      const sim = applyCircuit(circuit);
      if (!sim.ok) return { ok: false, error: sim.error };
      const { stateReal, stateImag, nQubits, gateCount } = sim;
      const probs = probabilityTable(stateReal, stateImag, nQubits);
      const entropy = distributionEntropy(probs);
      const shots = Math.max(1, Math.min(8192, Math.floor(Number(params?.shots) || 1024)));
      const counts = {};
      for (let s = 0; s < shots; s++) {
        let r = Math.random();
        for (const p of probs) { r -= p.probability; if (r <= 0) { counts[p.state] = (counts[p.state] || 0) + 1; break; } }
      }
      if (artifact?.data) artifact.data.lastSimulation = { timestamp: new Date().toISOString(), gatesApplied: gateCount, topState: probs[0] || null };
      return {
        ok: true,
        result: {
          qubits: nQubits,
          gatesApplied: gateCount,
          circuitDepth: (circuit.gates || []).length,
          statevector: probs.slice(0, 32),
          measurements: { shots, counts },
          bloch: blochVectors(stateReal, stateImag, nQubits),
          entropy,
          maxEntanglement: entropy > 0.9,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Macro: stepCircuit (step-through execution) ─────────────────────
  registerLensAction("quantum", "stepCircuit", (_ctx, artifact, params) => {
    try {
      const circuit = params?.circuit || artifact?.data?.circuit;
      if (!circuit) return { ok: false, error: "No circuit data." };
      const sim = applyCircuit(circuit, { capture: true });
      if (!sim.ok) return { ok: false, error: sim.error };
      const { nQubits } = sim;
      const frames = [];
      // initial frame |000…0⟩
      const initR = new Float64Array(1 << nQubits); initR[0] = 1;
      const initI = new Float64Array(1 << nQubits);
      frames.push({
        step: 0, gate: "INIT",
        statevector: probabilityTable(initR, initI, nQubits, 32),
        bloch: blochVectors(initR, initI, nQubits),
      });
      sim.steps.forEach((snap, idx) => {
        const sr = Float64Array.from(snap.real), si = Float64Array.from(snap.imag);
        frames.push({
          step: idx + 1, gate: snap.gate,
          statevector: probabilityTable(sr, si, nQubits, 32),
          bloch: blochVectors(sr, si, nQubits),
        });
      });
      return { ok: true, result: { qubits: nQubits, totalSteps: frames.length, frames } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Macro: analyzeCircuit ──────────────────────────────────────────
  registerLensAction("quantum", "analyzeCircuit", (_ctx, artifact, params) => {
    try {
      const circuit = params?.circuit || artifact?.data?.circuit;
      if (!circuit) return { ok: false, error: "No circuit data." };
      const nQubits = Math.max(1, Math.floor(Number(circuit.qubits) || 1));
      const gates = Array.isArray(circuit.gates) ? circuit.gates : [];
      const gateCounts = {};
      let singleQubitGates = 0, twoQubitGates = 0, threeQubitGates = 0;
      const qubitUsage = new Array(nQubits).fill(0);
      const qubitTime = new Array(nQubits).fill(0);
      let maxDepth = 0;
      for (const step of gates) {
        const gateId = String(step?.gate || "").toUpperCase();
        gateCounts[gateId] = (gateCounts[gateId] || 0) + 1;
        const w = (MULTI_GATES[gateId]?.qubits) || 1;
        if (gateId === "TOFFOLI" || gateId === "CCX") threeQubitGates++;
        else if (w === 2) twoQubitGates++;
        else singleQubitGates++;
        const targets = Array.isArray(step.targets) ? step.targets : (step.target != null ? [step.target] : [0]);
        const controls = Array.isArray(step.controls) ? step.controls : [];
        const all = [...new Set([...targets, ...controls])].filter((q) => q >= 0 && q < nQubits);
        for (const q of all) qubitUsage[q]++;
        const start = all.length ? Math.max(...all.map((q) => qubitTime[q])) : 0;
        const end = start + 1;
        for (const q of all) qubitTime[q] = end;
        maxDepth = Math.max(maxDepth, end);
      }
      const tCount = (gateCounts.T || 0) + (gateCounts.TDG || 0);
      const cnotCount = (gateCounts.CNOT || 0) + (gateCounts.CX || 0);
      const cliffordSet = new Set(["H", "S", "SDG", "CNOT", "CX", "CZ", "X", "Y", "Z", "SWAP", "I"]);
      const cliffordCount = gates.filter((g) => cliffordSet.has(String(g.gate || "").toUpperCase())).length;
      const nonCliffordCount = gates.length - cliffordCount;
      const parallelism = maxDepth > 0 ? Math.round((gates.length / maxDepth) * 100) / 100 : 0;
      const utilization = qubitUsage.map((c, i) => ({
        qubit: i, gateCount: c,
        utilization: maxDepth > 0 ? Math.round((c / maxDepth) * 10000) / 100 : 0,
      }));
      const avgUtilization = nQubits > 0
        ? Math.round(utilization.reduce((s, q) => s + q.utilization, 0) / nQubits * 100) / 100 : 0;
      return {
        ok: true,
        result: {
          qubits: nQubits, totalGates: gates.length, circuitDepth: maxDepth,
          gateCounts, singleQubitGates, twoQubitGates, threeQubitGates,
          tCount, cnotCount, cliffordCount, nonCliffordCount,
          parallelism, avgUtilization, qubitUtilization: utilization,
          faultToleranceCost: tCount > 0 ? "non-trivial (T-gates present)" : "Clifford-only (efficient)",
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Macro: errorAnalysis ───────────────────────────────────────────
  registerLensAction("quantum", "errorAnalysis", (_ctx, artifact, params) => {
    try {
      const circuit = params?.circuit || artifact?.data?.circuit;
      if (!circuit) return { ok: false, error: "No circuit data." };
      const presetId = params?.preset || artifact?.data?.noisePreset;
      const preset = presetId && NOISE_PRESETS[presetId] ? NOISE_PRESETS[presetId] : null;
      const noise = { ...(preset || {}), ...(params?.noiseModel || artifact?.data?.noiseModel || {}) };
      const t1 = noise.t1 || 50, t2 = noise.t2 || 30;
      const singleGateError = noise.gateErrorRate ?? 0.001;
      const twoGateError = noise.twoQubitGateError ?? 0.01;
      const readoutError = noise.readoutError ?? 0.02;
      const gateTime = noise.gateTime ?? 0.05;
      const gates = Array.isArray(circuit.gates) ? circuit.gates : [];
      const nQubits = Math.max(1, Math.floor(Number(circuit.qubits) || 1));
      let singleCount = 0, twoCount = 0;
      for (const step of gates) {
        const g = String(step?.gate || "").toUpperCase();
        if (g === "MEASURE" || g === "M" || g === "BARRIER") continue;
        const w = (MULTI_GATES[g]?.qubits) || 1;
        if (w >= 2) twoCount++; else singleCount++;
      }
      const gateSuccessProb = Math.pow(1 - singleGateError, singleCount) * Math.pow(1 - twoGateError, twoCount);
      const totalTime = gates.length * gateTime;
      const t1Decay = Math.exp(-totalTime / t1);
      const t2Decay = Math.exp(-totalTime / t2);
      const decoherenceFidelity = Math.min(t1Decay, t2Decay);
      const readoutFidelity = Math.pow(1 - readoutError, nQubits);
      const overallFidelity = gateSuccessProb * decoherenceFidelity * readoutFidelity;
      const gateErr = 1 - gateSuccessProb, decoErr = 1 - decoherenceFidelity, readErr = 1 - readoutFidelity;
      const r = (v) => Math.round(v * 1e5) / 1e5;
      return {
        ok: true,
        result: {
          preset: preset ? (NOISE_PRESETS[presetId].label) : "custom",
          overallFidelity: r(overallFidelity),
          fidelityPercent: Math.round(overallFidelity * 1e4) / 100,
          quality: overallFidelity > 0.99 ? "excellent" : overallFidelity > 0.95 ? "good"
            : overallFidelity > 0.8 ? "moderate" : overallFidelity > 0.5 ? "poor" : "unusable",
          errorBudget: {
            gateErrors: { contribution: r(gateErr), singleQubitGates: singleCount, twoQubitGates: twoCount },
            decoherence: { contribution: r(decoErr), executionTimeUs: Math.round(totalTime * 100) / 100, t1, t2 },
            readout: { contribution: r(readErr), qubits: nQubits, perQubitError: readoutError },
            totalError: r(1 - overallFidelity),
          },
          noiseModel: { t1, t2, singleGateError, twoGateError, readoutError, gateTimeUs: gateTime },
          recommendations: [
            ...(decoErr > gateErr ? ["Decoherence dominates — reduce circuit depth or improve T1/T2"] : []),
            ...(twoCount > singleCount * 2 ? ["High two-qubit gate ratio — consider gate decomposition"] : []),
            ...(overallFidelity < 0.5 ? ["Circuit fidelity too low for meaningful results — apply error mitigation"] : []),
            ...(totalTime > t2 * 0.5 ? ["Execution time exceeds 50% of T2 — significant dephasing expected"] : []),
          ],
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Macro: noisePresets ────────────────────────────────────────────
  registerLensAction("quantum", "noisePresets", (_ctx, _artifact, _params) => {
    try {
      return {
        ok: true,
        result: {
          presets: Object.entries(NOISE_PRESETS).map(([id, v]) => ({
            id, label: v.label, t1: v.t1, t2: v.t2,
            gateErrorRate: v.gateErrorRate, twoQubitGateError: v.twoQubitGateError,
            readoutError: v.readoutError, gateTime: v.gateTime,
          })),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Macro: algorithmTemplate ───────────────────────────────────────
  registerLensAction("quantum", "algorithmTemplate", (_ctx, _artifact, params) => {
    try {
      const id = params?.template || params?.id;
      if (!id) return { ok: false, error: `Missing template id. Available: ${TEMPLATE_IDS.join(", ")}` };
      const circuit = buildTemplate(id, params?.qubits);
      if (!circuit) return { ok: false, error: `Unknown template "${id}". Available: ${TEMPLATE_IDS.join(", ")}` };
      return { ok: true, result: { template: String(id).toLowerCase(), circuit } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Macro: exportQASM ──────────────────────────────────────────────
  registerLensAction("quantum", "exportQASM", (_ctx, artifact, params) => {
    try {
      const circuit = params?.circuit || artifact?.data?.circuit;
      if (!circuit) return { ok: false, error: "No circuit data." };
      return { ok: true, result: { qasm: circuitToQASM(circuit), format: "OpenQASM 2.0" } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Macro: importQASM ──────────────────────────────────────────────
  registerLensAction("quantum", "importQASM", (_ctx, _artifact, params) => {
    try {
      const qasm = params?.qasm;
      if (!qasm || !String(qasm).trim()) return { ok: false, error: "No QASM source supplied." };
      const circuit = qasmToCircuit(qasm);
      if (!circuit.gates.length) return { ok: false, error: "No recognizable gates parsed from QASM input." };
      return { ok: true, result: { circuit, gatesParsed: circuit.gates.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Macro: saveCircuit (persistent per-user) ───────────────────────
  registerLensAction("quantum", "saveCircuit", (ctx, _artifact, params) => {
    try {
      const s = getQState();
      if (!s) return { ok: false, error: "State store unavailable." };
      const circuit = params?.circuit;
      if (!circuit || !Array.isArray(circuit.gates)) return { ok: false, error: "Expected { circuit: { qubits, gates } }." };
      const userId = qActor(ctx);
      const list = qUserCircuits(s, userId);
      const name = String(params?.name || "Untitled circuit").trim().slice(0, 120);
      const existingId = params?.id;
      const now = new Date().toISOString();
      let record;
      if (existingId) {
        record = list.find((c) => c.id === existingId);
        if (record) { record.name = name; record.circuit = circuit; record.updatedAt = now; }
      }
      if (!record) {
        record = { id: qId("qc"), name, circuit, createdAt: now, updatedAt: now };
        list.unshift(record);
        if (list.length > 100) list.length = 100;
      }
      saveQ();
      return { ok: true, result: { saved: record } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Macro: listCircuits ────────────────────────────────────────────
  registerLensAction("quantum", "listCircuits", (ctx, _artifact, _params) => {
    try {
      const s = getQState();
      if (!s) return { ok: false, error: "State store unavailable." };
      const list = qUserCircuits(s, qActor(ctx));
      return {
        ok: true,
        result: {
          circuits: list.map((c) => ({
            id: c.id, name: c.name, qubits: c.circuit?.qubits || 0,
            gateCount: (c.circuit?.gates || []).length, createdAt: c.createdAt, updatedAt: c.updatedAt,
          })),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Macro: loadCircuit ─────────────────────────────────────────────
  registerLensAction("quantum", "loadCircuit", (ctx, _artifact, params) => {
    try {
      const s = getQState();
      if (!s) return { ok: false, error: "State store unavailable." };
      const list = qUserCircuits(s, qActor(ctx));
      const rec = list.find((c) => c.id === params?.id);
      if (!rec) return { ok: false, error: "Circuit not found." };
      return { ok: true, result: { circuit: rec.circuit, name: rec.name, id: rec.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Macro: deleteCircuit ───────────────────────────────────────────
  registerLensAction("quantum", "deleteCircuit", (ctx, _artifact, params) => {
    try {
      const s = getQState();
      if (!s) return { ok: false, error: "State store unavailable." };
      const list = qUserCircuits(s, qActor(ctx));
      const idx = list.findIndex((c) => c.id === params?.id);
      if (idx < 0) return { ok: false, error: "Circuit not found." };
      list.splice(idx, 1);
      saveQ();
      return { ok: true, result: { deleted: params.id, remaining: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
