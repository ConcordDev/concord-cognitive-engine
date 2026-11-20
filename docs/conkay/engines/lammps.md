# Engine: lammps — LAMMPS · SXE-27

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/lammps.js` — id `lammps`,
version pin **20240829**, licence **GPL-2.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_LAMMPS_BIN` (default
`/opt/concord-engines/lammps/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `nve-run`. Kernel:
`server/lib/conkay/engines/kernels/kernel-lammps.py`.

## Install (host provisioning, H2)

Provision the LAMMPS stable_29Aug2024 binary on PATH (serial source build from the pinned tag) and a driver venv at `/opt/concord-engines/lammps`. Footprint: ~512 MB disk, 1 GB memory, 4 threads.

## Health

`health` is the plan's case: **LJ argon NVE** — a 256-atom FCC system equilibrated under NVT, then run microcanonically for 1000 steps; the kernel parses the thermo log's total-energy series and the acceptance is the plan's drift bound |E_end - E_start| / |E_start| <= **1%**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:lammps` with the install hint.
- Env provisioned but the lmp binary missing → FAIL `engine_failed:lammps:lammps executable (lmp) not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:lammps` before spawn; an unknown
  op → FAIL `engine_unknown_op:lammps:<op>`.

## Tests

`server/tests/conkay/engines/lammps.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-lammps.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_LAMMPS_BIN`, and fails if any test skips.
