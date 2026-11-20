# Engine: pandapower — pandapower · SXE-19

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/pandapower.js` — id `pandapower`,
version pin **2.14.11**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_PANDAPOWER_BIN` (default
`/opt/concord-engines/pandapower/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `load-flow`. Kernel:
`server/lib/conkay/engines/kernels/kernel-pandapower.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/pandapower` (pandapower 2.14.11, pip pin). Footprint: ~512 MB disk, 1 GB memory, 2 threads.

## Health

`health` is the plan's case: the **IEEE 14-bus** power flow vs the published solution. pandapower's built-in case14 network is run and every bus voltage magnitude is compared against the standard published Vm profile embedded in the kernel; band **0.005 pu** (the published profile is rounded to 3 decimals; pandapower reproduces it to ~1e-3).

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:pandapower` with the install hint.
- Env provisioned but pandapower unimportable → FAIL `engine_failed:pandapower:pandapower import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:pandapower` before spawn; an unknown
  op → FAIL `engine_unknown_op:pandapower:<op>`.

## Tests

`server/tests/conkay/engines/pandapower.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-pandapower.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_PANDAPOWER_BIN`, and fails if any test skips.
