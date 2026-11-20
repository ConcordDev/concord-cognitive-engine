# Engine: swmm — EPA SWMM · SXE-35

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/swmm.js` — id `swmm`,
version pin **5.2.4**, licence **Public domain (US EPA)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_SWMM_BIN` (default
`/opt/concord-engines/swmm/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `runoff`. Kernel:
`server/lib/conkay/engines/kernels/kernel-swmm.py`.

## Install (host provisioning, H2)

Provision runswmm built from the pinned EPA SWMM 5.2.4 source on PATH, and a driver venv at `/opt/concord-engines/swmm`. Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health`: one 1-hectare, 100%-impervious subcatchment with zero depression storage under a 25 mm / 1 h storm — with no losses in the input, the outfall volume must match the analytic rainfall volume (250 m^3) within **15%** (SWMM's runoff discretisation).

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:swmm` with the install hint.
- Env provisioned but runswmm missing → FAIL `engine_failed:swmm:runswmm executable not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:swmm` before spawn; an unknown
  op → FAIL `engine_unknown_op:swmm:<op>`.

## Tests

`server/tests/conkay/engines/swmm.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-swmm.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_SWMM_BIN`, and fails if any test skips.
