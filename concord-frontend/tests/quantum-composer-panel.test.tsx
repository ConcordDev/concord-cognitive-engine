/**
 * Quantum ComposerPanel — the full-lens build's behaviour contracts:
 *  F1/F2 — Run and Analyze render against the real verb result shapes,
 *          and a partial result degrades instead of crashing the lens;
 *          the working circuit is draft-persisted across a remount.
 *  F4    — Save runs off an inline name field (no window.prompt), the
 *          saved row is the receipt; the row delete confirms first.
 *  F5    — the New circuit request performs a guarded fresh circuit.
 *  S6    — Step-Through has a close control.
 *
 * lensRun is mocked with payloads in the server's real shapes (pinned
 * against server/domains/quantum.js by server/tests/quantum-full-build).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComposerPanel } from '@/components/quantum/ComposerPanel';
import {
  QUANTUM_NEW_CIRCUIT_EVENT,
} from '@/components/quantum/quantum-shared';

const GATE_LIB = [
  { id: 'H', label: 'Hadamard', qubits: 1, parametric: false },
  { id: 'X', label: 'Pauli-X', qubits: 1, parametric: false },
  { id: 'RX', label: 'RX rotation', qubits: 1, parametric: true, param: 'theta' },
  { id: 'CNOT', label: 'CNOT', qubits: 2, parametric: false },
  { id: 'MEASURE', label: 'Measure', qubits: 1, parametric: false },
];

const BELL_SIM = {
  qubits: 2, gatesApplied: 2, circuitDepth: 2,
  statevector: [
    { state: '00', probability: 0.5, amplitude: { re: 0.7071, im: 0 } },
    { state: '11', probability: 0.5, amplitude: { re: 0.7071, im: 0 } },
  ],
  measurements: { shots: 1024, counts: { '00': 512, '11': 512 } },
  bloch: [
    { qubit: 0, x: 0, y: 0, z: 0, purity: 0, mixed: true },
    { qubit: 1, x: 0, y: 0, z: 0, purity: 0, mixed: true },
  ],
  entropy: 1, maxEntanglement: true,
};

const BELL_ANALYSIS = {
  qubits: 2, totalGates: 2, circuitDepth: 2,
  gateCounts: { H: 1, CNOT: 1 }, singleQubitGates: 1, twoQubitGates: 1, threeQubitGates: 0,
  tCount: 0, cnotCount: 1, cliffordCount: 2, nonCliffordCount: 0,
  parallelism: 1, avgUtilization: 50, qubitUtilization: [],
  faultToleranceCost: 'Clifford-only (efficient)',
};

interface SavedMeta { id: string; name: string; qubits: number; gateCount: number; updatedAt: string }
const calls: { action: string; input: Record<string, unknown> }[] = [];
let savedStore: SavedMeta[] = [];
let simResult: unknown = BELL_SIM;

function dispatch(action: string, input: Record<string, unknown>): { ok: boolean; result?: unknown; error?: string } {
  calls.push({ action, input });
  switch (action) {
    case 'gateLibrary': return { ok: true, result: { gates: GATE_LIB, templates: [], noisePresets: ['ideal'] } };
    case 'noisePresets': return { ok: true, result: { presets: [{ id: 'ideal', label: 'Ideal (noiseless)', t1: 1e9, t2: 1e9, gateErrorRate: 0, readoutError: 0 }] } };
    case 'listCircuits': return { ok: true, result: { circuits: savedStore } };
    case 'algorithmTemplate':
      return { ok: true, result: { template: 'bell', circuit: { qubits: 2, gates: [{ gate: 'H', targets: [0] }, { gate: 'CNOT', controls: [0], targets: [0, 1] }] } } };
    case 'simulateCircuit': return { ok: true, result: simResult };
    case 'analyzeCircuit': return { ok: true, result: BELL_ANALYSIS };
    case 'stepCircuit':
      return {
        ok: true,
        result: {
          qubits: 2, totalSteps: 2,
          frames: [
            { step: 0, gate: 'INIT', statevector: [{ state: '00', probability: 1 }], bloch: BELL_SIM.bloch },
            { step: 1, gate: 'H', statevector: BELL_SIM.statevector, bloch: BELL_SIM.bloch },
          ],
        },
      };
    case 'saveCircuit': {
      const circuit = input.circuit as { qubits: number; gates: unknown[] };
      const meta: SavedMeta = {
        id: 'qc_test1', name: String(input.name), qubits: circuit.qubits,
        gateCount: circuit.gates.length, updatedAt: new Date().toISOString(),
      };
      savedStore = [meta, ...savedStore];
      return { ok: true, result: { saved: { ...meta, circuit } } };
    }
    case 'deleteCircuit':
      savedStore = savedStore.filter((c) => c.id !== input.id);
      return { ok: true, result: { deleted: input.id, remaining: savedStore.length } };
    case 'loadCircuit':
      return { ok: true, result: { circuit: { qubits: 2, gates: [{ gate: 'H', targets: [0] }] }, name: 'Loaded', id: input.id } };
    default: return { ok: true, result: {} };
  }
}

vi.mock('@/lib/api/client', () => ({
  lensRun: async (_domain: string, action: string, input: Record<string, unknown>) => ({
    data: dispatch(action, input),
  }),
}));

vi.mock('@/components/viz', () => ({
  ChartKit: (props: { data: unknown }) => (
    <div data-testid="chart">{JSON.stringify(props.data)}</div>
  ),
}));

vi.mock('@/components/quantum/BlochSphere', () => ({
  BlochSphere: () => <div data-testid="bloch" />,
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// Controllable lens-state fake: tests seed `fakeRestored` before mount;
// every save() is recorded and becomes the next mount's restored state.
let fakeRestored: { customState?: Record<string, unknown> } | null = null;
const saveCalls: Record<string, unknown>[] = [];
vi.mock('@/hooks/useLensState', () => ({
  useLensState: () => ({
    restored: fakeRestored,
    save: (partial: Record<string, unknown>) => {
      saveCalls.push(partial);
      fakeRestored = { ...(fakeRestored ?? {}), ...partial } as { customState?: Record<string, unknown> };
    },
    scrollRef: { current: null },
    isReturning: false,
  }),
}));

async function mountPanel() {
  const utils = render(<ComposerPanel />);
  // gate library + saved list load on mount
  await screen.findByRole('button', { name: 'Bell pair' });
  return utils;
}

async function loadBell() {
  fireEvent.click(screen.getByRole('button', { name: 'Bell pair' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run Simulation' })).not.toBeDisabled());
}

beforeEach(() => {
  calls.length = 0;
  saveCalls.length = 0;
  savedStore = [];
  simResult = BELL_SIM;
  fakeRestored = null;
  sessionStorage.clear();
});

describe('Run + Analyze contracts (F1/F2)', () => {
  it('Run Simulation renders the outcome counts for the Bell circuit', async () => {
    await mountPanel();
    await loadBell();
    fireEvent.click(screen.getByRole('button', { name: 'Run Simulation' }));
    await screen.findByText(/Measurement Shots \(1024\)/);
    const charts = screen.getAllByTestId('chart').map((c) => c.textContent ?? '');
    expect(charts.some((t) => t.includes('|00⟩') && t.includes('512'))).toBe(true);
    expect(charts.some((t) => t.includes('|11⟩') && t.includes('512'))).toBe(true);
    expect(screen.getByText('High entanglement')).toBeTruthy();
  });

  it('Analyze renders the report incl. the fault-tolerance line', async () => {
    await mountPanel();
    await loadBell();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    await screen.findByText('Circuit Analysis');
    expect(screen.getByText('Clifford-only (efficient)')).toBeTruthy();
    expect(screen.getByText('Total gates')).toBeTruthy();
  });

  it('a partial simulate result degrades instead of crashing the lens', async () => {
    simResult = { qubits: 2, gatesApplied: 2, circuitDepth: 2, entropy: 1, maxEntanglement: true };
    await mountPanel();
    await loadBell();
    fireEvent.click(screen.getByRole('button', { name: 'Run Simulation' }));
    // the panel survives: composer still present, no shots panel, no throw
    await waitFor(() => expect(screen.getByText(/State Probabilities/)).toBeTruthy());
    expect(screen.queryByText(/Measurement Shots/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Run Simulation' })).toBeTruthy();
  });
});

describe('Save + delete (F4 + the S3 guard)', () => {
  it('saves under the typed name — no prompt — and the row is the receipt', async () => {
    await mountPanel();
    await loadBell();
    fireEvent.change(screen.getByLabelText('Circuit name'), {
      target: { value: 'PR2QUANT-UNIQUE-STRING-1031' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save circuit' }));
    await screen.findByText('PR2QUANT-UNIQUE-STRING-1031');
    expect(screen.getByText(/Saved “PR2QUANT-UNIQUE-STRING-1031”/)).toBeTruthy();
    const saveCall = calls.find((c) => c.action === 'saveCircuit');
    expect(saveCall?.input.name).toBe('PR2QUANT-UNIQUE-STRING-1031');
    expect((saveCall?.input.circuit as { gates: unknown[] }).gates).toHaveLength(2);
  });

  it('the saved-row delete arms first, names the circuit, then deletes', async () => {
    savedStore = [{ id: 'qc_9', name: 'Fixture circuit', qubits: 2, gateCount: 3, updatedAt: new Date().toISOString() }];
    await mountPanel();
    await screen.findByText('Fixture circuit');
    fireEvent.click(screen.getByTitle('Delete'));
    expect(screen.getByText(/Delete “Fixture circuit”\?/)).toBeTruthy();
    expect(calls.some((c) => c.action === 'deleteCircuit')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Fixture circuit')).toBeNull());
    expect(calls.some((c) => c.action === 'deleteCircuit' && c.input.id === 'qc_9')).toBe(true);
  });
});

describe('New circuit (F5) + Step-Through close (S6)', () => {
  it('the new-circuit request asks first, then clears the canvas', async () => {
    await mountPanel();
    await loadBell();
    fireEvent(window, new Event(QUANTUM_NEW_CIRCUIT_EVENT));
    await screen.findByText(/Start a new circuit\? The current circuit \(2 gates\) will be cleared/);
    // nothing cleared yet
    expect(screen.getByRole('button', { name: 'Run Simulation' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Start new' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run Simulation' })).toBeDisabled());
  });

  it('Step-Through opens and its close control clears it', async () => {
    await mountPanel();
    await loadBell();
    fireEvent.click(screen.getByRole('button', { name: 'Step-Through' }));
    await screen.findByText('Step-Through Execution');
    fireEvent.click(screen.getByLabelText('Close step-through'));
    await waitFor(() => expect(screen.queryByText('Step-Through Execution')).toBeNull());
  });
});

describe('Working-circuit draft (F1, second half)', () => {
  it('placing gates saves the draft; a remount restores the circuit', async () => {
    const first = await mountPanel();
    await loadBell();
    await waitFor(() => {
      const hasDraft = saveCalls.some((p) => {
        const draft = (p.customState as { composerDraft?: { placed: unknown[] } } | undefined)?.composerDraft;
        return Array.isArray(draft?.placed) && draft.placed.length === 2;
      });
      if (!hasDraft) throw new Error('draft with 2 placed gates not saved yet');
    });
    first.unmount();
    // remount = the error boundary's "Try again": the circuit is back
    await mountPanel();
    expect(screen.getByRole('button', { name: 'Run Simulation' })).not.toBeDisabled();
  }, 20000);
});
