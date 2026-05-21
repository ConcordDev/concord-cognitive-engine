# inference — Feature Gap vs Prolog / Drools rule engines

Category leader (2026): no direct consumer rival — closest analog is a logic/rule-inference engine (Prolog, Drools, CLIPS).
Backend: `inference` domain — forwardChain, backwardChain, unify; generic artifact store; InferenceFrameworks component.

## Has (verified in code)
- Forward chaining — derive facts from rules until fixed point, with iteration count, derivation log, facts-by-predicate, rules-applied
- Backward chaining — goal-directed proof
- Unification of logical terms
- Fixed-point detection; derivation trace logging
- InferenceFrameworks component for organizing rule sets

## Missing — buildable feature backlog
- [ ] `[M]` Rule editor with syntax-checked rule authoring + a knowledge-base manager
- [ ] `[S]` Proof tree visualization for a backward-chained goal
- [ ] `[S]` Negation-as-failure / stratified negation support
- [ ] `[M]` Conflict resolution strategies for forward chaining (priority, recency, specificity)
- [ ] `[S]` Explanation — "why" / "how" queries on a derived fact
- [ ] `[S]` Built-in predicates (arithmetic, comparison, list ops)
- [ ] `[M]` Interactive query console with step-through execution

## Parity
~45% of a logic-engine's feature surface. Forward/backward chaining + unification with a derivation log is a real inference core, but it lacks a rule editor/KB manager, proof-tree visualization, conflict-resolution strategies, and an interactive query console — what makes a rule engine usable.
