# quantum — Feature Gap vs IBM Quantum Composer

Category leader (2026): IBM Quantum Composer / Quirk (quantum circuit simulator). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/quantum.js` — 3 macros (simulateCircuit, analyzeCircuit, errorAnalysis); page also calls the chat brain for LLM-assisted explanation.

## Has (verified in code)
- Circuit simulation macro — run a gate circuit and return state/measurement results
- Circuit analysis macro — structural analysis of a quantum circuit
- Error analysis macro — model gate/decoherence error rates
- LLM-assisted quantum explanation via the chat brain

## Missing — buildable feature backlog
- [ ] `[L]` Visual circuit composer — drag-and-drop gates onto qubit wires
- [ ] `[M]` State visualization — Bloch sphere, amplitude/probability histograms, Q-sphere
- [ ] `[M]` Gate library — full set (H, X, Y, Z, CNOT, T, rotations, custom) with parameters
- [ ] `[S]` QASM import/export — interoperate with OpenQASM circuits
- [ ] `[M]` Algorithm templates — Grover, Shor, QFT, teleportation starter circuits
- [ ] `[S]` Step-through execution — animate the statevector gate by gate
- [ ] `[S]` Noise model presets — simulate on realistic device noise profiles

## Parity
~30% of IBM Quantum Composer's feature surface. The simulation/analysis/error macros are a real compute core, but with no visual circuit composer, no statevector visualization, and no gate-library UI it is a backend without the interactive workbench that defines the category.
