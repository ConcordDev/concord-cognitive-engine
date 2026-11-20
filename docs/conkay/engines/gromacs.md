# Engine: gromacs — GROMACS · SXE-27

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/gromacs.js` — id `gromacs`,
version pin **2024.4**, licence **LGPL-2.1-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_GROMACS_BIN` (default
`/opt/concord-engines/gromacs/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `minimize`. Kernel:
`server/lib/conkay/engines/kernels/kernel-gromacs.py`.

## Install (host provisioning, H2)

Provision a conda env at `/opt/concord-engines/gromacs` (Python 3.12 + gromacs 2024.4 from conda-forge; gmx linked onto PATH) and the tutorial case dir (below). Footprint: ~1 GB disk, 2 GB memory, 4 threads.

## Health

`health` is the plan's case: the GROMACS **lysozyme tutorial's energy minimisation converges**. The tutorial's post-pdb2gmx state is a provisioned case (the vina precedent): the lane assembles `CONKAY_GROMACS_CASE_DIR` once from the official tutorial files (1AKI through pdb2gmx, solvation and ions, with the tutorial's em.mdp) as case.gro / case.top / em.mdp; the kernel runs grompp + mdrun and reads convergence from the log — mdrun completed AND the 'converged to Fmax' criterion met. When the lane has recorded `CONKAY_GROMACS_REF_EPOT` from a verified run, the final potential energy must also sit within **10%** of it. Absent case is exit 3, never a fabricated structure.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:gromacs` with the install hint.
- Env provisioned but the gmx binary or the case dir missing → FAIL (kernel exit 3, named: `gmx executable not found …` / `gromacs case dir not provisioned …`).
- A request that fails the op schema → FAIL
  `engine_request_invalid:gromacs` before spawn; an unknown
  op → FAIL `engine_unknown_op:gromacs:<op>`.

## Tests

`server/tests/conkay/engines/gromacs.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-gromacs.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_GROMACS_BIN`, and fails if any test skips.
