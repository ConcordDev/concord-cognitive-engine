# Engine: su2 — SU2 CFD · SXE-12

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/su2.js` — id `su2`,
version pin **8.3.0**, licence **LGPL-2.1-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_SU2_BIN` (default
`/opt/concord-engines/su2/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `naca`. Kernel:
`server/lib/conkay/engines/kernels/kernel-su2.py`.

## Install (host provisioning, H2)

Install SU2 8.3.0 so `SU2_CFD` is on PATH, place the inv_NACA0012 tutorial mesh where `CONKAY_SU2_MESH` points, and provision a driver venv at `/opt/concord-engines/su2`. Footprint: ~1 GB disk, 2 GB memory, 4 threads.

## Health

`health` runs the inviscid NACA0012 tutorial case (Mach 0.8, AoA 1.25 deg, Euler, 250 iterations) and serves the final CL beside the SU2 tutorial's published **CL ~ 0.287**; acceptance band **+-0.05**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:su2` with the install hint.
- Env provisioned but SU2_CFD or the tutorial mesh missing → FAIL `engine_failed:su2:…` naming which.
- A request that fails the op schema → FAIL
  `engine_request_invalid:su2` before spawn; an unknown
  op → FAIL `engine_unknown_op:su2:<op>`.

## Tests

`server/tests/conkay/engines/su2.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-su2.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_SU2_BIN`, and fails if any test skips.
