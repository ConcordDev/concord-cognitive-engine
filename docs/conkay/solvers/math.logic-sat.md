# math.logic-sat — SAT / formal logic (SX-NUM-22)

Propositional satisfiability at the JS tier. Code:
`server/lib/conkay/physics/solvers/logic-sat.js`
(registry solver, L1, screening). Reference: SAT
competition benchmarks — the catalogue's reference case is
the small pigeonhole principle.

## Targets

- **sat** — DPLL with unit propagation over CNF in the
  DIMACS literal convention (nonzero integer literals; an
  optional declared variable count).
- **count** — exact model counting by propagation-pruned
  enumeration; don't-care subtrees counted by powers of two.
- **smt** — not the JS tier: refused by name as the Z3
  engine tier's scope.

## The honesty rules

- **A SAT answer ships only with a model, and the model is
  verified against every clause in code before it is
  served.** An unverified model would be a solver bug; the
  code reports it as a failure, never as SAT.
- **An UNSAT verdict is the exhaustive search itself** and
  ships with its statistics (decisions, propagations) —
  PHP(4,3), 4 pigeons in 3 holes, is the pinned reference
  UNSAT; PHP(3,3) beside it is SAT with its model
  re-verified independently in the test suite.
- **The search budget is declared (2,000,000 decisions) and
  its exhaustion refuses** — a partial search never becomes
  a guessed verdict, and a partial count is never served as
  the count.

## Envelope

Propositional CNF to 100,000 variables / 1,000,000 clauses
at this tier; competition-scale instances and SMT theories
are the Z3 engine tier, named in the refusals.

## Replay

Walker: `conkay_solve` math.logic-sat with the PHP(4,3)
clause set from the solver test, target `sat` → PASS with
satisfiable false and the search statistics; PHP(3,3) →
satisfiable true with modelVerified true. Reachability via
solve.direct rides SC-00 (named foundation); the MCP/chain
paths reach the registry entry as registered.
