# ml — Feature Gap vs Hugging Face

Category leader (2026): Hugging Face (model hub + training/eval tooling). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/ml.js` — 4 macros: modelEvaluate, featureImportance, datasetProfile, hyperparameterSuggest + MlRepos, MlActionPanel, arXiv research panel.

## Has (verified in code)
- Model evaluation — compute metrics (accuracy, precision/recall etc.) on supplied predictions
- Feature importance — rank input features by contribution
- Dataset profiling — summarize a dataset's shape, distributions, quality
- Hyperparameter suggestion — recommend tuning ranges
- MlRepos — model/repo browser; MlActionPanel; arXiv ML-paper feed
- Realtime feed, DTU export, lens artifact store for models/runs

## Missing — buildable feature backlog
- [ ] `[L]` Model hub — browsable catalog of models with cards, tags, downloads (Hugging Face core)
- [ ] `[L]` Inference playground — run a model on user input in-lens
- [ ] `[M]` Training run tracking — log experiments with metrics, params, artifacts over time
- [ ] `[M]` Dataset hub — versioned datasets with viewer and splits
- [ ] `[M]` Model comparison — leaderboard / side-by-side eval across models
- [ ] `[S]` AutoML / pipeline templates — guided model-building flows
- [ ] `[M]` Deployment — publish a model as a callable endpoint
- [ ] `[S]` Spaces-style shareable demo apps for models

## Parity
~30% of Hugging Face's surface. Solid evaluation/profiling helpers (model eval, feature importance, dataset profile, HP suggest), but missing the model hub, inference playground, experiment tracking, and dataset hub that constitute the Hugging Face ecosystem.
