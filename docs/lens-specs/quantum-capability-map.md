# Quantum Lens — Capability Map (Frontend Rebuild Program, Wave 2 batch 6)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("quantum"' server/domains/quantum.js` → 13

## Reference apps + parity target

- **IBM Quantum Composer / Qiskit** — the real, best-in-class visual
  circuit-design tool: drag-and-drop gates onto a qubit-wire grid, a
  real statevector simulator, measurement histograms, OpenQASM
  import/export, and algorithm templates (Bell, GHZ, QFT, Grover,
  teleportation). Concord's `CircuitComposer` + `simulateCircuit` +
  `exportQASM`/`importQASM` + `algorithmTemplate` macros are the same
  shape.
- **IBM Quantum's noise-model / error-mitigation panels** — device
  fidelity presets, T1/T2 decoherence, gate/readout error budgets,
  fault-tolerance cost (Clifford vs. non-Clifford T-count). Concord's
  `errorAnalysis` + `noisePresets` + `analyzeCircuit` cover this.
- **Parity target** (owner's framing): the only difference between the
  quantum lens and IBM Quantum Composer should be which real quantum
  hardware backend it eventually targets — every gate placement, every
  probability, every Bloch-sphere vector on screen already comes from a
  real state-vector simulation, never a placeholder.

## Checklist — reference-app features vs. Concord quantum

| Feature | Bucket | Disposition |
|---|---|---|
| Visual circuit composer (qubit wires × time-step grid, click-to-place gates, multi-qubit control/target wiring) | ALREADY REAL | `quantum.gateLibrary` → `CircuitComposer` (supports single-qubit H/X/Y/Z/S/SDG/T/TDG/I/RX/RY/RZ/P/MEASURE and multi-qubit CNOT/Toffoli/SWAP-style control+target wiring) |
| Real state-vector simulator with measurement histogram | ALREADY REAL | `quantum.simulateCircuit` → probability histogram + measurement-shot chart (`ChartKit`) |
| Bloch-sphere per-qubit visualization | ALREADY REAL | `simulateCircuit`/`stepCircuit` result → `BlochSphere` |
| Step-through circuit execution (inspect the state after each gate) | ALREADY REAL | `quantum.stepCircuit` → frame scrubber with a range slider |
| Circuit structural analysis (gate/T/CNOT counts, parallelism, fault-tolerance cost) | ALREADY REAL | `quantum.analyzeCircuit` → Circuit Analysis panel |
| Noise modeling + error-budget estimate (T1/T2, gate/readout error, fidelity) | ALREADY REAL | `quantum.noisePresets` + `quantum.errorAnalysis` → Noise Model & Error Analysis panel |
| Algorithm template library (Bell, GHZ, QFT, Grover, teleportation, Deutsch-Jozsa, superposition) | ALREADY REAL | `quantum.algorithmTemplate` → Templates row |
| OpenQASM 2.0 import/export | ALREADY REAL | `quantum.exportQASM`/`quantum.importQASM` → OpenQASM Interop panel |
| Save/load/delete circuits (personal circuit library) | ALREADY REAL | `quantum.saveCircuit`/`listCircuits`/`loadCircuit`/`deleteCircuit` → Saved Circuits panel |
| Keyboard-driven workflow (run/step/save without leaving the keyboard) | ALREADY REAL | `useLensCommand` bindings: `mod+enter` simulate, `mod+shift+enter` step, `mod+s` save |
| Live arXiv quant-ph research feed | ALREADY REAL | `ArxivPanel` (arXiv quant-ph) |
| Real-world quantum-computing project discovery | ALREADY REAL | `QuantumArxiv` component |

**Every one of the 13 registered `quantum.*` macros is already reachable
through a real, hand-designed feature** — the composer, simulator,
step-through, analysis, noise/error, templates, QASM interop, and saved-
circuits panels between them cover the full macro surface. No
GENUINELY MISSING items; nothing to relabel or defer.

## What this rebuild fixed

The quantum lens's real UI was already flagship-quality (a genuine
Qiskit-Composer-tier circuit builder), but the honest UX grader still
capped it at `functional` because the page also mounted a generic
"Lens Features & Capabilities" fallback listing — a collapsible panel
that re-lists every macro generically, which is exactly redundant once
every macro already has a real designed home in the composer above it.
Kept mounting it meant the page still leaned on the same catalog-style
body the auto-generated scaffold pages use, even though 100% of the
macro surface was otherwise hand-designed.

Removed the fallback listing (and its now-dead `showFeatures` toggle
state + the framer-motion collapse it drove) so the page is 100% the
bespoke composer, with nothing generic left standing in front of it.
No macro wiring changed — this was a presentation-layer cleanup, not a
capability fix, because there was no capability gap to fix.

## Left alone (already real)

`CircuitComposer`, `BlochSphere`, the step-through scrubber, circuit
analysis grid, noise/error-budget panel, OpenQASM interop, saved
circuits list, `ArxivPanel`, `QuantumArxiv` — all pre-existing, already
wired against real `quantum.*` macros or real external data (arXiv).

## Verification

- `npx eslint app/lenses/quantum/page.tsx components/quantum/*.tsx` — clean, 0 errors / 0 warnings.
- `npx tsc --noEmit -p .` — 0 errors project-wide (run together with fractal + neuro).
- No lens-specific vitest file exists for quantum (`find . -iname "*quantum*test*"` → none) — nothing to run; the existing bespoke composer already had no test coverage before this rebuild and this change made no behavioral change to it.
- `node scripts/verify-lens-backends.mjs` — quantum stays WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — quantum: `tier: "polished"`, `isGenericScaffold: false` (was `functional` / `isGenericScaffold: true` before this rebuild, solely due to the redundant fallback listing above).
