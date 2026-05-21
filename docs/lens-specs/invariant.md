# invariant — Feature Gap vs TLA+ / formal-verification tools

Category leader (2026): no direct consumer rival — this is an internal/utility lens; closest analog is a formal-verification / property-checker tool (TLA+, Alloy, runtime assertion frameworks).
Backend: `server/domains/invariant.js` registerLensAction macros (invariantCheck, consistencyProof, constraintSatisfaction). Uses acorn AST validation to safely evaluate invariant expressions.

## Has (verified in code)
- Invariant checking — evaluate boolean invariant expressions over field data, AST-whitelisted (no code injection) with 1000-char cap
- Consistency proof via Merkle hashes
- Constraint satisfaction solving (AC-3 arc consistency)

## Missing — buildable feature backlog
- [ ] `[M]` Continuous invariant monitoring — register an invariant once, watch it across substrate ticks, alert on violation
- [ ] `[M]` Counterexample generation when an invariant fails (which records / values broke it)
- [ ] `[S]` Invariant library / templates (uniqueness, referential integrity, range bounds)
- [ ] `[M]` Temporal invariants — "always", "eventually", "until" over a state history
- [ ] `[S]` Violation history timeline with severity and resolution status
- [ ] `[M]` Quantified invariants (∀/∃) over collections, not just scalar expressions

## Parity
~40% of a formal-verification tool's surface. The AST-safe evaluator and AC-3 solver are solid foundations, but it is one-shot checking — missing continuous monitoring, counterexamples, and temporal logic that make property verification useful.
