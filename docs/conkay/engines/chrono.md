# Engine: chrono — Project Chrono (PyChrono) · SXE-14

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/chrono.js` — id `chrono`,
version pin **9.0.0**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_CHRONO_BIN` (default
`/opt/concord-engines/chrono/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `pendulum`. Kernel:
`server/lib/conkay/engines/kernels/kernel-chrono.py`.

## Install (host provisioning, H2)

Provision a conda env at `/opt/concord-engines/chrono` (Python 3.12 + pychrono 9.0.0 from conda-forge). Footprint: ~4 GB disk, 2 GB memory, 4 threads.

## Health

`health` integrates a single pendulum (L=1 m, released at 0.2 rad) in Chrono's NSC system and measures the period from tip zero crossings. The closed form carries the first-order amplitude correction 2*pi*sqrt(L/g)*(1 + theta0^2/16); the acceptance band is **2%**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:chrono` with the install hint.
- Env provisioned but pychrono unimportable → FAIL `engine_failed:chrono:pychrono import failed …` (a provisioning defect, named as such).
- A request that fails the op schema → FAIL
  `engine_request_invalid:chrono` before spawn; an unknown
  op → FAIL `engine_unknown_op:chrono:<op>`.

## Tests

`server/tests/conkay/engines/chrono.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-chrono.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_CHRONO_BIN`, and fails if any test skips.
