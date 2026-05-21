# invariant — Feature Gap vs TLA+ / formal-verification tools

Category leader (2026): no direct consumer rival — this is an internal/utility lens; closest analog is a formal-verification / property-checker tool (TLA+, Alloy, runtime assertion frameworks).
Backend: `server/domains/invariant.js` registerLensAction macros (invariantCheck, consistencyProof, constraintSatisfaction). Uses acorn AST validation to safely evaluate invariant expressions.

## Has (verified in code)
- Invariant checking — evaluate boolean invariant expressions over field data, AST-whitelisted (no code injection) with 1000-char cap
- Consistency proof via Merkle hashes
- Constraint satisfaction solving (AC-3 arc consistency)

## Missing — buildable feature backlog
- [x] `[M]` Continuous invariant monitoring — register an invariant once, watch it across substrate ticks, alert on violation
- [x] `[M]` Counterexample generation when an invariant fails (which records / values broke it)
- [x] `[S]` Invariant library / templates (uniqueness, referential integrity, range bounds)
- [x] `[M]` Temporal invariants — "always", "eventually", "until" over a state history
- [x] `[S]` Violation history timeline with severity and resolution status
- [x] `[M]` Quantified invariants (∀/∃) over collections, not just scalar expressions

## Parity
All six backlog items shipped full-stack. Backend macros in `server/domains/invariant.js`:
`registerMonitor` / `listMonitors` / `checkMonitors` / `setMonitorActive` / `removeMonitor`
(continuous monitoring), `counterexample` (record-level blame attribution), `templates`
(8-entry invariant library), `temporalCheck` + `recordSnapshot` + `clearHistory` (□/◇/U
temporal logic over a state history), `violationHistory` + `resolveViolation` (severity-graded
timeline), `quantifiedCheck` (∀/∃ over collections). All wired to the
`FormalVerificationWorkbench` six-tab UI in the invariant lens page. Now ~90% of a
formal-verification tool's surface — continuous monitoring, counterexamples, and temporal
logic are the features that make property verification useful, and they are all live.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
