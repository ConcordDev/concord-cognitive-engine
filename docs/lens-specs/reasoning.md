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
- [ ] `[M]` Visual argument tree — render claims/premises/objections as an interactive map
- [ ] `[M]` Pro/con branching (Kialo-style) — support and counter-arguments nested per claim
- [ ] `[S]` Evidence linking with strength weighting — attach evidence to specific premises
- [ ] `[S]` Collaborative debate — multiple authors contributing arguments to one map
- [ ] `[M]` Argument scoring — compute conclusion confidence from premise/evidence weights
- [ ] `[S]` Export argument map — image/outline export for sharing
- [ ] `[S]` Reasoning templates library — common argument schemes (analogy, causal, etc.)

## Parity
~50% of Rationale/Kialo's feature surface. The logic/fallacy/premise macros are a real critical-thinking engine and the 6-tab structure is well-organized, but it lacks the visual argument tree and pro/con branching that make argument-mapping tools intuitive.
