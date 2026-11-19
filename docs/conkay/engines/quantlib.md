# Engine: quantlib — QuantLib · SXE-23

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/quantlib.js` — id `quantlib`,
version pin **1.40**, licence **BSD-3-Clause (QuantLib modified BSD)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_QUANTLIB_BIN` (default
`/opt/concord-engines/quantlib/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `european-call`. Kernel:
`server/lib/conkay/engines/kernels/kernel-quantlib.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/quantlib` (QuantLib-Python 1.40, pip pin). Footprint: ~256 MB disk, 512 MB memory, 2 threads.

## Health

`health` is the plan's case: a European call (S=K=100, r=5%, sigma=20%, T=1) priced by the analytic engine beside the closed-form Black-Scholes-Merton value computed independently in the kernel; band **1e-8** relative.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:quantlib` with the install hint.
- Env provisioned but QuantLib unimportable → FAIL `engine_failed:quantlib:QuantLib import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:quantlib` before spawn; an unknown
  op → FAIL `engine_unknown_op:quantlib:<op>`.

## Tests

`server/tests/conkay/engines/quantlib.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-quantlib.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_QUANTLIB_BIN`, and fails if any test skips.
