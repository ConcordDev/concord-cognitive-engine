# Engine: spiceypy — SpiceyPy · SXE-36

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/spiceypy.js` — id `spiceypy`,
version pin **6.0.0**, licence **MIT**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_SPICEYPY_BIN` (default
`/opt/concord-engines/spiceypy/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `position`. Kernel:
`server/lib/conkay/engines/kernels/kernel-spiceypy.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/spiceypy` (spiceypy 6.0.0, pip pin) and the NAIF kernels (naif0012.tls, pck00010.tpc, de440s.bsp) under `/opt/concord-engines/spiceypy/kernels` (CONKAY_SPICE_KERNEL_DIR overrides; that path is the kernel's default). Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health`: SPICE's heliocentric Earth position at 2026-01-01 TDB, distance inside the physical envelope **[0.98, 1.02] AU**. The `position` op additionally compares vs the JPL Horizons reference stored by the lane in CONKAY_SPICE_REF_XYZ_KM, band **1,000 km** per component (DE440s vs Horizons' DE441 agree for Earth well inside it); until the lane records it, `position` is exit 3.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:spiceypy` with the install hint.
- Env provisioned but spiceypy unimportable or a NAIF kernel file missing → FAIL (kernel exit 3, named).
- A request that fails the op schema → FAIL
  `engine_request_invalid:spiceypy` before spawn; an unknown
  op → FAIL `engine_unknown_op:spiceypy:<op>`.

## Tests

`server/tests/conkay/engines/spiceypy.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-spiceypy.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_SPICEYPY_BIN`, and fails if any test skips.
