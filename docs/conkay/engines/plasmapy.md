# Engine: plasmapy — PlasmaPy · SXE-31

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/plasmapy.js` — id `plasmapy`,
version pin **2025.1.0**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_PLASMAPY_BIN` (default
`/opt/concord-engines/plasmapy/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `formulary`. Kernel:
`server/lib/conkay/engines/kernels/kernel-plasmapy.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/plasmapy` (PlasmaPy 2025.1.0, pip pin). Footprint: ~512 MB disk, 1 GB memory, 2 threads.

## Health

`health` serves the electron plasma frequency and Debye length from PlasmaPy's formulary beside the closed forms computed independently in the kernel from CODATA constants; band **1e-6** relative.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:plasmapy` with the install hint.
- Env provisioned but plasmapy unimportable → FAIL `engine_failed:plasmapy:plasmapy import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:plasmapy` before spawn; an unknown
  op → FAIL `engine_unknown_op:plasmapy:<op>`.

## Tests

`server/tests/conkay/engines/plasmapy.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-plasmapy.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_PLASMAPY_BIN`, and fails if any test skips.
