# Neuro Lens — Capability Map (Frontend Rebuild Program, Wave 2 batch 6)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("neuro"' server/domains/neuro.js` → 14

## Reference apps + parity target

- **EEGLAB / MNE-Python** — the real neuroscience analysis workbench:
  import a recording, preprocess (filter/artifact-reject), epoch around
  events, compute ERPs, time-frequency decomposition, source
  localization, topographic scalp maps, and statistical group testing.
  Concord's `EegWorkbench` already targets exactly this shape against
  the neuro domain's recording-analysis macros.
- **A frequency/connectivity EEG bench** (the FFT-band-power +
  functional-connectivity + ERP class of tool clinicians and BCI
  researchers use for quick signal exploration) — Concord's
  `NeuroActionPanel` covers this on explicitly-disclosed synthetic
  signals.
- **A minimal neural-network training console** (the "attach data, watch
  loss/accuracy converge" shape common to notebook-style ML tools) —
  the one macro (`neuro.train`) neither of the above panels reached.
- **Parity target** (owner's framing): the only difference between the
  neuro lens and EEGLAB/MNE-Python + a toy-network trainer combined
  should be which recordings/datasets are attached — every spectral
  band, connectivity edge, ERP peak, and training-loss number on screen
  should trace to a real neuro-domain macro run against either a real
  imported recording or an explicitly-disclosed synthetic signal, never
  a silent placeholder.

## Checklist — reference-app features vs. Concord neuro

| Feature | Bucket | Disposition |
|---|---|---|
| Import an EEG/MEG recording (multi-channel, sample rate) | ALREADY REAL | `neuro.importSignal` → `EegWorkbench` |
| Recording library (list/delete) | ALREADY REAL | `neuro.listRecordings`/`deleteRecording` → `EegWorkbench` |
| Raw waveform viewer over a time window | ALREADY REAL | `neuro.waveformWindow` → `EegWorkbench` |
| Topographic scalp map | ALREADY REAL | `neuro.topographicMap` → `EegWorkbench` |
| Preprocessing pipeline (filter/artifact rejection) | ALREADY REAL | `neuro.preprocess` → `EegWorkbench` |
| Epoching around events | ALREADY REAL | `neuro.epochData` → `EegWorkbench` |
| ERP (event-related potential) analysis, real recordings | ALREADY REAL | `neuro.erpAnalysis` → `EegWorkbench` |
| Time-frequency decomposition | ALREADY REAL | `neuro.timeFrequency` → `EegWorkbench` |
| Source localization | ALREADY REAL | `neuro.sourceLocalization` → `EegWorkbench` |
| Statistical group testing (condition A vs. B) | ALREADY REAL | `neuro.statisticalTest` → `EegWorkbench` |
| FFT band-power analysis (delta/theta/alpha/beta/gamma + arousal/attention indices) | ALREADY REAL | `neuro.frequencyAnalysis` → `NeuroActionPanel` (explicitly-disclosed synthetic bench signal) |
| Functional connectivity (cross-channel correlation, network metrics, hubs) | ALREADY REAL | `neuro.connectivityAnalysis` → `NeuroActionPanel` |
| ERP analysis, bench/demo signal | ALREADY REAL | `neuro.erpAnalysis` (second call site) → `NeuroActionPanel` |
| Mint/publish/DM/agent-interpret a bench result as a DTU | ALREADY REAL | `NeuroActionPanel` mint/DM/publish/agent actions |
| Train a network and watch loss/accuracy converge | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `neuro.train` had zero UI (a fake "Training/Networks/Datasets/Experiments/Metrics" CRUD library where users hand-typed an `accuracy`/`loss` number stood in its place) — **fixed this rebuild**, new `NeuroTrainPanel` |
| Live neuroscience research feed (papers) | ALREADY REAL | `ArxivPanel` (arXiv q-bio.NC) + `PubMedPanel` (neuroscience-filtered) |
| Encyclopedia-grade neuroscience reference | ALREADY REAL | `WikipediaSearchPanel` |
| Cross-lens neuro DTU feed | ALREADY REAL | `NeuroFeed` |

Every checklist item now resolves to ALREADY REAL. The one real gap
(`neuro.train`) is fixed this rebuild — no GENUINELY MISSING items
remain.

## What this rebuild fixed

1. **Removed a fully fabricated Networks/Neurons/Training/Datasets/
   Experiments/Metrics CRUD system.** Six tabs backed by a disconnected
   `useLensData('neuro', <type>, ...)` generic store: a user hand-typed
   `accuracy`, `loss`, `neurons`, `layers`, `epochs`, `learningRate`
   etc. as free-form form fields with **zero computation behind any of
   it** — the numbers were whatever the user typed, never derived from
   a real training run — and the "Activate" button per row called a
   generic `train` action string with no macro dispatch wired to it at
   all (`useRunArtifact` posted to a *different* generic runner, not
   `neuro.train`). This is exactly the fabricated-metric pattern
   CLAUDE.md's zero-demo-content invariant names — a stat panel
   computing "Avg Accuracy" from user-typed placeholder numbers. The two
   genuinely real, deeply-built components underneath it
   (`EegWorkbench` at 800 LOC covering 11 of 14 macros, `NeuroActionPanel`
   covering 3 more) were mounted below the fake library, effectively
   footnoted behind it.
2. **Removed the generic catalog fallback + the generic per-item action
   row** that stood in front of the two real panels (a "Lens Features &
   Capabilities" listing plus a compact generic action strip keyed off
   whichever fake item happened to be first in the list) — both
   redundant now that the full macro surface has real designed homes.
3. **New `NeuroTrainPanel`** wires the one previously-unsurfaced macro,
   `neuro.train`, honestly in both of its two real backend modes:
   - **Toy dataset mode**: generates a small labelled 2-D gaussian-
     cluster point cloud (explicitly disclosed as synthetic, matching
     the same honesty framing `NeuroActionPanel` already uses for its
     bench signals) and runs **real logistic-regression gradient
     descent** against it server-side, epoch by epoch — the backend
     itself reports `simulated: false` for this path and the panel
     never overrides that flag.
   - **Projection mode**: no dataset attached — a deterministic
     learning-curve projection derived from the network's own
     hyperparameters (layers/neurons/samples/optimizer). The backend
     stamps this `simulated: true, basis: "hyperparameter_projection"`
     and the panel surfaces that note verbatim, never hiding it.
   - Both modes render a real loss/accuracy-per-epoch chart from the
     macro's own `history` array (never a client-invented curve).
4. **Reorganized the page** around `EegWorkbench` (real recordings) +
   `NeuroActionPanel` (bench signals) + the new `NeuroTrainPanel`
   (training) + `NeuroFeed` (cross-lens feed) — no tabs left standing
   for data that was never real.

## Left alone (already real)

`EegWorkbench`, `NeuroActionPanel`, `NeuroFeed`, `ArxivPanel`,
`PubMedPanel`, `WikipediaSearchPanel` — all pre-existing, already wired
against real `neuro.*` macros or real external data (arXiv/PubMed/
Wikipedia).

## Verification

- `npx eslint app/lenses/neuro/page.tsx components/neuro/*.tsx` — clean, 0 errors / 0 warnings.
- `npx tsc --noEmit -p .` — 0 errors project-wide (run together with quantum + fractal).
- `tests/neuro-lens-states.test.tsx` — rewritten this rebuild (the prior version tested the retired `useLensData` CRUD scaffold's loading/error/empty/populated states, which no longer exist in the page). The replacement pins `NeuroTrainPanel`'s real dispatch (`lensRun('neuro','train',...)` with a real synthetic dataset in toy mode, hyperparameters-only in projection mode) and its UX states (populated-trained, populated-projection with the honest `simulated` note always visible, transport error, thrown/rejected error) — 6/6 passing.
- `node scripts/verify-lens-backends.mjs` — neuro stays WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — neuro: `tier: "polished"`, `isGenericScaffold: false` (was `functional` / `isGenericScaffold: true` before this rebuild).
