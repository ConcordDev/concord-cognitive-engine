# Engine: mpb — MPB (Meep band structure) · SXE-18

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/mpb.js` — id `mpb`,
version pin **1.12.0**, licence **GPL-2.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_MPB_BIN` (default
`/opt/concord-engines/mpb/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `bands`. Kernel:
`server/lib/conkay/engines/kernels/kernel-mpb.py`.

## Install (host provisioning, H2)

Provision a conda env at `/opt/concord-engines/mpb` (Python 3.12 + mpb 1.12.0 from conda-forge). Footprint: ~512 MB disk, 1 GB memory, 2 threads.

## Health

`health` computes the first two zone-edge band frequencies of a 1-D two-layer stack (eps 12/1) and compares them with the roots of the exact 1-D dispersion relation solved independently in the kernel; band **2%**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:mpb` with the install hint.
- Env provisioned but mpb unimportable → FAIL `engine_failed:mpb:mpb import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:mpb` before spawn; an unknown
  op → FAIL `engine_unknown_op:mpb:<op>`.

## Tests

`server/tests/conkay/engines/mpb.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-mpb.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_MPB_BIN`, and fails if any test skips.
