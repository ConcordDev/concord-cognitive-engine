# Engine: skyfield — Skyfield · SXE-36

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/skyfield.js` — id `skyfield`,
version pin **1.49**, licence **MIT**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_SKYFIELD_BIN` (default
`/opt/concord-engines/skyfield/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `position`. Kernel:
`server/lib/conkay/engines/kernels/kernel-skyfield.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/skyfield` (skyfield 1.49, pip pin); the lane pre-downloads de421.bsp into `~/.skyfield` (the kernel's default data dir; CONKAY_SKYFIELD_DATA overrides). Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health`: Skyfield's Earth-Sun distance at 2026-01-01 TT inside the physical envelope **[0.98, 1.02] AU** (early January sits near perihelion, ~0.983 AU). The `position` op additionally compares the barycentric Earth vector vs the JPL Horizons reference stored by the lane in CONKAY_SKYFIELD_REF_XYZ_KM, band **5,000 km** per component; until the lane records it, `position` is exit 3.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:skyfield` with the install hint.
- Env provisioned but skyfield unimportable or de421.bsp missing → FAIL (kernel exit 3, named).
- A request that fails the op schema → FAIL
  `engine_request_invalid:skyfield` before spawn; an unknown
  op → FAIL `engine_unknown_op:skyfield:<op>`.

## Tests

`server/tests/conkay/engines/skyfield.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-skyfield.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_SKYFIELD_BIN`, and fails if any test skips.
