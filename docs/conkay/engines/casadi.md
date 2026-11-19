# Engine: casadi — CasADi · SXE-20

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/casadi.js` — id `casadi`,
version pin **3.7.0**, licence **LGPL-3.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_CASADI_BIN` (default
`/opt/concord-engines/casadi/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `nlp`. Kernel:
`server/lib/conkay/engines/kernels/kernel-casadi.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/casadi` (casadi 3.7.0, pip pin; the wheel bundles IPOPT). Footprint: ~512 MB disk, 512 MB memory, 2 threads.

## Health

`health` solves a projection NLP with an exact closed form (minimise (x-2)^2 + y^2 subject to x + y = 0 → (1, -1), f = 2) via Opti/IPOPT and compares against the projection formula computed independently in the kernel; band **1e-6**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:casadi` with the install hint.
- Env provisioned but casadi unimportable → FAIL `engine_failed:casadi:casadi import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:casadi` before spawn; an unknown
  op → FAIL `engine_unknown_op:casadi:<op>`.

## Tests

`server/tests/conkay/engines/casadi.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-casadi.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_CASADI_BIN`, and fails if any test skips.
