# Engine: pvlib — pvlib · SXE-37

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/pvlib.js` — id `pvlib`,
version pin **0.13.0**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_PVLIB_BIN` (default
`/opt/concord-engines/pvlib/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `clear-sky`. Kernel:
`server/lib/conkay/engines/kernels/kernel-pvlib.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/pvlib` (pvlib 0.13.0, pip pin). Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health` is the plan's case in cross-check form: **clear-sky GHI** at Albuquerque, 2026-06-21 18:00 UTC. pvlib's solar position vs the NOAA solar calculator's closed-form series computed in-kernel (band **0.15 degrees**), and pvlib's Ineichen GHI vs its simplified-Solis GHI — two published models with different parameterisations — within **10%** (cross-model agreement is the acceptance class; neither model is the other's code).

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:pvlib` with the install hint.
- Env provisioned but pvlib unimportable → FAIL `engine_failed:pvlib:pvlib import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:pvlib` before spawn; an unknown
  op → FAIL `engine_unknown_op:pvlib:<op>`.

## Tests

`server/tests/conkay/engines/pvlib.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-pvlib.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_PVLIB_BIN`, and fails if any test skips.
