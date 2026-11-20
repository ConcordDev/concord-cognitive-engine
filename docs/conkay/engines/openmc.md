# Engine: openmc — OpenMC · SXE-30

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/openmc.js` — id `openmc`,
version pin **0.15.2**, licence **MIT**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_OPENMC_BIN` (default
`/opt/concord-engines/openmc/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `godiva`. Kernel:
`server/lib/conkay/engines/kernels/kernel-openmc.py`.

## Install (host provisioning, H2)

Provision a conda env at `/opt/concord-engines/openmc` (Python 3.12 + OpenMC 0.15.2 from conda-forge) and the official ENDF/B-VIII.0 HDF5 library with `OPENMC_CROSS_SECTIONS` pointing at its cross_sections.xml (the lane records the exact extracted path at provisioning; the env value in the lane file is the documented default layout). Footprint: ~4 GB disk (mostly the library), 2 GB memory, 4 threads.

## Health

`health` is the plan's case: the Godiva bare sphere (HEU-MET-FAST-001) must come back critical — k_eff within **0.015** of 1.0, the ICSBEP benchmark value the case is defined by. Defaults are lane-sized (20 batches x 2000 particles). Absent library → exit 3; no k_eff is ever fabricated.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:openmc` with the install hint.
- Env provisioned but openmc unimportable or OPENMC_CROSS_SECTIONS unset → FAIL `engine_failed:openmc:…` naming which.
- A request that fails the op schema → FAIL
  `engine_request_invalid:openmc` before spawn; an unknown
  op → FAIL `engine_unknown_op:openmc:<op>`.

## Tests

`server/tests/conkay/engines/openmc.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-openmc.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_OPENMC_BIN`, and fails if any test skips.
