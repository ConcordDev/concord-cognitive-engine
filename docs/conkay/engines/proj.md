# Engine: proj — PROJ (via pyproj) · SXE-35

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/proj.js` — id `proj`,
version pin **9.6.0**, licence **MIT**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_PROJ_BIN` (default
`/opt/concord-engines/proj/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `web-mercator`. Kernel:
`server/lib/conkay/engines/kernels/kernel-proj.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/proj` (pyproj 3.7.2, which bundles PROJ 9.6.0). Footprint: ~256 MB disk, 256 MB memory, 1 thread.

## Health

`health`: EPSG:4326 -> EPSG:3857 for a fixed point (Poughkeepsie, NY) vs the Web Mercator spherical closed form computed in the kernel (R = 6378137 — the formulas EPSG:3857 is defined by); band **1e-9** relative.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:proj` with the install hint.
- Env provisioned but pyproj unimportable → FAIL `engine_failed:proj:pyproj import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:proj` before spawn; an unknown
  op → FAIL `engine_unknown_op:proj:<op>`.

## Tests

`server/tests/conkay/engines/proj.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-proj.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_PROJ_BIN`, and fails if any test skips.
