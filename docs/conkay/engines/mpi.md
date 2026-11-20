# Engine: mpi — MPI lane (OpenMPI) · SXE-39

The parallel launcher lane every MPI engine rides
(OpenFOAM, SU2, Code_Aster, LAMMPS, GROMACS, OpenMC,
FEniCSx). Built in the CI-only scope of the founder F1
ruling (2026-11-18) under SXE-52; the H2 host it will
run on is that programme's deferred-open remainder —
nothing is installed on any host by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/mpi.js` — id `mpi`,
version pin **OpenMPI 5.0.11**, licence **BSD-3-Clause**
(re-read from the pinned release at registration,
2026-11-18), link mode **process**. The framework
resolves the lane's driver-env Python via
`CONKAY_ENGINE_MPI_BIN` (default
`/opt/concord-engines/mpi/bin/python`): the env exists
only where the lane is provisioned, so the report's
`present` tracks provisioning. Ops: `health`,
`reduce-sum`. Kernel:
`server/lib/conkay/engines/kernels/kernel-mpi.py`.

## Install (host provisioning, H2)

Provision a driver env at `/opt/concord-engines/mpi`
(Python 3.12 + mpi4py built against OpenMPI 5.0.11) with
OpenMPI 5.0.11's `mpirun` on PATH. Footprint: ~256 MB
disk, 512 MB memory, rank cap **8** (the manifest's
`footprint.threads`; the kernel refuses above it).

## Health

`health` runs the reduction at np=2: ranks contribute
(rank + 1) and the MPI SUM must be exactly **3**. The
general `reduce-sum` op takes `{np}` and serves
`{np, total, expectedTotal}` only after the kernel has
verified the launcher started exactly np ranks and the
reduction equals the closed form np(np+1)/2 — a launcher
shortfall or a garbled total is rejected, never served.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:mpi` with the install hint.
- Env provisioned but `mpirun` missing → FAIL
  `engine_failed:mpi:mpirun executable not found …`
  (a provisioning defect, named as such).
- np above the cap → FAIL naming the cap, before spawn.

## Tests

`server/tests/conkay/engines/mpi.test.js` — registration,
absence, schema and unknown-op refusals locally; kernel
logic against a one-rank stub launcher (exact np=1
reduction, rank-shortfall refusal, cap refusal,
mpirun-absence). The multi-rank leg runs only in the CI
lane (`.github/workflows/conkay-engine-mpi.yml`,
manual dispatch per F8), which installs OpenMPI +
mpi4py, sets `CONKAY_ENGINE_MPI_BIN`, and fails if any
test skips.

## First-live corrections (2026-11-19)

The lane's first live dispatch failed in ~40 ms: the
runner's distro OpenMPI (apt, 5.0.10 — also short of
the 5.0.11 pin) is broken on the current runner image
(its pmix/prrte help files are missing, and mpirun
dies at init). The lane now provisions the pinned
pair from conda-forge — `openmpi=5.0.11` +
`mpi4py=4.1.2` in one env at
`/opt/concord-engines/mpi` (conda-forge carries both
pins for linux-64; verified 2026-11-19) — self-
contained, with its own pmix/prrte, and exports the
env's bin on PATH for the test step (the kernel finds
mpirun by PATH).
