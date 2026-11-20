# Engine: opensim — OpenSim · SXE-28

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/opensim.js` — id `opensim`,
version pin **4.5.0**, licence **Apache-2.0**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_OPENSIM_BIN` (default
`/opt/concord-engines/opensim/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `pendulum`. Kernel:
`server/lib/conkay/engines/kernels/kernel-opensim.py`.

## Install (host provisioning, H2)

Provision a conda env at `/opt/concord-engines/opensim` (Python 3.12 + OpenSim 4.5.0 from conda-forge). Footprint: ~1 GB disk, 1 GB memory, 2 threads.

## Health

`health`: a single pendulum built through the OpenSim API and integrated with the Manager — the measured period must match 2*pi*sqrt(L/g) within **5%** (release amplitude 0.1 rad) and total mechanical energy drift must stay under **5%**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:opensim` with the install hint.
- Env provisioned but opensim unimportable → FAIL `engine_failed:opensim:opensim import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:opensim` before spawn; an unknown
  op → FAIL `engine_unknown_op:opensim:<op>`.

## Tests

`server/tests/conkay/engines/opensim.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-opensim.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_OPENSIM_BIN`, and fails if any test skips.
