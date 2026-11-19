# Engine: petsc — PETSc + SLEPc sparse solvers · SXE-03

The sparse linear / eigen / time-stepping workhorse the
PDE solvers stand on (and the solver Orcaflex-class tools
build over). Built in the CI-only scope of the founder F1
ruling (2026-11-18) under SXE-52; host provisioning (H2)
is that programme's deferred-open remainder.

## Manifest entry

`server/lib/conkay/engines/entries/petsc.js` — id
`petsc`, version pin **PETSc 3.24.0** (SLEPc paired
3.24), licence **BSD-2-Clause** (re-read from the pinned
release at registration, 2026-11-18), link mode
**process**. Resolved via `CONKAY_ENGINE_PETSC_BIN`,
default `/opt/concord-engines/fenicsx/bin/python`:
**PETSc installs into the FEniCSx env** (SOLVER-ENGINES-
PLAN.md §2 — petsc4py/slepc4py ride the same conda env),
so the default path deliberately names that env; the
footprint (614 MB) is the marginal increment inside it.
The conda-forge pairing (petsc 3.24.x with dolfinx
0.11) is re-read at lane build time. Ops: `health`,
`ksp-poisson1d`, `eigen`. Kernel:
`server/lib/conkay/engines/kernels/kernel-petsc.py`.

## Install (host provisioning, H2)

Into the fenicsx conda env: `petsc4py=3.24` +
`slepc4py=3.24` from conda-forge (0.6 GB per the plan).
4 threads.

## Health

The plan's health case: a 1-D Poisson KSP solve —
−u″ = π² sin(πx), exact solution sin(πx), N=63, CG +
Jacobi — serving `{maxError, iterations}`; the bound is
**maxError < 1e-3**, asserted in the CI lane. The
`eigen` op serves SLEPc's smallest eigenvalue of the
same discrete Laplacian beside the **exact discrete
eigenvalue** (4/h²)·sin²(πh/2) — an independent closed
form, not a solver cross-check — and the lane asserts
relative error < 1e-6. A KSP/EPS non-convergence returns
`converged: false` and surfaces as NOT_COMPUTED
`engine_not_converged`, never a quiet wrong answer.

## Absent behaviour

- Env unprovisioned → NOT_COMPUTED
  `engine_unavailable:petsc` with the install hint.
- Env provisioned but the petsc4py stack does not
  import → FAIL `engine_failed:petsc:petsc stack import
  failed: …` (a provisioning defect, named as such).
- Out-of-range sizes are refused by the kernel naming
  the bound, before any solve.

## Tests

`server/tests/conkay/engines/petsc.test.js` —
registration (incl. the shared-env path asserted as the
design), absence, schema and unknown-op refusals, and
the kernel's import-failure shape locally; the value
legs run only in the CI lane
(`.github/workflows/conkay-engine-petsc.yml`, manual
dispatch per F8), which provisions the env, sets
`CONKAY_ENGINE_PETSC_BIN` to it, and fails if any test
skips.
