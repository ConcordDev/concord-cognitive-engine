# Engine: control — python-control (+ slycot) · SXE-20

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/control.js` — id `control`,
version pin **0.10.1**, licence **BSD-3-Clause; slycot GPL-2.0-only (child process)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_CONTROL_BIN` (default
`/opt/concord-engines/control/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `lqr`. Kernel:
`server/lib/conkay/engines/kernels/kernel-control.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/control` (python-control 0.10.1 + slycot 0.6.0, pip pins). Footprint: ~512 MB disk, 512 MB memory, 2 threads.

## Health

`health` is the plan's case: LQR on a double integrator vs the analytic Riccati solution. For Q=I, R=1 the exact gain is K = [1, sqrt(3)]; the kernel derives the closed form for general (q1, q2, r) independently of the library solver and requires agreement to **1e-6** plus strictly stable closed-loop eigenvalues.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:control` with the install hint.
- Env provisioned but python-control unimportable → FAIL `engine_failed:control:python-control import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:control` before spawn; an unknown
  op → FAIL `engine_unknown_op:control:<op>`.

## Tests

`server/tests/conkay/engines/control.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-control.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_CONTROL_BIN`, and fails if any test skips.
