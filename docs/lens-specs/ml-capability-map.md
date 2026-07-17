# ml — capability map (Frontend Rebuild Program, Wave 2 batch 6)

Reference apps: a real ML experiment-tracking/training tool — **Weights &
Biases** (run tracking, hyperparameter logging, metric curves, model
comparison) and **Hugging Face Hub** (model cards, inference widgets,
dataset hub, Spaces demos). Both are the closest real-world category
leaders to what this lens's backend already computes — a per-user model
hub, inference playground, experiment tracker, dataset hub, model
comparison, AutoML template picker, and deployment/Spaces lifecycle.

## Backend macro surface (verified via reading `server/domains/ml.js`)

`registerLensAction("ml", ...)` — 23 macros, all pure compute or in-memory
per-user workspace state:

- **Calculators**: `modelEvaluate`, `featureImportance`, `datasetProfile`, `hyperparameterSuggest`
- **Model hub**: `model-hub`, `model-card`
- **Inference**: `playground-infer`
- **Experiment tracking**: `experiment-start`, `experiment-log`, `experiment-finish`, `experiment-list`, `experiment-delete`
- **Datasets**: `dataset-hub`, `dataset-register`, `dataset-list`
- **Comparison**: `model-compare`
- **AutoML**: `automl-templates`
- **Deployments**: `deploy-create`, `deploy-list`, `deploy-scale`, `deploy-stop`
- **Spaces (demo apps)**: `space-create`, `space-list`, `space-delete`

## Pre-existing frontend depth (found BEFORE this rebuild)

`concord-frontend/components/ml/` already had 10 files of real, macro-wired
UI:

- `ModelHubPanel.tsx` — browses `model-hub`, opens `model-card` detail, and
  routes a chosen model into the inference playground.
- `InferencePlayground.tsx` — `playground-infer`.
- `ExperimentTracker.tsx` — full W&B-style run tracking: create
  (`experiment-start`), list/select (`experiment-list`), append a metric
  point (`experiment-log`), finish/fail (`experiment-finish`), delete
  (`experiment-delete`), with a real per-run loss/accuracy chart built from
  the persisted metric history.
- `DatasetHubPanel.tsx` — `dataset-hub`/`dataset-register`/`dataset-list`.
- `ModelComparePanel.tsx` — `model-compare`.
- `AutoMLPanel.tsx` — `automl-templates`, routes the chosen template into
  the playground.
- `DeploymentsPanel.tsx` — `deploy-create`/`deploy-list`/`deploy-scale`/`deploy-stop`.
- `SpacesPanel.tsx` — `space-create`/`space-list`/`space-delete`.
- `MlActionPanel.tsx` — the analysis bench wiring the four pure-compute
  macros (`modelEvaluate`/`featureImportance`/`datasetProfile`/
  `hyperparameterSuggest`).
- `MlRepos.tsx` — live GitHub topic search (machine-learning/deep-learning/
  pytorch/etc.), real external API data.

All 23 backend macros were already surfaced through real, designed UI before
this rebuild touched anything — confirmed by cross-referencing every
`registerLensAction("ml", ...)` name against `lensRun('ml', …)` /
`callMacro(...)` call sites in the component tree. There is no unsurfaced
macro and no disconnected `useLensData` fake-CRUD store anywhere in this
lens.

## What was actually wrong

Two things, one structural (shared with every lens in this wave) and one a
genuine honesty gap found while auditing:

1. **Generic scaffold body.** The page imported and rendered the generic
   manifest-driven action bar and the generic lens-feature-spec panel
   (behind a "Lens Features & Capabilities" toggle) alongside the real
   bespoke depth above. Neither `analyze`, `generate`, nor `suggest` is
   registered anywhere in `ml.js`, so the generic action bar had nothing
   domain-specific to offer over the eight real tabs already in place. The
   honest UX grader correctly flagged this and capped the lens at
   `functional`.
2. **`ExperimentTracker`'s only way to advance a run's metrics was a
   "Log epoch" button that silently generated a synthetic decay-curve
   number** (there is no in-browser GPU training loop to log real steps
   from, so *some* placeholder mechanism was defensible — but the button
   read as if it were logging a real training step, with no visual signal
   that the numbers were synthetic). This is the class of thing CLAUDE.md's
   honest-by-construction rule calls out: a surface that can't do the real
   thing should say so, not produce a plausible-looking success silently.

## What changed

- Removed the generic action-bar and lens-feature-panel body from the page
  (import + JSX usage both gone), along with the now-unused `showFeatures`
  toggle state and its icon imports.
- `ExperimentTracker.tsx`: renamed the synthetic-data button to
  **"Simulate epoch"** with an explicit tooltip ("No metrics on hand?
  Generate one synthetic decay-curve step to see the tracker in action"),
  and added a real **"Log metrics"** manual-entry form (train loss / val
  loss / accuracy number inputs → `Record`) that calls the same
  `experiment-log` macro with user-supplied numbers — the honest path for
  anyone pasting in results from an actual external training run. Both
  paths persist through the identical real macro; only the synthetic path
  is now labeled as synthetic.

## Reference-parity checklist (Weights & Biases / Hugging Face Hub shape)

| Capability | Disposition | Where |
|---|---|---|
| Model registry / hub with model cards | ALREADY REAL | `ModelHubPanel` (`model-hub`/`model-card`) |
| Interactive inference playground | ALREADY REAL | `InferencePlayground` (`playground-infer`) |
| Experiment/run tracking with metric history + charts | ALREADY REAL | `ExperimentTracker` (`experiment-*`) |
| Manual metric logging (for an external training job) | WAS GENUINELY MISSING (only a synthetic-generator button existed) → **now surfaced** | `ExperimentTracker` "Log metrics" form |
| Dataset hub (browse/register/list) | ALREADY REAL | `DatasetHubPanel` (`dataset-*`) |
| Side-by-side model comparison | ALREADY REAL | `ModelComparePanel` (`model-compare`) |
| AutoML template picker | ALREADY REAL | `AutoMLPanel` (`automl-templates`) |
| Deployment lifecycle (create/scale/stop) | ALREADY REAL | `DeploymentsPanel` (`deploy-*`) |
| Demo "Spaces" app lifecycle | ALREADY REAL | `SpacesPanel` (`space-*`) |
| Model evaluation / feature importance / dataset profiling / hyperparameter suggestion bench | ALREADY REAL | `MlActionPanel` (`modelEvaluate`/`featureImportance`/`datasetProfile`/`hyperparameterSuggest`) |
| Real-world tooling reference (PyTorch/TF/HF repos) | ALREADY REAL | `MlRepos` (live GitHub search) |
| Cross-community research feed | ALREADY REAL | `ArxivPanel` (arXiv cs.LG) |
| Actual GPU-backed model training (submit a training job, watch it run) | **CLOSED (2026-07-17, `63bd69b4`)** as real *CPU* training (GPU/job-cluster remains genuinely out of scope) | New `server/lib/ml-trainer.js` runs a genuine seeded, deterministic small-scale CPU trainer (logistic regression + k-means), fail-closed on sparse/degenerate data. The `experiment-train` macro logs its REAL per-epoch loss curve into the existing experiment record shape. Explicitly labeled "small in-process CPU training — no GPU, no deep learning, no hub model," so it never borrows the HuggingFace hub's credibility. 26 tests incl. convergence/determinism/honest-failure proofs. GPU-backed distributed training (a job queue + compute cluster) is still correctly out of scope. |

## Verify-gate results

- `npx eslint app/lenses/ml/page.tsx components/ml/*.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `npx vitest run tests/ml-lens-states.test.tsx` — 5/5 passing (unchanged; targets `ModelHubPanel`/`ExperimentTracker` state contracts, unaffected by the label/form addition's shape).
- `node scripts/verify-lens-backends.mjs` — `ml` stays WIRED; total unchanged at 258 WIRED / 2 NO-BACKEND-CALL / 260.
- `node scripts/grade-ux-polish.mjs --honest` — `ml` now `tier: "polished"`, `isGenericScaffold: false` (was `functional`/`true` before).
