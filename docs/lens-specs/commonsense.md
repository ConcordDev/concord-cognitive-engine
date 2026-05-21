# commonsense — Feature Gap vs ConceptNet / Cyc

Category leader (2026): no direct consumer rival — closest analog is a knowledge-graph / commonsense-reasoning explorer (ConceptNet, Cyc).
Backend: `server/domains/commonsense.js` — macros `plausibilityCheck`, `analogyMapping`, `defaultReasoning`, `conceptnet-edges`, `conceptnet-relatedness`.

## Has (verified in code)
- Fact store: subject-relation-object triples with confidence + source
- Plausibility check, analogy mapping, default reasoning compute
- ConceptNet integration: relation edges + concept relatedness (live free API)
- ConceptExplorer panel; fact search; copy/tag facts

## Missing — buildable feature backlog
- [ ] `[M]` Interactive knowledge-graph visualization of facts + relations
- [ ] `[S]` Inference chaining UI — derive new facts from existing ones
- [ ] `[M]` Contradiction detection across the fact store
- [ ] `[S]` Relation taxonomy (IsA / PartOf / Causes / UsedFor browsing)
- [ ] `[S]` Confidence-weighted query ("things very likely true about X")
- [ ] `[M]` Import facts from text via extraction
- [ ] `[S]` Fact provenance / citation chain

## Parity
~50% of a commonsense-knowledge explorer. Real triple store with ConceptNet edges and reasoning macros, but lacks graph visualization, inference chaining, and contradiction detection — the features that make a knowledge base feel intelligent.
