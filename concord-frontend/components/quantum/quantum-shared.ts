'use client';

/** Shared quantum types/helpers — extracted from lenses/quantum/page.tsx */

import type { PlacedGate } from '@/components/quantum/CircuitComposer';
import type { BlochVector } from '@/components/quantum/BlochSphere';

export interface ProbEntry { state: string; probability: number; amplitude?: { re: number; im: number } }
export interface SimResult {
  qubits: number;
  gatesApplied: number;
  circuitDepth: number;
  statevector: ProbEntry[];
  measurements: { shots: number; counts: Record<string, number> };
  bloch: BlochVector[];
  entropy: number;
  maxEntanglement: boolean;
}
export interface StepFrame { step: number; gate: string; statevector: ProbEntry[]; bloch: BlochVector[] }
export interface AnalysisResult {
  totalGates: number; circuitDepth: number; tCount: number; cnotCount: number;
  cliffordCount: number; nonCliffordCount: number; parallelism: number;
  avgUtilization: number; faultToleranceCost: string;
  gateCounts: Record<string, number>;
}
export interface ErrorResult {
  preset: string; fidelityPercent: number; quality: string;
  errorBudget: {
    gateErrors: { contribution: number };
    decoherence: { contribution: number; executionTimeUs: number };
    readout: { contribution: number };
    totalError: number;
  };
  recommendations: string[];
}
export interface SavedCircuitMeta { id: string; name: string; qubits: number; gateCount: number; updatedAt: string }
export interface NoisePreset { id: string; label: string; t1: number; t2: number; gateErrorRate: number; readoutError: number }
export interface ApiCircuit { qubits: number; gates: Array<{ gate: string; targets?: number[]; controls?: number[]; params?: { theta: number } }> }

export function buildCircuit(qubits: number, placed: PlacedGate[]): ApiCircuit {
  return {
    qubits,
    gates: [...placed]
      .sort((a, b) => a.column - b.column)
      .map((g) => ({ gate: g.gate, targets: g.targets, controls: g.controls, params: g.params })),
  };
}

export function circuitToPlaced(circuit: ApiCircuit): PlacedGate[] {
  return (circuit.gates || []).map((g, i) => ({
    uid: `load_${i}_${Date.now().toString(36)}`,
    gate: String(g.gate || '').toUpperCase(),
    column: i,
    targets: Array.isArray(g.targets) ? g.targets : [],
    controls: Array.isArray(g.controls) ? g.controls : [],
    params: g.params,
  }));
}

export const TEMPLATES: { id: string; label: string }[] = [
  { id: 'bell', label: 'Bell pair' },
  { id: 'ghz', label: 'GHZ state' },
  { id: 'qft', label: 'QFT' },
  { id: 'grover', label: 'Grover search' },
  { id: 'teleport', label: 'Teleportation' },
  { id: 'deutsch', label: 'Deutsch-Jozsa' },
  { id: 'superposition', label: 'Superposition' },
];

export type QuantumView = 'composer' | 'research';
export const QUANTUM_VIEWS: { id: QuantumView; label: string }[] = [
  { id: 'composer', label: 'Composer' },
  { id: 'research', label: 'Research' },
];
