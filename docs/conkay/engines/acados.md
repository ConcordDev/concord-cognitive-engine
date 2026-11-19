# Engine: acados — acados · SXE-20

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/acados.js` — id `acados`,
version pin **0.5.0**, licence **BSD-2-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_ACADOS_BIN` (default
`/opt/concord-engines/acados/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `ocp`. Kernel:
`server/lib/conkay/engines/kernels/kernel-acados.py`.

## Install (host provisioning, H2)

Provision the acados 0.5.0 build (shared libraries + `acados_template` Python package, which also needs casadi) with the driver Python at `/opt/concord-engines/acados`. Footprint: ~1 GB disk, 1 GB memory, 2 threads.

## Health

`health` solves a finite-horizon LQR OCP on the double integrator (x0 = [1, 0], N=20, tf=2 s). The independent reference is the discrete Riccati recursion iterated in the kernel: the first control must agree within **5%** (the band covers acados' RTI scheme) and |p(tf)| < 0.1.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:acados` with the install hint.
- Env provisioned but acados_template unimportable → FAIL `engine_failed:acados:acados import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:acados` before spawn; an unknown
  op → FAIL `engine_unknown_op:acados:<op>`.

## Tests

`server/tests/conkay/engines/acados.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-acados.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_ACADOS_BIN`, and fails if any test skips.
