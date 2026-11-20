# Engine: fenicsx — FEniCSx / DOLFINx PDE workbench · SXE-09

The general PDE workbench (Poisson / heat / elasticity /
plates, Navier–Stokes, Helmholtz, Maxwell, poroelasticity,
phase-change, reaction–diffusion, coupled multiphysics;
topology optimization via pyadjoint as the surface grows).
Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-52; host provisioning (H2) is that
programme's deferred-open remainder.

## Manifest entry

`server/lib/conkay/engines/entries/fenicsx.js` — id
`fenicsx`, version pin **DOLFINx 0.11.0**, licence
**LGPL-3.0-or-later** (re-read from the pinned release at
registration, 2026-11-18), link mode **process** (the
library imports only inside the child kernel process,
never into Node). Resolved via `CONKAY_ENGINE_FENICSX_BIN`
(default `/opt/concord-engines/fenicsx/bin/python`). Ops:
`health`, `poisson`, `elasticity`. Kernel:
`server/lib/conkay/engines/kernels/kernel-fenicsx.py`.

## Install (host provisioning, H2)

conda-forge env at `/opt/concord-engines/fenicsx`:
`fenics-dolfinx=0.11.0` (+ `pyadjoint` when the topology
surface lands). Footprint: ~1,024 MB disk, 1,024 MB
memory, 4 threads.

## Health

Poisson on the unit square against the manufactured
solution u = 1 + x² + 2y² (the DOLFINx tutorial case):
serves `{l2Error, dofs}`; the health bound is
**l2Error < 1e-3** (SOLVER-ENGINES-PLAN.md §2), asserted
in the CI lane. The `elasticity` op runs a 2-D cantilever
(degree-2 elements, uniform tip traction) and serves the
tip deflection beside its Euler–Bernoulli value with the
relative deviation; the lane asserts the band < 12%.

## Absent behaviour

- Env unprovisioned → NOT_COMPUTED
  `engine_unavailable:fenicsx` with the install hint.
- Env provisioned but the dolfinx stack does not import
  → FAIL `engine_failed:fenicsx:fenicsx stack import
  failed: …` (a provisioning defect, named as such).
- Out-of-range mesh requests are refused by the kernel
  naming the bound, before any solve.

## Tests

`server/tests/conkay/engines/fenicsx.test.js` —
registration, absence, schema and unknown-op refusals,
and the kernel's import-failure shape locally; the value
legs run only in the CI lane
(`.github/workflows/conkay-engine-fenicsx.yml`, manual
dispatch per F8), which installs the pinned conda env,
sets `CONKAY_ENGINE_FENICSX_BIN`, and fails if any test
skips.

## First-live corrections (2026-11-19)

The lane's first live dispatch installed DOLFINx
0.11.0 cleanly but the Poisson health returned FAIL
with no reason in the log — the suite's bare
`status === "PASS"` assertion hid the result. The
suite's real-lane legs now carry the full result JSON
in their assertion messages (the same fix in all five
SXE-52 suites), and the lane runs a kernel-direct
smoke step before the suite so a kernel failure names
itself on stderr in the log. The root cause itself is
named by the re-dispatch's surfaced output; the kernel
was verified API-correct against the 0.11 surface by
inspection (functionspace, fem.petsc.LinearProblem,
exterior_facet_indices).
