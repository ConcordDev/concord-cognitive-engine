'use client';

/**
 * CircuitComposer — a real visual quantum circuit composer.
 * A qubit-wire grid: rows are qubits, columns are time steps. Click a gate
 * in the palette to "arm" it, then click a cell to place it. Two/three-qubit
 * gates auto-prompt for control/target wiring. The composed circuit is a
 * plain { qubits, gates } object the statevector simulator understands.
 */

import { useState } from 'react';
import { X } from 'lucide-react';

export interface GateDef {
  id: string;
  label: string;
  qubits: number;
  parametric: boolean;
  param?: string;
}

// A single placed gate occupies one column. multi-qubit gates record
// controls + targets so the simulator can route them.
export interface PlacedGate {
  uid: string;
  gate: string;
  column: number;
  targets: number[];
  controls: number[];
  params?: { theta: number };
}

export interface Circuit {
  qubits: number;
  gates: Array<{ gate: string; targets: number[]; controls: number[]; params?: { theta: number } }>;
}

const SINGLE_COLORS: Record<string, string> = {
  H: 'bg-violet-500/80 border-violet-300',
  X: 'bg-rose-500/80 border-rose-300',
  Y: 'bg-amber-500/80 border-amber-300',
  Z: 'bg-sky-500/80 border-sky-300',
  S: 'bg-cyan-500/80 border-cyan-300',
  SDG: 'bg-cyan-600/80 border-cyan-300',
  T: 'bg-emerald-500/80 border-emerald-300',
  TDG: 'bg-emerald-600/80 border-emerald-300',
  I: 'bg-zinc-600/80 border-zinc-400',
  RX: 'bg-fuchsia-500/80 border-fuchsia-300',
  RY: 'bg-fuchsia-500/80 border-fuchsia-300',
  RZ: 'bg-fuchsia-500/80 border-fuchsia-300',
  P: 'bg-indigo-500/80 border-indigo-300',
  MEASURE: 'bg-yellow-500/80 border-yellow-300',
};

let uidCounter = 0;
function nextUid() { uidCounter += 1; return `g${uidCounter}_${Date.now().toString(36)}`; }

export function CircuitComposer({
  gateLibrary,
  qubits,
  onQubitsChange,
  placed,
  onPlacedChange,
}: {
  gateLibrary: GateDef[];
  qubits: number;
  onQubitsChange: (n: number) => void;
  placed: PlacedGate[];
  onPlacedChange: (gates: PlacedGate[]) => void;
}) {
  const [armed, setArmed] = useState<GateDef | null>(null);
  // multi-qubit placement in progress: collected wires for the active gate
  const [pendingWires, setPendingWires] = useState<{ column: number; wires: number[] } | null>(null);

  const columns = Math.max(8, (placed.reduce((m, g) => Math.max(m, g.column), -1) + 2));

  const gateAt = (qubit: number, column: number): PlacedGate | undefined =>
    placed.find((g) => g.column === column && (g.targets.includes(qubit) || g.controls.includes(qubit)));

  const cancelPending = () => { setPendingWires(null); };

  const placeSingle = (gate: GateDef, qubit: number, column: number) => {
    let params: { theta: number } | undefined;
    if (gate.parametric) {
      const raw = window.prompt(`Rotation angle θ for ${gate.id} (radians)`, '1.5708');
      if (raw === null) return;
      params = { theta: Number(raw) || 0 };
    }
    onPlacedChange([
      ...placed,
      { uid: nextUid(), gate: gate.id, column, targets: [qubit], controls: [], params },
    ]);
  };

  const handleCellClick = (qubit: number, column: number) => {
    const existing = gateAt(qubit, column);
    if (existing && !armed && !pendingWires) {
      // click an existing gate with nothing armed → remove it
      onPlacedChange(placed.filter((g) => g.uid !== existing.uid));
      return;
    }
    if (!armed && !pendingWires) return;

    if (pendingWires) {
      // continuing a multi-qubit placement on the same column
      if (pendingWires.wires.includes(qubit)) return;
      const armedGate = armed!;
      const wires = [...pendingWires.wires, qubit];
      if (wires.length < armedGate.qubits) {
        setPendingWires({ column: pendingWires.column, wires });
        return;
      }
      // complete: for SWAP all wires are targets; otherwise the first
      // wires are controls and the last is the target.
      const controls = armedGate.id === 'SWAP' ? [] : wires.slice(0, wires.length - 1);
      const targets = wires;
      onPlacedChange([
        ...placed,
        {
          uid: nextUid(),
          gate: armedGate.id,
          column: pendingWires.column,
          targets,
          controls,
        },
      ]);
      setPendingWires(null);
      setArmed(null);
      return;
    }

    if (!armed) return;
    if (gateAt(qubit, column)) return; // occupied
    if (armed.qubits === 1) {
      placeSingle(armed, qubit, column);
      setArmed(null);
    } else {
      // start multi-qubit wiring on this column
      setPendingWires({ column, wires: [qubit] });
    }
  };

  return (
    <div className="space-y-3">
      {/* Palette */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-zinc-400 mr-1">Gates</span>
        {gateLibrary.map((g) => (
          <button
            key={g.id}
            onClick={() => { setArmed(armed?.id === g.id ? null : g); setPendingWires(null); }}
            className={`px-2 py-1 rounded text-xs font-mono font-bold border transition-all ${
              armed?.id === g.id
                ? 'bg-neon-purple text-white border-neon-purple ring-2 ring-neon-purple/50'
                : `${SINGLE_COLORS[g.id] || 'bg-zinc-700/70 border-zinc-500'} text-white hover:brightness-125`
            }`}
            title={`${g.label}${g.qubits > 1 ? ` · ${g.qubits}-qubit` : ''}${g.parametric ? ' · parametric' : ''}`}
          >
            {g.id}
          </button>
        ))}
      </div>

      {/* Qubit count + status */}
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-zinc-400">Qubits</span>
          <input
            type="range" min={1} max={8} value={qubits}
            onChange={(e) => onQubitsChange(Number(e.target.value))}
            className="w-28"
          />
          <span className="font-mono text-neon-purple w-4">{qubits}</span>
        </label>
        {armed && (
          <span className="text-neon-cyan">
            {armed.qubits === 1
              ? `Click a cell to place ${armed.id}`
              : `Click ${armed.qubits} wires for ${armed.id} (controls first, target last)`}
          </span>
        )}
        {pendingWires && (
          <span className="text-amber-400 flex items-center gap-1">
            wiring {armed?.id}: {pendingWires.wires.length}/{armed?.qubits} wires
            <button aria-label="Close" onClick={cancelPending} className="text-zinc-400 hover:text-white"><X className="w-3 h-3" /></button>
          </span>
        )}
        {placed.length > 0 && !armed && !pendingWires && (
          <span className="text-zinc-400">Click a placed gate to remove it</span>
        )}
        <button
          onClick={() => onPlacedChange([])}
          disabled={placed.length === 0}
          className="ml-auto px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:text-white disabled:opacity-40"
        >
          Clear circuit
        </button>
      </div>

      {/* Wire grid */}
      <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3">
        <table className="border-separate" style={{ borderSpacing: 0 }}>
          <tbody>
            {Array.from({ length: qubits }, (_, q) => (
              <tr key={q}>
                <td className="pr-2 font-mono text-[11px] text-neon-purple whitespace-nowrap align-middle">
                  q[{q}]
                </td>
                {Array.from({ length: columns }, (_, col) => {
                  const g = gateAt(q, col);
                  const isControl = g && g.controls.includes(q);
                  const isTarget = g && g.targets.includes(q) && !g.controls.includes(q);
                  const isPending = pendingWires?.column === col && pendingWires.wires.includes(q);
                  return (
                    <td
                      key={col}
                      onClick={() => handleCellClick(q, col)}
                      className="relative cursor-pointer"
                      style={{ width: 44, height: 40 }}
                    >
                      {/* wire line */}
                      <div className="absolute left-0 right-0 top-1/2 h-px bg-zinc-700" />
                      {/* vertical link connecting the wires of a multi-qubit gate */}
                      {g && (g.targets.length > 1 || g.controls.length > 0) && (() => {
                        const wires = [...g.controls, ...g.targets];
                        const lo = Math.min(...wires), hi = Math.max(...wires);
                        if (q < lo || q > hi) return null;
                        const top = q > lo;       // link upward
                        const bottom = q < hi;    // link downward
                        return (
                          <>
                            {top && <div className="absolute left-1/2 -translate-x-1/2 top-0 h-1/2 w-px bg-neon-cyan" />}
                            {bottom && <div className="absolute left-1/2 -translate-x-1/2 bottom-0 h-1/2 w-px bg-neon-cyan" />}
                          </>
                        );
                      })()}
                      {/* gate body */}
                      {isControl && (
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-neon-cyan border border-cyan-200" />
                      )}
                      {isTarget && g && (
                        <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded text-[10px] font-mono font-bold text-white border ${
                          SINGLE_COLORS[g.gate] || 'bg-zinc-700 border-zinc-500'
                        }`} style={{ width: 30, height: 26 }}>
                          {g.gate === 'CNOT' || g.gate === 'CX' ? '⊕'
                            : g.gate === 'SWAP' ? '✕'
                              : g.gate === 'MEASURE' ? 'M'
                                : g.gate}
                        </div>
                      )}
                      {isPending && !g && (
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-400/80 border border-amber-200" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
