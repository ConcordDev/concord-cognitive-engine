# Engine: sgp4 — sgp4 · SXE-36

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/sgp4.js` — id `sgp4`,
version pin **2.24**, licence **MIT**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_SGP4_BIN` (default
`/opt/concord-engines/sgp4/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `propagate`. Kernel:
`server/lib/conkay/engines/kernels/kernel-sgp4.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/sgp4` (sgp4 2.24, pip pin). Footprint: ~128 MB disk, 256 MB memory, 1 thread.

## Health

`health`: the documented Vanguard 1 test TLE (the worked example in the sgp4 package documentation) propagated over 600 s. The orbital radius must stay inside the envelope the TLE's own elements imply, and the specific orbital energy and angular momentum — conserved by the two-body part of the model — must drift by less than **0.5%** (the residual is SGP4's secular/drag modelling over the arc).

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:sgp4` with the install hint.
- Env provisioned but sgp4 unimportable → FAIL `engine_failed:sgp4:sgp4 import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:sgp4` before spawn; an unknown
  op → FAIL `engine_unknown_op:sgp4:<op>`.

## Tests

`server/tests/conkay/engines/sgp4.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-sgp4.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_SGP4_BIN`, and fails if any test skips.
