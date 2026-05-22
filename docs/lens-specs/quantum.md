# quantum — Feature Gap vs IBM Quantum Composer

Category leader (2026): IBM Quantum Composer / Quirk (quantum circuit simulator). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/quantum.js` — 13 macros: a real state-vector simulator (`simulateCircuit`, `stepCircuit`), `analyzeCircuit`, `errorAnalysis`, `gateLibrary`, `noisePresets`, `algorithmTemplate`, `exportQASM`, `importQASM`, and persistent per-user circuits (`saveCircuit`, `listCircuits`, `loadCircuit`, `deleteCircuit`). No LLM in the simulation math path.

## Has (verified in code)
- Circuit simulation macro — run a gate circuit and return state/measurement results
- Circuit analysis macro — structural analysis of a quantum circuit
- Error analysis macro — model gate/decoherence error rates
- LLM-assisted quantum explanation via the chat brain

## Missing — buildable feature backlog
- [x] `[L]` Visual circuit composer — click-to-place gates on a qubit-wire grid (`components/quantum/CircuitComposer.tsx`, multi-qubit control/target wiring)
- [x] `[M]` State visualization — SVG Bloch spheres (`components/quantum/BlochSphere.tsx`) + probability/amplitude histograms via ChartKit
- [x] `[M]` Gate library — full set (H, X, Y, Z, S, T, RX/RY/RZ/P rotations, CNOT, CZ, SWAP, Toffoli, Measure) served by the `gateLibrary` macro
- [x] `[S]` QASM import/export — `exportQASM` / `importQASM` macros wired to a QASM editor panel
- [x] `[M]` Algorithm templates — Bell, GHZ, QFT, Grover, teleportation, Deutsch-Jozsa, superposition via `algorithmTemplate`
- [x] `[S]` Step-through execution — `stepCircuit` macro emits per-gate statevector frames; UI step navigator animates them
- [x] `[S]` Noise model presets — `noisePresets` + `errorAnalysis` macros (ideal / IBM Eagle / IBM Heron / superconducting / trapped-ion)

## Parity
~90% parity. Full interactive workbench. A real gate-based state-vector simulator (complex amplitude vector + unitary application — `simulateCircuit`, verified by tests: H on |0⟩ → 50/50, Bell → maximally entangled), a visual circuit composer, Bloch-sphere + histogram visualization, the full gate library, QASM interop, algorithm templates, step-through animation, and device noise modelling. No LLM in the math path. Persistent per-user saved circuits via `saveCircuit`/`listCircuits`/`loadCircuit`/`deleteCircuit`.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
