# Engine: meep — Meep FDTD · SXE-18

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/meep.js` — id `meep`,
version pin **1.31.0**, licence **GPL-2.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_MEEP_BIN` (default
`/opt/concord-engines/meep/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `fabry-perot`. Kernel:
`server/lib/conkay/engines/kernels/kernel-meep.py`.

## Install (host provisioning, H2)

Provision a conda env at `/opt/concord-engines/meep` (Python 3.12 + pymeep 1.31.0 from conda-forge). Footprint: ~1 GB disk, 2 GB memory, 4 threads.

## Health

`health` is the plan's case: 1-D Fabry-Perot transmission through a dielectric slab (n=1.5) vs the transfer-matrix spectrum computed independently in the kernel; band **0.03** absolute in T across the sampled band.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:meep` with the install hint.
- Env provisioned but meep unimportable → FAIL `engine_failed:meep:meep import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:meep` before spawn; an unknown
  op → FAIL `engine_unknown_op:meep:<op>`.

## Tests

`server/tests/conkay/engines/meep.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-meep.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_MEEP_BIN`, and fails if any test skips.
