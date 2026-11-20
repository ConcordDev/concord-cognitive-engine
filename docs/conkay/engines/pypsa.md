# Engine: pypsa — PyPSA · SXE-19

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/pypsa.js` — id `pypsa`,
version pin **0.35.2**, licence **MIT**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_PYPSA_BIN` (default
`/opt/concord-engines/pypsa/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `dispatch`. Kernel:
`server/lib/conkay/engines/kernels/kernel-pypsa.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/pypsa` (pypsa 0.35.2 + highspy, pip pins). Footprint: ~512 MB disk, 1 GB memory, 2 threads.

## Health

`health`: a one-bus, two-generator dispatch whose optimum is a closed form — the cheap generator (10/MWh, capped 40 MW) saturates, the dearer (20/MWh) takes the rest; at the default 70 MW the objective is exactly 1000. The kernel computes the closed form itself for any requested load and the band is **1e-6** relative.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:pypsa` with the install hint.
- Env provisioned but pypsa unimportable → FAIL `engine_failed:pypsa:pypsa import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:pypsa` before spawn; an unknown
  op → FAIL `engine_unknown_op:pypsa:<op>`.

## Tests

`server/tests/conkay/engines/pypsa.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-pypsa.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_PYPSA_BIN`, and fails if any test skips.
