# Engine: roadrunner — libRoadRunner · SXE-28

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/roadrunner.js` — id `roadrunner`,
version pin **2.8.0**, licence **Apache-2.0**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_ROADRUNNER_BIN` (default
`/opt/concord-engines/roadrunner/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `decay`. Kernel:
`server/lib/conkay/engines/kernels/kernel-roadrunner.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/roadrunner` (libRoadRunner 2.8.0, pip pin). Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health`: a one-species decay SBML model integrated by RoadRunner; the final concentration must match the closed form x0*exp(-k*t) computed in the kernel; band **1e-3** relative.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:roadrunner` with the install hint.
- Env provisioned but roadrunner unimportable → FAIL `engine_failed:roadrunner:roadrunner import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:roadrunner` before spawn; an unknown
  op → FAIL `engine_unknown_op:roadrunner:<op>`.

## Tests

`server/tests/conkay/engines/roadrunner.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-roadrunner.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_ROADRUNNER_BIN`, and fails if any test skips.
