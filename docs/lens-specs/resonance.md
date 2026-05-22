# resonance — Feature Gap vs cross-domain analogy / knowledge-graph tool

Category leader (2026): no direct consumer rival — closest analog is a cross-domain analogy / structural-correspondence analysis tool. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/resonance.js` — 3 macros (engagementScore, audienceMatch, impactPrediction) over the generic artifact store; the page works over a resonance-classification model (strong/moderate/weak/none signal).

## Has (verified in code)
- Cross-domain resonance classification: strong/moderate/weak/none signal tiers with descriptions
- 5 view modes: live, pairs, history, health, growth
- Engagement score, audience match, impact prediction macros
- Resonance pair analysis (cross-domain invariant alignment vs semantic overlap)
- Live signal view with classification metadata

## Missing — buildable feature backlog
- [x] `[M]` Resonance graph — visualize domain pairs and their resonance strength as a network
- [x] `[M]` Drill-down on a pair — show the specific invariants/constraints that align
- [x] `[S]` Resonance alerting — notify when a new strong cross-domain signal emerges
- [x] `[S]` Manual pair authoring — propose a domain pair to analyze
- [x] `[M]` Resonance-to-insight pipeline — turn a strong signal into a citable DTU/hypothesis
- [x] `[S]` Historical resonance trend charts per pair
- [x] `[S]` Export/share a resonance finding

## Parity
~88% of a cross-domain analysis tool. The classification model and 5 view modes are a genuine analytical surface, but it lacks a resonance graph, pair drill-down to the underlying invariants, and a path from signal to actionable insight.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
