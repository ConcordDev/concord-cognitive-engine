# reasoning — Feature Gap vs Rationale / argument-mapping tools

Category leader (2026): Rationale / Kialo (argument mapping + critical thinking). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/reasoning.js` — 4 macros (logicValidate, argumentMap, fallacyDetect, premiseExtract) over the generic artifact store.

## Has (verified in code)
- 6 tabs: arguments, premises, evidence, fallacies, templates, analysis
- Logic validation — check argument validity/soundness
- Argument mapping — premises → conclusion structure
- Fallacy detection across an argument
- Premise extraction from prose; argument/premise/evidence artifact CRUD
- Argument templates; analysis view

## Missing — buildable feature backlog
- [x] `[M]` Visual argument tree — render claims/premises/objections as an interactive map
- [x] `[M]` Pro/con branching (Kialo-style) — support and counter-arguments nested per claim
- [x] `[S]` Evidence linking with strength weighting — attach evidence to specific premises
- [x] `[S]` Collaborative debate — multiple authors contributing arguments to one map
- [x] `[M]` Argument scoring — compute conclusion confidence from premise/evidence weights
- [x] `[S]` Export argument map — image/outline export for sharing
- [x] `[S]` Reasoning templates library — common argument schemes (analogy, causal, etc.)

## Parity
~90% of Rationale/Kialo's feature surface. The logic/fallacy/premise macros, the visual argument tree, pro/con branching, evidence linking, collaborative debate, argument scoring, map export, and the reasoning-templates library all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
