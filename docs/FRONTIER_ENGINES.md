# Frontier Engines (V1.5)

**Status: shipped, 2026-07-24.** Ten computational engines, each aimed at a
problem that is genuinely hard in the CS/engineering-theory sense — not hard
in the "we haven't gotten to it yet" sense. Each one has a real tractable
core AND a real wall past which the problem is either provably intractable,
provably outside what this runtime can guarantee, or provably outside what
the implemented scheme can do at all.

**Read the framing precisely, because it is the entire point of this
document.** The deliverable is NOT "ten solved hard problems" — claiming
that would violate this project's first hard invariant (honest by
construction, see `CLAUDE.md`). The deliverable is ten real engines that sit
on the tractable side of ten named walls, each one validated against a
specific published, closed-form, or structurally-checkable reference (never
against its own output), and each one shipping the wall as an explicit,
machine-readable fact — a `HONEST_BOUNDARY` string, a `claimTier`, a
comment block the code itself asserts — not a TODO comment implying it'll be
fixed later. Several of the walls are not implementation gaps at all; they
are theorems (PPAD-completeness, Gottesman-Knill vs. 2^n statevector
scaling) or physical facts about the runtime (Node.js has no real-time
guarantees). No amount of future engineering closes those. That is the
correct, permanent state for this category of problem, and the code says so
in its own words.

Every engine below is read from its actual source and its actual test file
before being described here. Where a number is quoted, it is either a
constant read directly out of the source or an assertion read directly out
of the test file — nothing is remembered or estimated.

---

## 1. Long-horizon materials degradation

**The hard problem.** Predicting how a real structure's stiffness and
strength decay over a decades-long service life under fatigue, thermal
aging, and moisture ingress — the actual engineering question behind
"will this bridge/aircraft-part/composite-panel still hold in 30 years,"
not a single-load-case snapshot.

**What's real.** `server/lib/simulation/degradation-kinetics.js` implements
three real, textbook, phenomenological kinetics laws and integrates them
forward in time with the codebase's existing RK4 ODE solver
(`server/lib/compute/numerical.js#rk4ODE`):
- **Arrhenius** rate law (`arrheniusRate`, `arrheniusRatio`) — including the
  temperature-ratio form used when only an activation energy (no absolute
  rate constant) is cited.
- **Paris-Erdogan fatigue crack growth** (`parisGrowthRate`,
  `stressIntensityRange`, plus a closed-form solution `parisLifeClosedForm`
  derived by hand and cross-checked against the RK4 integration of the same
  ODE — see Validated-against below).
- **Fickian diffusion** (`fickianUptakeFraction`, a 100-term truncated Crank
  series solution for moisture/chloride ingress into a slab, plus its exact
  analytically-derived term-by-term time derivative
  `fickianRatePerSecond`, used to drive the ODE march).

`server/lib/asset-gen/durability-gate.js` composes the kinetics with the
codebase's real, unchanged direct-stiffness FEA solver
(`server/lib/simulation/fea-solver.js#runFEA`): it marches a degradation
state forward to a set of sample years, maps that state to knocked-down
material properties via a cited continuum-damage-mechanics law
(`defaultKnockdownLaw` — Lemaitre & Chaboche, "Mechanics of Solid
Materials", 1990), rebuilds the structural model with those properties, and
re-solves. `server/lib/asset-gen/degradation-constants.js` ships real
literature-cited constants for exactly four materials (steel A36,
aluminum 7075-T6, 30 MPa concrete, CFRP), each cited only for the
mechanism(s) a real literature search actually turned up a citable value
for — every other sub-table on every entry is explicitly `null`, not
omitted, so a missing citation is visible rather than silently absent.

**Validated against.** `server/tests/degradation-kinetics.test.js`
cross-checks the RK4 time-march against the independently-derived
closed-form Paris-law fatigue life (`parisLifeClosedForm`) to <1e-9 relative
error — two different derivations of the same physics agreeing is the
oracle, not a single code path checking itself. The same file hand-verifies
`ΔK = Δσ·Y·√(π·a)` and `arrheniusRatio` against directly hand-evaluated
textbook expressions, and pins that the engine uses the real
`DEGRADATION_CONSTANTS` steel-a36 Paris constants end-to-end, not a
synthetic C/m pair.

**The wall.** From the module's own `HONEST_BOUNDARY` export: "Empirical-
kinetics engineering practice, not first-principles materials physics.
Atomistic/molecular-dynamics simulation is out of scope: no bond-scale
chemistry, no polymer chain-scission mechanism, no microstructural
evolution." Arrhenius/Paris/Fickian are phenomenological fits to
short-term accelerated tests, extrapolated — "no 50-year field data is used
or claimed." The kinetic-extent → stiffness/strength knock-down law is
explicitly named as the least-standardized step and is caller-overridable
for exactly that reason. A second, load-bearing wall lives in
`durability-gate.js`'s own header: it documents and guards against a real,
verified silent-zero-stiffness bug in the shared `fea-solver.js` (a
near-vertical member's true transverse stiffness can pivot to zero and
report a fabricated `dx:0` as "converged") via a hard
`assertSupportedOrientation` precondition checked before every solve — this
is a genuine numerical-methods trap the engine refuses to walk into rather
than silently mis-answering.

**Honest failure states.** `missing_degradation_constants` (a requested
mechanism has no cited constants for this material — notably `thermal` is
unavailable for *every* material shipped, because no safely-citable
absolute Arrhenius pre-exponential factor was found in the literature
search), `crack_exceeds_section` (fatigue crack reached the member
thickness — the beam idealization stops meaning anything past this point),
`unsupported_member_orientation`, `unknown_material`, `bad_model_input`,
`missing_supports`, `fea_solve_failed`.

**Surface.** `materials.degradationConstants`, `materials.durabilityCheck`
(`server/domains/materials.js`).

---

## 2. Non-Newtonian fluid-structure interaction

**The hard problem.** A structural wall that deflects under fluid pressure,
where the deflection changes the channel geometry the fluid sees, which
changes the pressure it exerts back — a genuine two-way coupled problem,
for a fluid whose viscosity is not a constant (shear-thinning/thickening
power-law and Carreau models), not the one-way constant-Cd aerodynamic load
the codebase's existing `aero-gate.js` already handles.

**What's real.** `server/lib/simulation/non-newtonian-flow.js` implements
real closed-form and numerical non-Newtonian pipe-flow relations: the
Rabinowitsch-Mooney closed form for power-law flow (`powerLawPipeFlow`,
exactly reducing to Hagen-Poiseuille at n=1), and — because the Carreau
model has no closed form — a genuine numerical solve
(`carreauPipeFlow`): per-radius shear-rate inversion via bisection
(`invertShearRate`, provably non-divergent because the constitutive
relation is monotone) composed with `adaptiveQuadrature` for the flow-rate
integral. `server/lib/asset-gen/fsi-gate.js` builds the actual two-way
coupling as a Picard fixed-point iteration: solve flow on the current gap
profile → get a per-member local pressure gradient → lump it into nodal
loads → one unchanged `runFEA` call → update the gap from the real wall
deflection → repeat until the gap profile converges or a real failure is
reached. The feedback is genuine, not decorative: a narrowing gap raises
local viscous resistance (the Rabinowitsch-Mooney relation is steeply
nonlinear in the local radius), which raises the local load, which can
narrow the gap further — the collapsible-channel/Starling-resistor
instability family, a real studied phenomenon.

**Validated against.** `server/tests/non-newtonian-flow.test.js` checks the
power-law closed form against the codebase's existing Newtonian
Hagen-Poiseuille oracle (`physics-compute.js#pipeFlow`) at n=1 to <1e-12
relative error, and the full Carreau bisection+quadrature numerical path
against the same oracle (at λ=0 and at n=1, two independent ways to
collapse Carreau to Newtonian) to <1e-10 relative error — exercising every
piece of the numerical machinery at once so a wrong sign or integrand can't
hide behind a shortcut. `server/tests/fsi-gate.test.js` checks the coupled
solver's *rigid-wall limit* (E→1e15 Pa) reproduces the uncoupled
`powerLawPipeFlow` closed form to <1e-9 relative error, that ΔP=0 gives an
*exact* (not approximate) match between combined and mechanical-only
utilization, and a real mesh-convergence result: deflection error shrinks
~4× per mesh doubling (O(h²)), consistent with the documented force-only
lumping convergence table in the module header (33.3%→8.3%→2.1%→0.52%→
0.13%→0.033% for N=1→32).

**The wall.** From the module's own `HONEST_BOUNDARY`: "Full 3D Navier-
Stokes, DNS, LES and any turbulence model are out of scope — the solver
refuses above Re ≈ 2300 rather than extrapolating." Steady-state only — no
inertia, no added-mass, no flutter, no transient FSI. Picard coupling "is
not unconditionally stable; above a critical wall compliance it diverges,"
and the module reports `coupling_diverged` rather than returning the last
iterate as an answer — `fsi-gate.test.js` proves this is a real, reachable
outcome (an over-compliant channel never reports `ok:true`), not a
theoretical caveat. `fsi-gate.js` also names a genuine directional
limitation as a `CONFIGURATION_CAVEAT`: it models the *collapsing*
configuration only (fluid load pushes the wall inward); an internally-
pressurized vessel has the opposite, stabilizing sign, and running such a
case through this module would report divergence where the real structure
is stable — a directionally wrong verdict the module refuses to produce by
scope, not by luck.

**Honest failure states.** `bad_model_input`, `missing_supports`,
`invalid_delta_p`, `invalid_density` (there is deliberately no default
fluid density — an invented one would violate honest-by-construction),
`invalid_fluid_params`, `unsupported_fluid_model`,
`unsupported_member_orientation`, `non_laminar_regime_unsupported`,
`gap_collapsed`, `coupling_diverged`, `did_not_converge`.

**Surface.** `engineering.fsiCheck` (`server/domains/engineering.js`).

---

## 3. Deterministic safety-envelope compiler

**The hard problem.** Computing, for a dynamical system with actuator
limits and state constraints, which regions of state space are provably
(or at least evidence-backed) safe over a time horizon — the reachability-
analysis problem that underlies formal controller verification.

**What's real.** `server/lib/simulation/safety-envelope.js` performs
gridded forward reachability (SCOTS-style abstraction): for every grid
cell center, forward-integrate under every candidate constant input
(`rk4ODE`), and label the cell SAFE only if the trajectory's *inflated
tube* — radius `r(t) = r0·e^(L·t)` via a real Grönwall growth bound, `r0`
half the cell diagonal, `L` a Lipschitz bound on the vector field's
Jacobian — stays inside every declared constraint for the whole horizon.
The inflation is what makes the label mean something about the continuum
between grid points, not just the sampled center. The Lipschitz bound
itself is two-tiered and honestly labeled: `exact_linear` (the Jacobian of
a linear plant equals `A` everywhere, computed via power iteration — a real
bound, not an estimate), `declared` (caller-supplied), or
`sampled_jacobian_estimate` (a nonlinear plant, no closed form — a sup over
sampled Jacobian evaluations). Plant models are DATA (`{kind:'linear',...}`
or `{kind:'symbolic',...}`, parsed via the existing `symbolic-math.js`
parser, verified to contain no `eval`/`new Function`), never code.
`envelope-artifact.js` turns a computed envelope into a static lookup-table
data artifact (JSON/CSV/C-header) for a real RT toolchain to compile — it
never emits executable control logic in any format.

**Validated against.** `server/tests/safety-envelope.test.js` checks the
computed envelope against the *analytic braking-barrier inequality* for a
double-integrator (a closed-form, hand-derivable safety condition) on
three axes: (1) zero false-safe — every cell labeled SAFE genuinely
satisfies the analytic inequality; (2) non-vacuity — coverage at a fine
grid is ≥0.8× the analytic safe fraction; (3) monotone refinement —
coverage is non-decreasing and converges toward the analytic fraction as
the grid refines. A separate assertion checks the RK4 integrator itself
against the exact solution of `ẋ = a·x` (`x0·e^(at)`) to <1e-9,
independent of the reachability logic being tested. A fifth test proves
`adversarialInput:false` yields a strictly larger safe set than
`adversarialInput:true` — the ∃-input vs. ∀-input quantifier distinction is
real, not cosmetic.

**The wall.** Stated in the module's own header, verbatim in both
`safety-envelope.js` and `envelope-artifact.js`: "Concord does not and
cannot execute real-time control. This engine performs OFFLINE design and
verification only. Node.js has no real-time guarantees — garbage-collection
pauses alone are milliseconds, orders of magnitude above a sub-millisecond
actuator deadline — so nothing here is a controller and nothing here should
be placed in a control loop." This is a fact about the Node.js runtime, not
an implementation gap — no amount of engineering inside this module closes
it; the intended consumer is real RT hardware (PLC/FPGA/microcontroller)
whose own certification process establishes its timing guarantees. The
soundness claim is conditioned honestly too: "conservative if and only if
the supplied Lipschitz constant is a true upper bound over the state box."
`envelope-artifact.js` enforces this in the artifact itself — a
`sampled_jacobian_estimate` basis produces `claimTier: 'empirical_sampled'`
with `empiricalBoundsEvidence`, and the word "proof" is mandated to never
appear anywhere in that artifact; only a `declared`/`exact_linear` basis
earns `claimTier: 'certified_modulo_declared_bound'` with a `proofOfBounds`
block.

**Honest failure states.** `unsupported_plant_kind`, `unbound_variable`
(symbolic dynamics reference an undeclared symbol), `invalid_spec`,
`state_space_too_large` (refuses above `MAX_GRID_CELLS = 250000` rather
than hang a request — the module documents a measured ~600ms for a
100×100×200-step 2-state grid on the box it was built on),
`lipschitz_bound_unavailable`.

**Surface.** `robotics.safetyEnvelopeCompile`, `safetyEnvelopeGet`,
`safetyEnvelopeEmit`, `safetyEnvelopeList` (`server/domains/robotics.js`).

---

## 4. Surface-code quantum error correction + Union-Find decoder

**The hard problem.** Simulating quantum error correction at the qubit
counts (hundreds to thousands) real fault-tolerant hardware needs, and
decoding syndromes fast enough to matter — a scale a general statevector
simulator cannot reach because its memory is `O(2^numQubits)`.

**What's real.** `server/lib/simulation/qec-surface-code.js` builds a
distance-`d` toric-code lattice (periodic boundary — the literal "toric
code," `2d²` qubits on edges, `d²` stabilizer nodes) and samples i.i.d.
bit-flip or depolarizing errors with an injectable, deterministic RNG.
Success/failure is determined rigorously via **homology class**
(`homologyClass`, `isHomologicallyTrivial`) — two independent Z2 invariants
detecting whether a correction's residual difference from the true error
wraps the torus (a genuine logical operator, failure) or is contractible
(a trivial loop, success) — not merely "the syndrome closed," which many
wrong corrections also achieve. `server/lib/simulation/qec-decoder.js`
implements the real Delfosse-Nickerson Union-Find decoder (arXiv:1709.06218):
a two-phase cluster-growth-plus-peeling algorithm running in almost-linear
time (`O(n·α(n))`, using the codebase's new general-purpose
`server/lib/compute/graph-algorithms.js#UnionFind` — path compression +
union by rank). Every decode independently re-verifies that its correction
actually closes the syndrome by recomputing `syndromeOf(correction)` and
diffing it against the target, rather than trusting the growth/peel
derivation — "compute, don't guess" applied to the decoder's own claim.

**Validated against.** `server/tests/qec-decoder.test.js`'s headline test
sweeps physical error rate across code distances 3/5/7 and checks the
qualitative threshold signature against the published Union-Find-decoder
threshold for the 2D toric code (Delfosse & Nickerson, arXiv:1709.06218,
~9.9%): below the crossing, increasing distance suppresses the logical
error rate; above it, increasing distance makes things worse; both
crossings (d3/d5 and d5/d7) are asserted to land in `(0.05, 0.15)` — a wide
sanity band, not a tight fit. **The module reports a measured discrepancy
rather than rounding it away**: `qec-decoder.js`'s own header records that
two independent runs (different seeds, p-grids, trial counts) measured
crossings of ~0.0952/0.0953 and ~0.0916/0.0914 — roughly 0.4–0.8 percentage
points below the published 0.099, reproducibly, "not as scatter around the
published figure." The file names its own best-guess contributors in
order of expected size: finite-size drift at small `d` (a published
threshold is an asymptotic value), unweighted (vs. optimized weighted)
cluster growth, and Monte Carlo noise (judged too small alone to explain a
consistent one-directional offset). The instruction to readers is explicit:
"Treat the number as 'reproduces the threshold phenomenon at approximately
the right place,' NOT as an exact reproduction of 0.099." Separately, an
exhaustive (not sampled) test at d=3 checks that every one of the 18
possible weight-1 errors is corrected with certainty.

**The wall.** From `qec-decoder.js`'s own honest-boundary section: exact
Gottesman-Knill stabilizer simulation is polynomial-time and scales to the
thousands of qubits QEC needs — but this is a research/verification
simulator, not a control system. "Real fault-tolerant hardware requires
decoding within the qubit coherence window (microseconds), which is an
FPGA/ASIC problem — this engine makes no latency claim whatsoever." The
error model is i.i.d. per-qubit with "perfect syndrome measurement" (the
standard first benchmark regime); correlated noise, leakage, crosstalk,
and realistic measurement-error models are not simulated. Depolarizing
noise is deliberately DECOUPLED (independent X/Z components), not exploiting
the correlation a joint depolarizing-aware decoder could use.

**Complementary, not competing, with the existing statevector simulator.**
`server/lib/compute/quantum-compute.js` is verified to hard-cap at
`qubits > 20` (`throw new Error('qubits must be 1–20')` in
`simulateCircuit`) because its statevector array is length `2^numQubits` —
exact complex amplitudes, arbitrary unitaries, but unusable past ~20
qubits. `qec-surface-code.js`'s own header states the relationship
precisely and this doc verifies it against both files: stabilizer
simulation under Gottesman-Knill is polynomial-time and reaches the
qubit counts surface codes need (a distance-7 toric code alone has 98
qubits) *because* it tracks stabilizer syndromes combinatorially instead
of amplitudes — it never touches a statevector, and it cannot produce one.
Neither module subsumes the other: `quantum-compute.js` can produce exact
amplitudes this module cannot; this module can simulate lattices
`quantum-compute.js` could never fit in memory.

**Honest failure states.** This is a pure-compute simulator with no
external-input validation surface beyond standard argument checks in the
`quantum` domain wrapper; its epistemic honesty is carried in the recorded
measured-vs-published discrepancy above rather than in `{ok:false}`
refusals.

**Surface.** `quantum.qecLatticeInfo`, `qecSimulateThreshold`,
`qecDecodeSingle`, `qecRunTrial` (`server/domains/quantum.js`).

---

## 5. Bounded model checker for Concord's own money invariants

**The hard problem.** Proving — or at least searching exhaustively within a
bound for a counterexample to — a safety property of a stateful system
(here: Concord's own ledger, royalty cascade, and treasury math), the way a
real model checker (TLA+, Alloy, SPIN) does, rather than trusting hand
review or a fixed set of example-based unit tests.

**What's real.** `server/lib/verification/model-checker.js` is a bounded
explicit-state model checker: breadth-first search from an initial state,
evaluating every invariant at every reachable state, bounded by `maxDepth`
(path length) and `maxStates` (distinct states visited). On the first
violation it returns immediately with the exact action sequence (`trace`)
and the state that broke it — a real counterexample, the actual value of
the tool, not a bare pass/fail boolean. It independently detects a common
class of modeling bug: an `apply(state)` action is called twice on
independent clones of the same state, and a mismatch is reported as
`nondeterministic_action` rather than silently corrupting the search (a
model's actions must be pure functions of state — no `Math.random()`, no
wall-clock reads, no closure-captured mutable counters; the test suite
proves both of those specific violations are actually caught). A separate
`replayTrace` function independently re-derives a reported counterexample
from scratch, outside the BFS bookkeeping — proof that a counterexample
trace actually reproduces the violation rather than being a checker
artifact. Invariants are expressed as propositional formulas over boolean
facts via the codebase's existing `formal-logic.js` evaluator
(`formulaInvariant`), reused deliberately — that module's own
`isSatisfiable`/`truthTable` enumerate all `2^n` assignments and are
unusable past ~20 booleans, so concrete-state BFS is the exploration
engine and formal logic is only the predicate language.

`server/lib/verification/invariant-specs.js` builds three specific,
hand-specified abstractions of Concord's real money logic for the checker
to run against: a ledger-conservation model mirroring the real two-row
TRANSFER/MARKETPLACE_PURCHASE debit/credit pattern from
`server/economy/transfer.js`, a treasury-invariant model sharing that same
abstraction, and a royalty-cascade model mirroring
`server/economy/royalty-cascade.js`'s generation-decay-with-cap algorithm
(`MAX_CASCADE_DEPTH=50`, `ROYALTY_FLOOR=0.0005`, `MAX_ROYALTY_RATE=0.30`).

**Validated against.** This is the one engine in the set validated against
a real, previously-shipped bug in this codebase rather than an external
published result — the strongest kind of oracle available: does the
checker actually catch the exact defect `CREDIT_ROW_PREDICATE` (see
`CLAUDE.md`'s "Ledger credits are summed via `CREDIT_ROW_PREDICATE`"
invariant) was built to fix. `server/tests/invariant-specs.test.js`
constructs the model with `buggyCreditPredicateDoubleCounts` (exported
specifically so tests can prove the checker catches it — "every row with a
`to_user_id` is a credit," the historical bug, no exclusion of the
redundant debit-half row) and asserts the checker finds a real
counterexample trace that mints currency from nothing, that the trace
*replays* to reproduce the exact violation (proving it isn't fabricated),
and that the minimal counterexample is exactly two actions — `[mint,
transfer]`. The same file proves the correct `correctCreditPredicate`
passes clean and, at generous bounds, is *exhaustively* explored clean
(the strongest claim this checker can honestly make — see the wall below).
It also proves an uncapped royalty cascade can be made to exceed 30% via
breadth (multiple direct citations at low generation, the realistic way the
cap actually binds) with a replayable counterexample, and that the real,
capped behavior never exceeds it.

**The wall.** From the module's own header, read before trusting any
result: "This is bounded explicit-state model checking, NOT theorem
proving... 'No violation found' is NOT a proof of correctness — an
unbounded or larger state space may still contain one." Every returned
result says so explicitly via its `bound` and `status` fields — even the
best-case `no_violation_found` result carries the note: "exhaustive for
the abstract model only — it is NOT a proof of correctness for the real
system, which the model may not faithfully capture." There is no SMT
solver, no symbolic execution, no inductive invariant synthesis. And
`invariant-specs.js`'s own header names the second, orthogonal wall: these
are *hand-specified abstractions* of the real code — "a bug in the
abstraction can hide a bug in the real system, and a passing result only
says the ABSTRACTION held up under the explored bound." A clean run proves
the model is consistent with the invariant, not that `server/economy/*.js`
is.

**Honest failure states.** `state_space_exhausted` and
`depth_bound_reached` (both explicitly non-proof, carrying a `note` field
saying so), `nondeterministic_action`, `error`/`action_threw`.

**Surface.** `audit.modelCheckLedgerConservation`,
`modelCheckRoyaltyCascade`, `modelCheckTreasuryInvariant`
(`server/domains/audit.js`).

---

## 6. Byzantine hash-DAG convergence

**The hard problem.** Getting independent, possibly-malicious replicas in a
peer-to-peer mesh to converge on the same state given the same delivered
updates, in any order, with duplicates, without a global clock — and to be
able to *prove* misbehavior (tampering, double-signing) rather than merely
guess at it via wall-clock heuristics.

**What's real.** `server/lib/consensus/vector-clock.js` implements the four
minimal, pure vector-clock operations (`create`/`increment`/`merge`/
`compare`) that distinguish genuinely concurrent events (neither
happened-before the other) from causally ordered ones — the mechanism this
codebase's existing `merge.js` naive 1-second last-write-wins window gets
wrong. `server/lib/consensus/hash-dag.js`'s `HashDag` class builds a
content-addressed DAG of Ed25519-signed updates: each node's own hash
commits to its author, its payload, and its ENTIRE declared causal history
(parent hashes) — mutating a payload anywhere in the chain breaks every
hash downstream of it. Remote integration (`mergeRemote`) verifies hash
integrity and signature before accepting anything, and a node whose
parents aren't fully known yet is honestly `deferred`, never
force-integrated with a broken chain. Trust-on-first-use key binding means
an already-known author's key always wins over whatever key a later
message claims to carry — closing the "attacker embeds their own key to
impersonate a known author" hole. `detectEquivocation` finds an author who
has validly signed two *different* updates at the same causal position —
undeniable evidence, since both messages are genuinely signed by that
author, not forged. Deterministic convergence (`linearize`) is Kahn's
algorithm over the DAG with ties among concurrently-eligible nodes broken
by ascending hash — a property of content, never of arrival order.

**Validated against.** `server/tests/hash-dag.test.js` runs a real N-replica
convergence check: the same set of updates, delivered to independent
replicas in different random permutations (seeded, reproducible shuffles),
with duplicates, converge to byte-identical `materializeState()` /
`serializeState()` — checked directly, not inferred. A companion test
proves convergence is independent of wall-clock skew between replicas
(even inverted local clocks don't change the converged state — because
nothing in the engine reads wall-clock time at all). Tamper detection is
checked directly: mutating a payload, or mutating declared parents (an
attempted history rewrite), after insertion breaks the hash and the node
is rejected. The equivocation test constructs a genuinely Byzantine author
signing two different updates at the same causal position and checks both
conflicting messages are returned as evidence; a companion test proves an
honest author's normal sequential updates never false-positive. Signature
rejection is checked for a wrong key against an already-known author,
garbage signature bytes on first contact, and an unknown author with no
embedded key.

**The wall.** From the module's own header: "this is Byzantine-resilient
CONVERGENCE, not Byzantine AGREEMENT. There is no quorum, no leader
election, no 3f+1 safety threshold — nothing here can force a decision in
the presence of an active adversary." What it genuinely provides:
deterministic eventual convergence given the same delivered update set (in
any order, with duplicates), and cryptographic *detection* — not
prevention — of tampering and equivocation. "A Byzantine node cannot
rewrite history or unsay a signed message without leaving proof, but
nothing here stops it from equivocating in the first place, and a
permanently partitioned replica simply stays divergent until it receives
the missing updates — this engine does not provide delivery, only makes
misbehavior undeniable once updates do arrive."

**Honest failure states.** `invalid_record`, `malformed_record`,
`hash_mismatch` (tamper detected), `unknown_author`, `signature_invalid`,
and the non-error-but-honest `{ok:false, deferred:true, missingParents:[...]}`
for a node whose causal chain isn't fully known yet.

**Surface.** `mesh.consensusAppend`, `consensusMergeRemote`,
`consensusEquivocation`, `consensusState`, `consensusStatus`
(`server/domains/mesh.js`).

---

## 7. Game-theoretic economic equilibrium

**The hard problem.** Determining whether observed trading behavior in a
real market is consistent with a stable strategic equilibrium (cartel-like
coordination vs. competitive behavior) — requiring both exact
mixed-strategy Nash equilibrium computation (which has no known
polynomial algorithm) and a scalable dynamical alternative for when exact
computation is intractable.

**What's real.** `server/lib/game-theory/mixed-nash.js` computes exact
mixed-strategy Nash equilibria of a bimatrix game via support enumeration
(Nisan, Roughgarden, Tardos & Vazirani, "Algorithmic Game Theory", §3.4):
for every candidate pair of equal-size supports, it solves the
indifference conditions as a linear system (reusing the codebase's
existing `solveLinearSystem` rather than adding a fifth Gaussian
elimination) and keeps solutions that are valid probability distributions
AND mutual best responses (checked explicitly — no action outside the
support may beat the indifference value). A candidate count beyond
`maxCandidates` is refused outright (`support_enumeration_exhausted`)
rather than left to enumerate forever. `server/lib/game-theory/
replicator.js` implements replicator dynamics (`ẋᵢ = xᵢ·(fᵢ(x) − f̄(x))`) as
the scalable substitute for large/continuous populations where support
enumeration is exponential — integrated one RK4 step at a time
specifically so the simplex constraint (non-negative, summing to 1) is
re-enforced every step rather than drifting under accumulated
floating-point error. `server/lib/game-theory/market-equilibrium.js`
applies both, plus the codebase's existing Tarjan-SCC-based
`collusion-detector.js`, to Concord's own real `economy_ledger`: it
detects the structural signature of cyclic/reciprocal trading rings
(exact, not heuristic), builds a 2-strategy ("ring" vs. "diversify")
population game parameterized from the *observed* average net-per-trade
by ring membership, and asks both solvers whether ring behavior is a Nash
equilibrium or evolutionarily favored. It is read-only by construction —
prepared `SELECT` statements only, verified never to `INSERT`/`UPDATE`/
`DELETE`.

**Validated against.** `server/tests/mixed-nash.test.js` checks the solver
against three canonical textbook games: **matching pennies** (the classic
game with NO pure equilibrium at all — normal-form pure-equilibrium code
alone cannot find it) resolves to exactly one equilibrium, fully mixed at
(1/2, 1/2) for both players; the **prisoner's dilemma** resolves to exactly
the pure mutual-defection equilibrium with no spurious extras; **battle of
the sexes** finds both of its pure equilibria plus the correct mixed one.
`server/tests/market-equilibrium.test.js` proves a deliberately planted
reciprocal ring (A→B→C→A) with high internal net value is flagged, a clean
market with no cycles or reciprocal trading is NOT flagged, and — the
read-only claim checked directly, not assumed — ledger row count and every
stored value are byte-identical before and after analysis.

**The wall.** From `mixed-nash.js`'s own header: "Exact Nash-equilibrium
computation is PPAD-complete (Daskalakis, Goldberg & Papadimitriou, 'The
Complexity of Computing a Nash Equilibrium', 2009) — no polynomial
algorithm is known, and none is claimed here." This is a genuine
complexity-theoretic wall, not an engineering gap — support enumeration is
exact but exponential in strategy count, which is exactly why
`replicator.js` exists as the scalable alternative and is itself honestly
bounded: `replicator.js`'s own header names rock-paper-scissors as a game
with NO stable interior rest point (trajectories orbit forever), and the
module reports `converged:false` rather than claiming a fixed point that
was never reached. `market-equilibrium.js`'s own honest-boundary section
draws the sharpest line of the whole set: the observed average
net-per-trade fed into the population game "is a proxy for 'value captured
per interaction,' not a rigorous utility model of any individual agent's
real incentives — it is a descriptive statistic fed into a real solver,
not a claim about ground truth." The output classification is "consistent
with a cartel" or "consistent with a competitive equilibrium" — never
proof of intent or manipulation; a human reviews any flagged ring, and the
module has no mutation path at all.

**Honest failure states.** `support_enumeration_exhausted` (candidate
count too large), `invalid_matrix`; `market-equilibrium.js`'s
`no_db`, `ledger_read_failed`, and `insufficient_data` (an empty ledger —
never guessed at).

**Surface.** `markets.equilibriumAnalysis`, `markets.replicatorDynamics`
(`server/domains/markets.js`).

---

## 8. Constant-time / secret-dependent-flow analyzer

**Not a macro — a static-analysis detector.** Unlike the other nine
engines, this one has no `/api/lens/run` surface. It runs as part of the
detector suite (`server/scripts/run-detectors.js`) and is source-level
static analysis over the codebase, not a runtime computation a lens calls.

**The hard problem.** Finding source-level patterns that are the
*precondition* for a timing side-channel — secret-dependent branches,
memory indices, and loop bounds — the class of bug that leaked private
keys and passwords in real cryptographic libraries via measurable
execution-time differences.

**What's real.** `server/lib/detectors/constant-time-detector.js` is the
first genuinely AST-based detector in the suite (every other detector is
regex/string matching over raw text). It parses candidate backend source
files into a real TypeScript/JavaScript AST via the `typescript` compiler
API (syntax only, no type-checking) and runs a small, intentionally-simple
taint analysis: taint sources are an explicit `// @secret` annotation
(authoritative, always on) plus an opt-in, off-by-default naming heuristic
(`SECRET_NAME_RE`); taint propagates through declarations, destructuring,
plain assignment, and function-return producers via a bounded (3-round)
fixed-point pass. It flags four concrete patterns: secret-dependent
branches (`if`/ternary/`switch`/short-circuit-as-control-flow),
secret-dependent memory indices (`arr[secret]`), secret-dependent loop
bounds (with a deliberate `.length`-access carve-out so the recommended
fixed-length constant-time-compare idiom isn't punished), and
secret-dependent early exits from a loop (the textbook non-constant-time
comparison bug — return/break on first mismatch). Compound assignment
(`|=`, `^=`, etc.) is *deliberately* not taint-propagating, specifically
because the safe idiom `diff |= a[i] ^ b[i]` must not be flagged as if it
were a leaky branch.

**Validated against.** This engine is validated by construction and by its
own honestly-reported false-positive-suppression history rather than
against an external ground truth (there is no canonical "constant-time
Concord" corpus to check against). Its header records the concrete,
measured reason the naming-heuristic taint source defaults to OFF: run
against this repo with it on, the detector hit its 500-finding cap after
scanning just 27 of 4,382 files, with 373 of those from a single
chart-of-accounts seeding file (`seedDefaultCoA`) that matched `/seed/` —
nothing to do with cryptography. `server/tests/constant-time-detector.test.js`
exercises the taint-propagation fixed point, the four finding categories,
and the `.length`-carve-out / compound-assignment-non-propagation idioms
directly against constructed source snippets.

**The wall.** Stated in the module's own header, at length and without
hedging: "This is source-level detection of secret-dependent control flow
and memory access — the *precondition* for a timing side channel, not
proof of one, and not proof of its absence. Microarchitectural effects are
HARDWARE semantics: speculative and transient execution, cache line state,
port contention, and prefetcher behavior are invisible at this level and
are not modeled. Even state-of-the-art tooling operates lower down —
`ct-verif` works on LLVM IR with source annotations and has in practice
been applied to functions well under 100 lines." Taint propagation is
file-scoped, not properly lexically scoped per function and not
inter-procedural across files — a documented, conservative
over-approximation. Because the default taint source is the explicit
annotation only, "DEFAULT RECALL IS LOW. Nothing is tainted until an
author annotates it, so a clean default run mostly means 'nobody has
marked their secrets yet,' not 'this codebase is constant-time.'" The
module's own summary finding literally repeats this line every run: "a
clean file means 'no pattern matched by these rules,' not
'constant-time.'"

**Honest failure states.** Not applicable in the `{ok:false,reason}` sense
— its honesty mechanism is the recall disclosure above and an explicit
`constant_time_parser_unavailable` info-level finding (rather than a
crash) when the `typescript` devDependency can't be loaded.

**Surface.** `server/lib/detectors/constant-time-detector.js`, run via
`server/scripts/run-detectors.js` (registered consumer `code-quality`).

---

## 9. Partially-homomorphic encrypted aggregation

**The hard problem.** Letting multiple parties contribute values that get
combined into a sum or mean without any single party's contribution ever
being individually decrypted — and being precise about the difference
between "the computation never saw your value in the clear" and "the
released answer can't be reverse-engineered to reveal it."

**What's real.** `server/lib/crypto/paillier.js` is a real Paillier
cryptosystem implemented from scratch in pure BigInt (no crypto
dependencies beyond `node:crypto`, used only as the entropy source — a
cryptographically-secure PRNG for key material and per-encryption
randomization, explicitly never `Math.random()`). It implements real
2048-bit-default keypair generation (Miller-Rabin primality testing with
24 cryptographically-random witness rounds, `4^-24` false-positive bound),
`encrypt`/`decrypt`, and the genuine additively-homomorphic operations:
`addEncrypted` (`E(a)·E(b)` decrypts to `a+b`), `addPlaintext`, and
`multiplyPlaintext` (scaling by a known constant). `server/lib/crypto/
encrypted-aggregate.js` builds real multi-party sum/mean aggregation on
top: `aggregateSumEncrypted` combines N ciphertexts via repeated
`addEncrypted`, never touching a secret key; `aggregate` decrypts the
combined result exactly once — proven by construction to be single-decrypt,
not asserted. `releaseWithDifferentialPrivacy` composes the aggregate with
a caller-supplied noise function rather than inventing a second DP
mechanism — the intended caller wires it to the codebase's existing real
Laplace-mechanism `differentialPrivacy` macro in `server/domains/anon.js`,
so every DP-noised value in Concord, including this one, draws against the
same persisted epsilon budget.

**Validated against.** `server/tests/paillier.test.js` checks the core
homomorphic identity directly (`decrypt(addEncrypted(pk, encrypt(a),
encrypt(b))) === a + b`) computed without either operand ever being
decrypted, round-trips across edge values and the documented
negative-number wraparound convention, and proves randomized encryption —
the same plaintext encrypted twice yields two different ciphertexts, both
decrypting to the same value (semantic security, checked, not assumed).
`server/tests/encrypted-aggregate.test.js` checks the aggregate sum/mean
against the plaintext-computed sum/mean exactly, proves
`aggregateSumEncrypted` never decrypts anything (a spied `decryptFn`
records zero calls during aggregation), and separately proves the full
`aggregate()` path decrypts exactly once, on the final combined ciphertext
only.

**The wall.** Paillier is *partially* homomorphic — additive only.
`multiplyCiphertexts` is the sharpest artifact of honest-by-construction
in this whole set: it is a real exported function that always returns a
structured refusal (`{ok:false, error:'fhe_required', reason: "..."}`)
rather than silently computing garbage, because `E(a)·E(b)` in Paillier
decrypts to noise, not `a*b` — computing an actual encrypted product
requires Fully Homomorphic Encryption (CKKS/BFV/BGV/TFHE, relying on
bootstrapping for unbounded multiplicative depth), which this module does
not implement and does not claim to; even where FHE schemes exist, they
remain "orders of magnitude slower than plaintext" computation, which is
why this module scopes itself to the additive case a 2048-bit-modulus
BigInt implementation can genuinely serve. A second, distinct wall is
named explicitly in both files: Paillier is confidentiality-only — it
"says nothing about what the *released* decrypted result might leak about
its inputs (e.g. decrypting the sum of exactly one contribution reveals
that contribution exactly)." That is precisely why
`releaseWithDifferentialPrivacy` exists as a separate, required
composition rather than being folded silently into `aggregate()`.

**Honest failure states.** `fhe_required` (from `multiplyCiphertexts`, the
one deliberately-always-refused operation); constructor-level throws for
invalid key material (`generateKeypair` enforces a real `MIN_KEY_BITS=256`
floor so a careless caller can't silently mint a toy key and call it
secure) and for `releaseWithDifferentialPrivacy` called without a
`noiseFn`.

**Surface.** `crypto.paillierKeygen`, `paillierContribute`,
`paillierAggregate`, `paillierMultiplyCiphertexts`,
`paillierSessionStatus` (`server/domains/crypto.js`).

---

## 10. Spiking neural substrate with plasticity

**The hard problem.** Simulating a biologically-motivated model of
learning — spike-timing-dependent plasticity on a network of
integrate-and-fire neurons with dynamic (growing/pruning) topology — with
real, checkable dynamics rather than a black-box gradient-descent stand-in.

**What's real.** `server/lib/simulation/spiking-network.js` implements
leaky integrate-and-fire (LIF) neurons on a weighted, delayed,
dynamically-rewireable synapse graph, with membrane dynamics
`tau_m·dV/dt = -(V - V_rest) + R·I(t)` integrated via the codebase's
existing `rk4ODE` solver — reused deliberately rather than hand-rolling a
fourth integrator (the codebase already has RK4, Euler, and Verlet).
Because a spike is a genuinely discontinuous event (threshold crossing
resets V instantly and opens a refractory window), the network calls
`rk4ODE` once per simulation step rather than handing it one long smooth
interval, checking for threshold crossing between calls. Synapses are
voltage-jump connections delivered after a real per-synapse delay.
`server/lib/simulation/stdp.js` implements the canonical pairwise
exponential STDP window (Bi & Poo 1998; Song, Miller & Abbott 2000) —
potentiation for pre-before-post spike pairs, depression for
post-before-pre — computed against a network's *real recorded spike
trains*, not synthetic timing data, plus deterministic (seed-driven)
dynamic topology: `pruneSynapses` removes weight-floor synapses,
`growSynapses` forms new ones between neuron pairs whose real spikes
co-occurred within a correlation window ("fire together, wire together"),
gated by a formation probability drawn from the network's own seeded RNG.

**Validated against.** `server/tests/spiking-network.test.js` checks the
sub-threshold membrane trajectory against the closed-form analytic LIF
solution (`V(t) = V_rest + R·I·(1 − e^(−t/τ_m))`) to <1e-9 absolute error
at the endpoint and <1e-8 at multiple intermediate checkpoints along the
trajectory — not just a single-point match. It checks steady-state
periodic firing against a hand-derived analytic inter-spike-interval (ISI)
formula, matching to within 0.02 ms — and the test file itself documents a
real bug this analytic formula had and was fixed for during development
(the earlier version silently dropped `V_reset` and `refractory` from the
derivation, correct only in the degenerate case where both are trivial;
the corrected formula is checked against the simulator across
`V_reset ∈ {-65,-70,-75}` and `refractory ∈ {0,2,5}`, each shifting the
measured ISI by exactly the analytically-predicted amount). It also checks
that no two spikes from one neuron land closer than the configured
refractory period under strong sustained drive, and that membrane
potential is genuinely clamped at `V_reset` throughout the refractory
window rather than merely constrained at the boundaries.

**The wall.** Stated verbatim as `HONEST_BOUNDARY` in
`spiking-network.js` and re-exported by `stdp.js`: "this is a simulation
of neuromorphic DYNAMICS, not neuromorphic HARDWARE. Leaky
integrate-and-fire is a deliberately simple point-neuron abstraction: no
dendritic computation, no ion-channel or Hodgkin-Huxley conductance
dynamics, no neuromodulation, no glial interaction." "Dynamic topology"
means the simulator adds and prunes plain JavaScript synapse objects in
software — "nothing here reconfigures physical routing, and no claim is
made about any particular non-von-Neumann silicon. This runs on the same
conventional CPU as everything else in this codebase." `stdp.js` names its
own model-fidelity wall too: this is the *pairwise* STDP model only —
"Triplet and voltage-dependent STDP effects are NOT modeled," a real,
named simplification relative to more complete plasticity models in the
literature.

**Honest failure states.** Constructor-level throws for physically
invalid parameters (`tau_m` must be `>0`, `refractory` must be `>=0`,
network `dt` must be `>0`), unknown source/target neuron on synapse
creation. `analyticISI` returns `Infinity` (not an error, but an honest
"never fires") when the drive is at or below the firing threshold gap —
checked directly in the tests rather than assumed.

**Surface.** `sim.spikingNetworkSimulate`, `sim.spikingSTDPLearn`
(`server/domains/sim.js`).

---

## Internal vs. external usability

Not every engine here serves the same purpose. Some exist to check
Concord's own systems; some are general-purpose primitives any user or
agent-composed lens could reach for; a few are currently reached from only
one internal caller and would need a second integration point to prove
out externally. Read this table as a status snapshot, not a roadmap
promise:

| Engine | Primarily serves | Note |
|---|---|---|
| 1. Materials degradation | **External-usable** | No internal gameplay/economy caller found (verified: only `server/domains/materials.js` and its own lib files reference it) — it is a real engineering-design capability of the `materials`/engineering surface, not wired into an internal Concord subsystem like gear durability. |
| 2. Non-Newtonian FSI | **External-usable** | Same posture as #1 — an `engineering` domain capability (pipe/duct/channel design), not internally load-bearing. |
| 3. Safety-envelope compiler | **External-usable** | A `robotics` domain design-and-verification tool; its output artifact is explicitly meant for external RT hardware toolchains, never for Concord's own runtime. |
| 4. QEC + Union-Find decoder | **External-usable (research)** | A `quantum` domain research/verification capability; not a dependency of any other Concord subsystem. |
| 5. Bounded model checker | **Internal** | Purpose-built to check Concord's own money invariants (`server/economy/{balances,royalty-cascade,coin-service}.js`) — the abstractions in `invariant-specs.js` exist specifically to mirror this codebase's real ledger shape. |
| 6. Hash-DAG consensus | **Internal** | Powers `server/domains/mesh.js`'s own P2P mesh-networking lens substrate (`consensusAppend`/`consensusMergeRemote`/etc.) — part of Concord's mesh product, not a general external dependency. |
| 7. Market equilibrium | **Internal** | Reads Concord's own `economy_ledger` directly (read-only); its entire purpose is observing Concord's own trading activity, alongside the existing `economy-anomaly-cycle.js` precedent. |
| 8. Constant-time detector | **Internal (methodology is external-usable)** | Runs against Concord's own `server/` tree as part of the detector suite; the AST taint-analysis technique itself is a generalizable side-channel-review methodology usable on any codebase, but the shipped detector is scoped to this repo. |
| 9. Paillier / encrypted aggregate | **External-usable** | A general-purpose PHE primitive; its intended composition point (`server/domains/anon.js`'s differential-privacy macro) is internal, but the underlying `paillier.js`/`encrypted-aggregate.js` pair has no Concord-specific dependency and is usable as a standalone privacy-preserving-aggregation library. |
| 10. Spiking network + STDP | **External-usable** | A `sim` domain research/simulation capability for agent-composed or user-built lenses; no internal Concord subsystem depends on it. |

---

## How to reproduce a validation number

Each engine's validation claim above traces to a specific test file. Run
any one directly. Do **not** add `--test-force-exit`: it was observed
(2026-07-24, during V1.5 conductor verification) to silently truncate a run —
the same combined invocation reported 38 tests on one pass and 34 on the
next, both "0 fail," while the identical command without the flag
deterministically reported 38/38 three times in a row. `npm test` uses the
flag repo-wide, so any green full-suite run may be under-counting. Note the
flag is not gratuitous — `server/tests/preload/no-egress.mjs` documents the
leaked-handle classes it exists to work around — so it has not been removed;
the truncation is tracked as open, unresolved work.

```bash
cd server
node --test tests/degradation-kinetics.test.js
node --test tests/non-newtonian-flow.test.js tests/fsi-gate.test.js
node --test tests/safety-envelope.test.js
node --test --test-timeout=120000 tests/qec-decoder.test.js
node --test tests/model-checker.test.js tests/invariant-specs.test.js
node --test tests/hash-dag.test.js tests/vector-clock.test.js
node --test tests/mixed-nash.test.js tests/replicator.test.js tests/market-equilibrium.test.js
node --test tests/constant-time-detector.test.js
node --test tests/paillier.test.js tests/encrypted-aggregate.test.js
node --test tests/spiking-network.test.js tests/stdp.test.js
```

Do not run the full `npm test` suite to check a single number here — it
takes 20+ minutes; running only the relevant file(s) above is faster and
sufficient.
