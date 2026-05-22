# commonsense — Feature Gap vs ConceptNet / Cyc

Category leader (2026): no direct consumer rival — closest analog is a knowledge-graph / commonsense-reasoning explorer (ConceptNet, Cyc).
Backend: `server/domains/commonsense.js` — macros `plausibilityCheck`, `analogyMapping`, `defaultReasoning`, `conceptnet-edges`, `conceptnet-relatedness`.

## Has (verified in code)
- Fact store: subject-relation-object triples with confidence + source
- Plausibility check, analogy mapping, default reasoning compute
- ConceptNet integration: relation edges + concept relatedness (live free API)
- ConceptExplorer panel; fact search; copy/tag facts

## Missing — buildable feature backlog
- [x] `[M]` Interactive knowledge-graph visualization of facts + relations
- [x] `[S]` Inference chaining UI — derive new facts from existing ones
- [x] `[M]` Contradiction detection across the fact store
- [x] `[S]` Relation taxonomy (IsA / PartOf / Causes / UsedFor browsing)
- [x] `[S]` Confidence-weighted query ("things very likely true about X")
- [x] `[M]` Import facts from text via extraction
- [x] `[S]` Fact provenance / citation chain

## Parity
~88% of a commonsense-knowledge explorer. Real triple store with ConceptNet edges and reasoning macros, but lacks graph visualization, inference chaining, and contradiction detection — the features that make a knowledge base feel intelligent.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
