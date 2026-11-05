/**
 * Quantum CircuitComposer — parametric placement (F3) + Clear guard (F6).
 *
 * F3: parametric gates (RX/RY/RZ/P) could not be placed at all — the
 * placement path gated on window.prompt() for the angle, a native
 * dialog that never returns a value in the product shell, so the wire
 * click died there. Placement now consumes an inline θ control; these
 * tests drive all four parametric gates through it and pin the angle
 * into the placed gate's params (the shape the simulator reads).
 * F6: Clear circuit was one unguarded click; it now arms first.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import {
  CircuitComposer, type GateDef, type PlacedGate,
} from '@/components/quantum/CircuitComposer';

// Mirrors the server's gateLibrary() output shape.
const GATE_LIB: GateDef[] = [
  { id: 'H', label: 'Hadamard', qubits: 1, parametric: false },
  { id: 'X', label: 'Pauli-X', qubits: 1, parametric: false },
  { id: 'RX', label: 'RX rotation', qubits: 1, parametric: true, param: 'theta' },
  { id: 'RY', label: 'RY rotation', qubits: 1, parametric: true, param: 'theta' },
  { id: 'RZ', label: 'RZ rotation', qubits: 1, parametric: true, param: 'theta' },
  { id: 'P', label: 'P rotation', qubits: 1, parametric: true, param: 'theta' },
  { id: 'CNOT', label: 'CNOT', qubits: 2, parametric: false },
  { id: 'MEASURE', label: 'Measure', qubits: 1, parametric: false },
];

function Harness({ initial = [] as PlacedGate[], onChange }: { initial?: PlacedGate[]; onChange?: (g: PlacedGate[]) => void }) {
  const [placed, setPlaced] = useState<PlacedGate[]>(initial);
  return (
    <CircuitComposer
      gateLibrary={GATE_LIB}
      qubits={2}
      onQubitsChange={() => {}}
      placed={placed}
      onPlacedChange={(g) => { setPlaced(g); onChange?.(g); }}
    />
  );
}

function cell(container: HTMLElement, qubit: number, column: number): HTMLElement {
  const rows = container.querySelectorAll('tbody tr');
  const tds = rows[qubit].querySelectorAll('td');
  return tds[column + 1] as HTMLElement; // td[0] is the q[n] label
}

describe('parametric gate placement (F3)', () => {
  it('RX places with θ = π from the quick-set, no dialog, angle on the chip', () => {
    const seen: PlacedGate[][] = [];
    const { container } = render(<Harness onChange={(g) => seen.push(g)} />);
    fireEvent.click(screen.getByRole('button', { name: 'RX' }));
    // the inline angle control appears while a parametric gate is armed
    expect(screen.getByLabelText('θ (rad)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'π' }));
    fireEvent.click(cell(container, 0, 0));
    const placed = seen[seen.length - 1];
    expect(placed).toHaveLength(1);
    expect(placed[0].gate).toBe('RX');
    expect(placed[0].targets).toEqual([0]);
    expect(placed[0].params?.theta).toBeCloseTo(Math.PI, 10);
    // the placed chip shows the angle — the parameter is part of the circuit
    expect(cell(container, 0, 0).textContent).toContain('RX');
    expect(cell(container, 0, 0).textContent).toContain('3.14');
  });

  it('RY, RZ and P each place with the typed angle', () => {
    for (const [gate, theta] of [['RY', 0.5], ['RZ', 1.25], ['P', 2.75]] as const) {
      const seen: PlacedGate[][] = [];
      const { container, unmount } = render(<Harness onChange={(g) => seen.push(g)} />);
      fireEvent.click(screen.getByRole('button', { name: gate }));
      fireEvent.change(screen.getByLabelText('θ (rad)'), { target: { value: String(theta) } });
      fireEvent.click(cell(container, 1, 0));
      const placed = seen[seen.length - 1];
      expect(placed).toHaveLength(1);
      expect(placed[0].gate).toBe(gate);
      expect(placed[0].targets).toEqual([1]);
      expect(placed[0].params?.theta).toBeCloseTo(theta, 10);
      unmount();
    }
  });

  it('a non-parametric gate still places with no params and no angle control', () => {
    const seen: PlacedGate[][] = [];
    const { container } = render(<Harness onChange={(g) => seen.push(g)} />);
    fireEvent.click(screen.getByRole('button', { name: 'H' }));
    expect(screen.queryByLabelText('θ (rad)')).toBeNull();
    fireEvent.click(cell(container, 0, 0));
    const placed = seen[seen.length - 1];
    expect(placed[0].gate).toBe('H');
    expect(placed[0].params).toBeUndefined();
  });
});

describe('Clear circuit guard (F6)', () => {
  it('the first click arms a confirmation naming the count; only Clear empties', () => {
    const seen: PlacedGate[][] = [];
    const initial: PlacedGate[] = [
      { uid: 'a', gate: 'H', column: 0, targets: [0], controls: [] },
      { uid: 'b', gate: 'X', column: 1, targets: [1], controls: [] },
    ];
    render(<Harness initial={initial} onChange={(g) => seen.push(g)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear circuit' }));
    expect(screen.getByText(/Clear all 2 gates\?/)).toBeTruthy();
    expect(seen).toHaveLength(0); // nothing cleared yet
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(seen[seen.length - 1]).toEqual([]);
  });

  it('Cancel disarms without clearing', () => {
    const seen: PlacedGate[][] = [];
    const initial: PlacedGate[] = [{ uid: 'a', gate: 'H', column: 0, targets: [0], controls: [] }];
    render(<Harness initial={initial} onChange={(g) => seen.push(g)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear circuit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(seen).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Clear circuit' })).toBeTruthy();
  });
});
