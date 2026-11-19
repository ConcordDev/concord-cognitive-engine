# Engine: phreeqc — PHREEQC (via phreeqpy) · SXE-24

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/phreeqc.js` — id `phreeqc`,
version pin **3.8.6**, licence **Public domain (USGS)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_PHREEQC_BIN` (default
`/opt/concord-engines/phreeqc/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `example1`. Kernel:
`server/lib/conkay/engines/kernels/kernel-phreeqc.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/phreeqc` (phreeqpy, which bundles IPhreeqc; pin of record for the IPhreeqc library 3.8.6). Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health` is the plan's case: PHREEQC Example 1, speciation of the manual's published seawater composition; the computed pH must sit within **0.1** of the manual's reported 8.22 (the band covers database version variation; the lane verifies against the manual output on first dispatch).

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:phreeqc` with the install hint.
- Env provisioned but phreeqpy unimportable → FAIL `engine_failed:phreeqc:phreeqpy import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:phreeqc` before spawn; an unknown
  op → FAIL `engine_unknown_op:phreeqc:<op>`.

## Tests

`server/tests/conkay/engines/phreeqc.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-phreeqc.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_PHREEQC_BIN`, and fails if any test skips.
