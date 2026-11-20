# Engine: rebound — REBOUND · SXE-36

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/rebound.js` — id `rebound`,
version pin **4.4.0**, licence **GPL-3.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_REBOUND_BIN` (default
`/opt/concord-engines/rebound/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `orbit`. Kernel:
`server/lib/conkay/engines/kernels/kernel-rebound.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/rebound` (rebound 4.4.0, pip pin). Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health`: a test particle on a circular orbit (a = 1, G = M = 1). REBOUND's own orbital period vs Kepler's third law computed in-kernel (band **1e-6**), and one full period integrated with the particle required to return within **1e-3** of its start.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:rebound` with the install hint.
- Env provisioned but rebound unimportable → FAIL `engine_failed:rebound:rebound import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:rebound` before spawn; an unknown
  op → FAIL `engine_unknown_op:rebound:<op>`.

## Tests

`server/tests/conkay/engines/rebound.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-rebound.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_REBOUND_BIN`, and fails if any test skips.
