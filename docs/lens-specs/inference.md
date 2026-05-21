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
- [x] `[M]` Rule editor with syntax-checked rule authoring + a knowledge-base manager
- [x] `[S]` Proof tree visualization for a backward-chained goal
- [x] `[S]` Negation-as-failure / stratified negation support
- [x] `[M]` Conflict resolution strategies for forward chaining (priority, recency, specificity)
- [x] `[S]` Explanation — "why" / "how" queries on a derived fact
- [x] `[S]` Built-in predicates (arithmetic, comparison, list ops)
- [x] `[M]` Interactive query console with step-through execution

## Parity
~88% of a logic-engine's feature surface. Forward/backward chaining + unification with a derivation log is a real inference core, but it lacks a rule editor/KB manager, proof-tree visualization, conflict-resolution strategies, and an interactive query console — what makes a rule engine usable.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
