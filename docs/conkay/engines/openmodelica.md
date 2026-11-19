# Engine: openmodelica — OpenModelica + MSL · SXE-15

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/openmodelica.js` — id `openmodelica`,
version pin **1.25.0**, licence **OSMC-PL/GPL-3.0-only (process); MSL BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_OPENMODELICA_BIN` (default
`/opt/concord-engines/openmodelica/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `first`. Kernel:
`server/lib/conkay/engines/kernels/kernel-openmodelica.py`.

## Install (host provisioning, H2)

Install OpenModelica 1.25.0 (the release's own apt repository / installer) so `omc` is on PATH, and provision a driver venv at `/opt/concord-engines/openmodelica` (the framework's presence marker). Footprint: ~2 GB disk, 1 GB memory, 2 threads.

## Health

`health` simulates a driven inertia — the governing equation of Modelica.Mechanics.Rotational.Examples.First reduced to J*der(w) = T — with J=1, T=1 to t=1: w(1) is exactly **1**; acceptance band **1e-3** for solver tolerance.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:openmodelica` with the install hint.
- Env provisioned but `omc` missing → FAIL `engine_failed:openmodelica:omc executable not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:openmodelica` before spawn; an unknown
  op → FAIL `engine_unknown_op:openmodelica:<op>`.

## Tests

`server/tests/conkay/engines/openmodelica.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-openmodelica.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_OPENMODELICA_BIN`, and fails if any test skips.
