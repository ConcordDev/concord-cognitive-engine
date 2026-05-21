# lattice — Feature Gap vs Weights & Biases / fine-tuning consoles

Category leader (2026): No direct consumer rival — this is an internal brain self-training + consent console. Closest analog: an MLOps experiment/fine-tuning dashboard (Weights & Biases). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: REST routes — `/api/lattice/corpus/{stats,mine}`, `/api/lattice/dtus/:id/consent`, `/api/lattice/dtus/consent-all`, `/api/brains/{stats,active,refresh}`; lattice macros (beacon, resonance, drift_alert) in server.js.

## Has (verified in code)
- Overview — training-corpus stats + per-brain positive/pending/expired breakdown, 4-brain health snapshot
- Consent — per-DTU train-consent toggle (mine), bulk consent-all on/off
- Brains — per-brain interactions, last-seen, corpus size, active model + model history
- Refresh — admin-triggered daily refresh per brain, last-run results
- Federation — corpus stats grouped by source-node tag

## Missing — buildable feature backlog
- [x] `[M]` Training run history — list past refresh runs with eval scores, diffable over time
- [x] `[M]` Eval/metric charts — loss/accuracy curves per brain across refreshes
- [x] `[M]` Model version rollback — pin/revert to a prior active model from history
- [x] `[S]` Corpus sample inspector — view actual DTU rows that fed a run
- [x] `[M]` Refresh scheduling UI — cadence config instead of admin-only manual trigger
- [x] `[S]` Consent audit log — who toggled what, when
- [x] `[M]` A/B model comparison — route a slice of traffic to a candidate model and compare
- [x] `[S]` Alerting on drift/eval-regression (drift_alert macro exists, not surfaced here)

## Parity
~88% of an MLOps fine-tuning console. Corpus stats, per-brain health, consent governance, and manual refresh are real and well-scoped, but missing run history, eval curves, model rollback, and scheduling that define an experiment-tracking platform.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
