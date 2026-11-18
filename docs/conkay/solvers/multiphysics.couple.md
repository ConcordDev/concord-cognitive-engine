# multiphysics.couple — field coupling (SX-XC-09)

Partitioned field coupling at the JS tier under the
CB-0820 engine-only interim ruling (XC-09 is an
engine-flag row). The coupling machinery — Dirichlet–
Neumann interface iteration with fixed relaxation or
Aitken Δ² acceleration — runs over built-in field
problems; full preCICE coupling between OpenFOAM /
CalculiX / FEniCSx / Elmer refuses as
`requires_engine_tier:sxe-11`.
Code: `server/lib/conkay/physics/solvers/multiphysics-couple.js`
(registry solver).

## Targets

- **cht** — conjugate heat transfer between two 1D
  conducting domains (implicit FD, half control volumes
  at the boundaries). Per time step, domain A solves with
  a Neumann flux at the interface, domain B with a
  Dirichlet interface temperature; the pair iterates from
  the step-start state until BOTH the temperature
  residual and the exchanged flux are stationary (the
  flux criterion is scaled to the temperature tolerance
  across A's first cell), then a closing sweep re-solves
  both sides with the final exchanged values so the
  served fields are mutually consistent. Non-converged
  steps are counted and warned. Every run also steps a
  monolithic joined-grid solution and reports the
  partitioned-vs-monolithic deviation — a discretization
  measure at the interface control volume that shrinks
  under refinement (verified in CI).
- **thermo-elastic** — a 1D bar under a nodal temperature
  field (or a linear profile): free expansion by
  trapezoid integration of α(T − Tref), or the fully
  constrained stress σ = −E·α·(mean T − Tref).

Three defects were caught by this build's own suite and
fixed in-build: an iteration draft that re-solved from
the previous iterate's field (silently advancing time
once per iteration), a temperature-only convergence
criterion that declared convergence on a stale flux at
steady state, and a one-step "steady" premise that
ignored the 1/(λ·dt) transient remainder.

## Reference + locator

Coupling pattern: the preCICE tutorials (CHT flow over
a plate; perpendicular flap). CI reference case: slabs
k1 = 200, L1 = 0.05 and k2 = 15, L2 = 0.10 between
100 and 20 — analytic steady flux
q = 80/(0.05/200 + 0.10/15) ≈ 11566 W/m² and interface
temperature ≈ 97.108, both pinned; thermo-elastic
anchors are the textbook integrals of a linear profile
(expansion α·L·50 for a 50 K mean rise; constrained
stress −E·α·50).

## Replay

Walker: `conkay_solve` multiphysics.couple `{domainA:
{length: 0.05, k: 200, rho: 2700, cp: 900, nodes: 10},
domainB: {length: 0.10, k: 15, rho: 8000, cp: 500,
nodes: 20}, tempLeft: 100, tempRight: 20, dt: 1e7,
tEnd: 5e7, tolerance: 1e-10}`, target `cht` → PASS,
interface temperature within 1e-5 of analytic; target
`precice` → NOT_COMPUTED `requires_engine_tier:sxe-11`.
Reachability via solve.direct rides SC-00 (named
foundation); the MCP/chain paths reach the registry entry
as registered.
