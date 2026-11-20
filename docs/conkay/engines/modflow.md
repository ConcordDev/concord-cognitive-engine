# Engine: modflow — MODFLOW 6 (via FloPy) · SXE-35

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/modflow.js` — id `modflow`,
version pin **6.5.0**, licence **Public domain (USGS)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_MODFLOW_BIN` (default
`/opt/concord-engines/modflow/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `aquifer`. Kernel:
`server/lib/conkay/engines/kernels/kernel-modflow.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/modflow` (FloPy 3.9.2, pip pin) and the MODFLOW 6 binary (6.5.0 series, fetched by FloPy's get-modflow from the USGS release) where `CONKAY_MF6_BIN` points. Footprint: ~512 MB disk, 512 MB memory, 1 thread.

## Health

`health`: a one-layer confined aquifer strip with fixed heads at both ends — the steady head profile is exactly linear, so the middle cell must equal the mean of the boundary heads; band **2%** of the head drop, computed in the kernel.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:modflow` with the install hint.
- Env provisioned but flopy unimportable or the mf6 binary missing → FAIL `engine_failed:modflow:…` naming which.
- A request that fails the op schema → FAIL
  `engine_request_invalid:modflow` before spawn; an unknown
  op → FAIL `engine_unknown_op:modflow:<op>`.

## Tests

`server/tests/conkay/engines/modflow.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-modflow.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_MODFLOW_BIN`, and fails if any test skips.
