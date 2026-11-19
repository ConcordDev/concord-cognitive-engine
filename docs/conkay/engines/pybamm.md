# Engine: pybamm — PyBaMM battery modelling · SXE-25

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/pybamm.js` — id `pybamm`,
version pin **25.1.0**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_PYBAMM_BIN` (default
`/opt/concord-engines/pybamm/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `discharge`. Kernel:
`server/lib/conkay/engines/kernels/kernel-pybamm.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/pybamm` (PyBaMM 25.1.0, pip pin). Footprint: ~1 GB disk, 1 GB memory, 2 threads.

## Health

`health` is the plan's case: an SPM 1C discharge (Chen2020 parameter set) that completes to 2.5 V, with the discharged capacity within **8%** of the parameter set's nominal — the nominal is read from the parameter values solved with, never hard-coded.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:pybamm` with the install hint.
- Env provisioned but pybamm unimportable → FAIL `engine_failed:pybamm:pybamm import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:pybamm` before spawn; an unknown
  op → FAIL `engine_unknown_op:pybamm:<op>`.

## Tests

`server/tests/conkay/engines/pybamm.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-pybamm.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_PYBAMM_BIN`, and fails if any test skips.
