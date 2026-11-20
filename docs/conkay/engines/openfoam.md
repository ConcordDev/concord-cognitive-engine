# Engine: openfoam — OpenFOAM CFD · SXE-11

The CFD workhorse (incompressible / compressible,
multiphase, reacting, turbomachinery) for the flow
solvers. Built in the CI-only scope of the founder F1
ruling (2026-11-18) under SXE-52; host provisioning
(H2) is that programme's deferred-open remainder.

## Manifest entry

`server/lib/conkay/engines/entries/openfoam.js` — id
`openfoam`, version pin **2406**, licence
**GPL-3.0-only** (re-read from the pinned release at
registration, 2026-11-18), link mode **process** — the
manifest's GPL rule: the kernel drives `blockMesh`,
`icoFoam` and `postProcess` as child processes and
reads the sampled profile; nothing of OpenFOAM is
imported or linked. Resolved via
`CONKAY_ENGINE_OPENFOAM_BIN` (default
`/opt/concord-engines/openfoam/bin/python`, the driver
env). Ops: `health`, `cavity`. Kernel:
`server/lib/conkay/engines/kernels/kernel-openfoam.py`.

**Distribution pin — F3:** v2406 is the ESI
(openfoam.com) line, the SOLVER-ENGINES-PLAN.md **F3
safe default**, recorded expressly **pending the
founder's express F3 ruling** (the alternative is the
Foundation line, openfoam.org v12). The kernel is
distribution-agnostic — the case uses only icoFoam /
blockMesh / sampling machinery present in both lines —
so flipping the pin is a one-line manifest change plus
a provisioning change, never a kernel change.

## Install (host provisioning, H2)

OpenFOAM v2406 on PATH (ESI apt package openfoam2406)
plus a stdlib-only driver venv at
`/opt/concord-engines/openfoam`. Footprint: ~2,048 MB
disk, 1,024 MB memory, 4 threads. The MPI lane (SXE-39)
is the parallel substrate for multi-rank runs.

## Health

The plan's health case: the **lid-driven cavity at
Re=100** — unit square, 40×40 mesh, icoFoam to t=10 —
with the vertical-centreline u profile compared against
**Ghia, Ghia & Shin 1982** (J. Comput. Phys. 48:387–
411, Table 1, as transcribed in a 2026 validation
paper's reproduction; primary vortex centre (0.6172,
0.7344), ψmin = −0.10342). The kernel serves u at four
stations (y = 0.8516 → 0.23151 · 0.6172 → −0.13641 ·
0.4531 → −0.21090 · 0.1719 → −0.10150) with the maximum
deviation; the health band is **maxDeviation ≤ 0.05**,
asserted in the CI lane, and the lid value must serve
at 1 m/s.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:openfoam` with the install hint.
- Env provisioned but a case binary missing → FAIL
  `engine_failed:openfoam:<binary> executable not found
  …` (a provisioning defect, named as such).
- A run that produces no sampled profile is rejected,
  never guessed.

## Tests

`server/tests/conkay/engines/openfoam.test.js` —
registration and GPL discipline with the F3 pin
asserted of record, absence, schema and unknown-op
refusals, and the kernel's binary-absence shape
locally; the Ghia value leg runs only in the CI lane
(`.github/workflows/conkay-engine-openfoam.yml`,
manual dispatch per F8 — the plan's nightly wording is
overridden by F8), which installs v2406, sets
`CONKAY_ENGINE_OPENFOAM_BIN`, and fails if any test
skips.

## First-live corrections (2026-11-19)

The lane's first live dispatch died in the test step:
the current openfoam2406 package installs to
`/usr/lib/openfoam/openfoam2406` (not `/opt`), and the
step's `source A || source B` line did not survive the
runner's `bash -e` shell. The step now locates the
bashrc by test -f across both roots, sources it with
errexit suspended, and verifies the tools with
`which` before running. The suite's kernel-direct
absence leg also spawns with a scrubbed PATH now —
sourcing the bashrc puts blockMesh on PATH for the
whole suite, and the leg's absence must hold by
construction, not by accident of environment.
