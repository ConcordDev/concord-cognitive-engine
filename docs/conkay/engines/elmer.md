# Engine: elmer — Elmer FEM · SXE-10

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/elmer.js` — id `elmer`,
version pin **9.0**, licence **GPL-2.0-only/LGPL-2.1-only (process)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_ELMER_BIN` (default
`/opt/concord-engines/elmer/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `coil`. Kernel:
`server/lib/conkay/engines/kernels/kernel-elmer.py`.

## Install (host provisioning, H2)

Install Elmer 9.0 so `ElmerSolver` is on PATH, keep its shipped test tree where `CONKAY_ELMER_TESTS` points, and provision a driver venv at `/opt/concord-engines/elmer`. Footprint: ~1 GB disk, 2 GB memory, 4 threads.

## Health

`health` runs Elmer's OWN shipped test case `mgdyn_steady_coil` (the plan's case) and requires completion with finite saved data. Named substitution on the value leg: the case's reference value is environment data — the lane records it on its first verified run into `CONKAY_ELMER_REFERENCE`, and the kernel then enforces a **5%** band; no reference number is invented in code.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:elmer` with the install hint.
- Env provisioned but ElmerSolver or the test tree missing → FAIL `engine_failed:elmer:…` naming which.
- A request that fails the op schema → FAIL
  `engine_request_invalid:elmer` before spawn; an unknown
  op → FAIL `engine_unknown_op:elmer:<op>`.

## Tests

`server/tests/conkay/engines/elmer.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-elmer.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_ELMER_BIN`, and fails if any test skips.
