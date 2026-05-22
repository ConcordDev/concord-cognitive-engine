# ml — Feature Gap vs Hugging Face

Category leader (2026): Hugging Face (model hub + training/eval tooling). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/ml.js` — 22 macros: modelEvaluate, featureImportance, datasetProfile, hyperparameterSuggest, model-hub, model-card, playground-infer, experiment-{start,log,finish,list,delete}, dataset-{hub,register,list}, model-compare, automl-templates, deploy-{create,list,scale,stop}, space-{create,list,delete} + MlRepos, MlActionPanel, arXiv research panel.

## Has (verified in code)
- Model evaluation — compute metrics (accuracy, precision/recall etc.) on supplied predictions
- Feature importance — rank input features by contribution
- Dataset profiling — summarize a dataset's shape, distributions, quality
- Hyperparameter suggestion — recommend tuning ranges
- MlRepos — model/repo browser; MlActionPanel; arXiv ML-paper feed
- Realtime feed, DTU export, lens artifact store for models/runs

## Missing — buildable feature backlog
- [x] `[L]` Model hub — browsable catalog of models with cards, tags, downloads (Hugging Face core)
- [x] `[L]` Inference playground — run a model on user input in-lens
- [x] `[M]` Training run tracking — log experiments with metrics, params, artifacts over time
- [x] `[M]` Dataset hub — versioned datasets with viewer and splits
- [x] `[M]` Model comparison — leaderboard / side-by-side eval across models
- [x] `[S]` AutoML / pipeline templates — guided model-building flows
- [x] `[M]` Deployment — publish a model as a callable endpoint
- [x] `[S]` Spaces-style shareable demo apps for models

## Parity
~85% of Hugging Face's feature surface. Full ecosystem now wired: model hub + cards (live HF API),
in-lens inference playground (HF Inference API), per-user experiment tracking with training-curve
charts, HF + per-user versioned dataset hub, leaderboard/side-by-side model comparison, guided
AutoML pipeline templates, callable-endpoint deployments with scaling, and Spaces-style demo apps —
all on top of the existing evaluation/profiling bench (model eval, feature importance, dataset
profile, HP suggest). Remaining structural gap is licensed/hosted training compute, not buildable.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
