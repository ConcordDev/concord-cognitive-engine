// server/domains/quantum.js
// Domain actions for quantum computing: circuit simulation, gate analysis,
// error rate computation, and qubit utilization metrics.

export default function registerQuantumActions(registerLensAction) {
  // Gate matrices (2x2 complex: [real, imag] pairs)
  const GATES = {
    H: { matrix: [[1 / Math.SQRT2, 0, 1 / Math.SQRT2, 0], [1 / Math.SQRT2, 0, -1 / Math.SQRT2, 0]], qubits: 1, name: "Hadamard" },
    X: { matrix: [[0, 0, 1, 0], [1, 0, 0, 0]], qubits: 1, name: "Pauli-X" },
    Y: { matrix: [[0, 0, 0, -1], [0, 1, 0, 0]], qubits: 1, name: "Pauli-Y" },
    Z: { matrix: [[1, 0, 0, 0], [0, 0, -1, 0]], qubits: 1, name: "Pauli-Z" },
    S: { matrix: [[1, 0, 0, 0], [0, 0, 0, 1]], qubits: 1, name: "Phase" },
    T: { matrix: [[1, 0, 0, 0], [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), 0, 0]], qubits: 1, name: "T-gate" },
    CNOT: { qubits: 2, name: "CNOT" },
    SWAP: { qubits: 2, name: "SWAP" },
    TOFFOLI: { qubits: 3, name: "Toffoli" },
  };

  /**
   * simulateCircuit
   * Simulate a quantum circuit on a statevector simulator.
   * artifact.data.circuit = { qubits: number, gates: [{ gate, targets, controls? }] }
   * Supports up to 12 qubits (4096 amplitudes).
   */
  registerLensAction("quantum", "simulateCircuit", (ctx, artifact, _params) => {
    const circuit = artifact.data?.circuit;
    if (!circuit) return { ok: false, error: "No circuit data. Expected { qubits, gates }." };

    const nQubits = circuit.qubits || 1;
    if (nQubits > 12) return { ok: false, error: "Simulation limited to 12 qubits (statevector: 2^12 = 4096 amplitudes)." };

    const dim = Math.pow(2, nQubits);
    // Initialize |000...0⟩
    const stateReal = new Float64Array(dim);
    const stateImag = new Float64Array(dim);
    stateReal[0] = 1;

    const gates = circuit.gates || [];
    let gateCount = 0;

    for (const step of gates) {
      const gateId = (step.gate || "").toUpperCase();
      const target = step.targets?.[0] ?? step.target ?? 0;

      if (gateId === "CNOT" || gateId === "CX") {
        const control = step.controls?.[0] ?? step.targets?.[0] ?? 0;
        const tgt = step.targets?.[1] ?? step.target ?? 1;
        // Apply CNOT: flip target if control is |1⟩
        for (let i = 0; i < dim; i++) {
          if ((i >> (nQubits - 1 - control)) & 1) {
            const j = i ^ (1 << (nQubits - 1 - tgt));
            if (j > i) {
              [stateReal[i], stateReal[j]] = [stateReal[j], stateReal[i]];
              [stateImag[i], stateImag[j]] = [stateImag[j], stateImag[i]];
            }
          }
        }
        gateCount++;
        continue;
      }

      if (gateId === "SWAP") {
        const q1 = step.targets?.[0] ?? 0;
        const q2 = step.targets?.[1] ?? 1;
        for (let i = 0; i < dim; i++) {
          const b1 = (i >> (nQubits - 1 - q1)) & 1;
          const b2 = (i >> (nQubits - 1 - q2)) & 1;
          if (b1 !== b2) {
            const j = i ^ (1 << (nQubits - 1 - q1)) ^ (1 << (nQubits - 1 - q2));
            if (j > i) {
              [stateReal[i], stateReal[j]] = [stateReal[j], stateReal[i]];
              [stateImag[i], stateImag[j]] = [stateImag[j], stateImag[i]];
            }
          }
        }
        gateCount++;
        continue;
      }

      // Single-qubit gate application
      const gateInfo = GATES[gateId];
      if (!gateInfo || gateInfo.qubits !== 1) {
        continue; // skip unknown gates
      }

      const [a_r, a_i, b_r, b_i] = gateInfo.matrix[0];
      const [c_r, c_i, d_r, d_i] = gateInfo.matrix[1];

      for (let i = 0; i < dim; i++) {
        const bit = (i >> (nQubits - 1 - target)) & 1;
        if (bit === 0) {
          const j = i | (1 << (nQubits - 1 - target));
          const re0 = stateReal[i], im0 = stateImag[i];
          const re1 = stateReal[j], im1 = stateImag[j];
          // |0⟩ component: a*|0⟩ + b*|1⟩
          stateReal[i] = (a_r * re0 - a_i * im0) + (b_r * re1 - b_i * im1);
          stateImag[i] = (a_r * im0 + a_i * re0) + (b_r * im1 + b_i * re1);
          // |1⟩ component: c*|0⟩ + d*|1⟩
          stateReal[j] = (c_r * re0 - c_i * im0) + (d_r * re1 - d_i * im1);
          stateImag[j] = (c_r * im0 + c_i * re0) + (d_r * im1 + d_i * re1);
        }
      }
      gateCount++;
    }

    // Compute measurement probabilities
    const probabilities = [];
    for (let i = 0; i < dim; i++) {
      const prob = stateReal[i] * stateReal[i] + stateImag[i] * stateImag[i];
      if (prob > 1e-10) {
        const label = i.toString(2).padStart(nQubits, "0");
        probabilities.push({ state: `|${label}⟩`, probability: Math.round(prob * 1e8) / 1e8 });
      }
    }
    probabilities.sort((a, b) => b.probability - a.probability);

    // Simulated measurement (weighted random sampling, 1024 shots)
    const shots = 1024;
    const counts = {};
    for (let s = 0; s < shots; s++) {
      let r = Math.random();
      for (let i = 0; i < dim; i++) {
        const p = stateReal[i] * stateReal[i] + stateImag[i] * stateImag[i];
        r -= p;
        if (r <= 0) {
          const label = i.toString(2).padStart(nQubits, "0");
          counts[label] = (counts[label] || 0) + 1;
          break;
        }
      }
    }

    // Entropy of the output distribution
    let entropy = 0;
    for (const p of probabilities) {
      if (p.probability > 0) entropy -= p.probability * Math.log2(p.probability);
    }

    artifact.data.lastSimulation = { timestamp: new Date().toISOString(), gatesApplied: gateCount, topState: probabilities[0] };

    return {
      ok: true, result: {
        qubits: nQubits, gatesApplied: gateCount, circuitDepth: gates.length,
        statevector: probabilities.slice(0, 32),
        measurements: { shots, counts },
        entropy: Math.round(entropy * 10000) / 10000,
        maxEntanglement: entropy > 0.9,
      },
    };
  });

  /**
   * analyzeCircuit
   * Static analysis of circuit: gate counts, depth, T-count (for fault-tolerance
   * cost), parallelism, and qubit utilization.
   */
  registerLensAction("quantum", "analyzeCircuit", (ctx, artifact, _params) => {
    const circuit = artifact.data?.circuit;
    if (!circuit) return { ok: false, error: "No circuit data." };

    const nQubits = circuit.qubits || 1;
    const gates = circuit.gates || [];

    // Gate type counts
    const gateCounts = {};
    let singleQubitGates = 0, twoQubitGates = 0, threeQubitGates = 0;
    const qubitUsage = new Array(nQubits).fill(0);

    for (const step of gates) {
      const gateId = (step.gate || "").toUpperCase();
      gateCounts[gateId] = (gateCounts[gateId] || 0) + 1;

      const info = GATES[gateId];
      const qubitsUsed = info?.qubits || 1;
      if (qubitsUsed === 1) singleQubitGates++;
      else if (qubitsUsed === 2) twoQubitGates++;
      else threeQubitGates++;

      // Track qubit utilization
      const targets = step.targets || [step.target || 0];
      const controls = step.controls || [];
      for (const q of [...targets, ...controls]) {
        if (q >= 0 && q < nQubits) qubitUsage[q]++;
      }
    }

    // T-count (number of T and T† gates — key metric for fault-tolerant cost)
    const tCount = (gateCounts["T"] || 0) + (gateCounts["TDG"] || 0) + (gateCounts["T†"] || 0);

    // CNOT count (typically the most expensive gate on real hardware)
    const cnotCount = (gateCounts["CNOT"] || 0) + (gateCounts["CX"] || 0);

    // Circuit depth: schedule gates and find the longest path
    const qubitTime = new Array(nQubits).fill(0);
    let maxDepth = 0;
    for (const step of gates) {
      const targets = step.targets || [step.target || 0];
      const controls = step.controls || [];
      const allQubits = [...new Set([...targets, ...controls])].filter(q => q >= 0 && q < nQubits);
      const startTime = Math.max(...allQubits.map(q => qubitTime[q]));
      const endTime = startTime + 1;
      for (const q of allQubits) qubitTime[q] = endTime;
      maxDepth = Math.max(maxDepth, endTime);
    }

    // Qubit utilization: fraction of time each qubit is active
    const utilization = qubitUsage.map((count, i) => ({
      qubit: i,
      gateCount: count,
      utilization: maxDepth > 0 ? Math.round((count / maxDepth) * 10000) / 100 : 0,
    }));
    const avgUtilization = nQubits > 0
      ? Math.round(utilization.reduce((s, q) => s + q.utilization, 0) / nQubits * 100) / 100
      : 0;

    // Parallelism factor
    const parallelism = maxDepth > 0 ? Math.round((gates.length / maxDepth) * 100) / 100 : 0;

    // Clifford vs non-Clifford (for compilation cost)
    const cliffordGates = new Set(["H", "S", "CNOT", "CX", "X", "Y", "Z", "SWAP"]);
    const cliffordCount = gates.filter(g => cliffordGates.has((g.gate || "").toUpperCase())).length;
    const nonCliffordCount = gates.length - cliffordCount;

    return {
      ok: true, result: {
        qubits: nQubits, totalGates: gates.length,
        circuitDepth: maxDepth,
        gateCounts,
        singleQubitGates, twoQubitGates, threeQubitGates,
        tCount, cnotCount,
        cliffordCount, nonCliffordCount,
        parallelism, avgUtilization,
        qubitUtilization: utilization,
        faultToleranceCost: tCount > 0 ? "non-trivial" : "Clifford-only (efficient)",
      },
    };
  });

  /**
   * errorAnalysis
   * Model decoherence and gate error effects on circuit fidelity.
   * artifact.data.circuit, artifact.data.noiseModel = { t1, t2, gateErrorRate, readoutError }
   */
  registerLensAction("quantum", "errorAnalysis", (ctx, artifact, params) => {
    const circuit = artifact.data?.circuit;
    if (!circuit) return { ok: false, error: "No circuit data." };

    const noise = artifact.data?.noiseModel || params.noiseModel || {};
    const t1 = noise.t1 || 50; // T1 relaxation time (microseconds)
    const t2 = noise.t2 || 30; // T2 dephasing time (microseconds)
    const singleGateError = noise.gateErrorRate || 0.001; // per single-qubit gate
    const twoGateError = noise.twoQubitGateError || 0.01; // per two-qubit gate
    const readoutError = noise.readoutError || 0.02;
    const gateTime = noise.gateTime || 0.05; // microseconds per gate

    const gates = circuit.gates || [];
    const nQubits = circuit.qubits || 1;

    let singleCount = 0, twoCount = 0;
    for (const step of gates) {
      const gateId = (step.gate || "").toUpperCase();
      const info = GATES[gateId];
      if (info?.qubits === 2 || gateId === "CNOT" || gateId === "CX" || gateId === "SWAP") {
        twoCount++;
      } else {
        singleCount++;
      }
    }

    // Gate error fidelity: product of (1 - errorRate) for each gate
    const gateSuccessProb = Math.pow(1 - singleGateError, singleCount) *
      Math.pow(1 - twoGateError, twoCount);

    // Decoherence: circuit execution time vs T1/T2
    const totalTime = gates.length * gateTime;
    const t1Decay = Math.exp(-totalTime / t1);
    const t2Decay = Math.exp(-totalTime / t2);
    const decoherenceFidelity = Math.min(t1Decay, t2Decay);

    // Readout fidelity
    const readoutFidelity = Math.pow(1 - readoutError, nQubits);

    // Overall circuit fidelity
    const overallFidelity = gateSuccessProb * decoherenceFidelity * readoutFidelity;

    // Error budget breakdown
    const gateErrorContribution = 1 - gateSuccessProb;
    const decoherenceContribution = 1 - decoherenceFidelity;
    const readoutContribution = 1 - readoutFidelity;
    const totalError = 1 - overallFidelity;

    const r = (v) => Math.round(v * 100000) / 100000;

    return {
      ok: true, result: {
        overallFidelity: r(overallFidelity),
        fidelityPercent: Math.round(overallFidelity * 10000) / 100,
        quality: overallFidelity > 0.99 ? "excellent" : overallFidelity > 0.95 ? "good"
          : overallFidelity > 0.8 ? "moderate" : overallFidelity > 0.5 ? "poor" : "unusable",
        errorBudget: {
          gateErrors: { contribution: r(gateErrorContribution), singleQubitGates: singleCount, twoQubitGates: twoCount },
          decoherence: { contribution: r(decoherenceContribution), executionTimeUs: Math.round(totalTime * 100) / 100, t1, t2 },
          readout: { contribution: r(readoutContribution), qubits: nQubits, perQubitError: readoutError },
          totalError: r(totalError),
        },
        noiseModel: { t1, t2, singleGateError, twoGateError, readoutError, gateTimeUs: gateTime },
        recommendations: [
          ...(decoherenceContribution > gateErrorContribution ? ["Decoherence dominates — reduce circuit depth or improve T1/T2"] : []),
          ...(twoCount > singleCount * 2 ? ["High two-qubit gate ratio — consider gate decomposition"] : []),
          ...(overallFidelity < 0.5 ? ["Circuit fidelity too low for meaningful results — apply error mitigation"] : []),
          ...(totalTime > t2 * 0.5 ? ["Execution time exceeds 50% of T2 — significant dephasing expected"] : []),
        ],
      },
    };
  });
}
