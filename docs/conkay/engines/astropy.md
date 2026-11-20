# Engine: astropy — Astropy · SXE-36

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/astropy.js` — id `astropy`,
version pin **7.1.0**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_ASTROPY_BIN` (default
`/opt/concord-engines/astropy/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `position`. Kernel:
`server/lib/conkay/engines/kernels/kernel-astropy.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/astropy` (astropy 7.1.0 + jplephem, pip pins); the lane warms the DE440s ephemeris download at install. Footprint: ~512 MB disk, 1 GB memory, 2 threads.

## Health

`health` is the plan's case in two tiers. Tier 1 (this suite): the Earth's barycentric position at 2026-01-01 TT, distance inside the physical envelope **[0.98, 1.02] AU**. Tier 2 (the `position` op): the same vector vs the **JPL Horizons** reference for the epoch, fetched once by the lane and stored with provenance in CONKAY_ASTROPY_REF_XYZ_KM; band **5,000 km** per component with the DE440s ephemeris active (the Horizons family), **300,000 km** with Astropy's low-precision built-in ephemeris. Until the lane records the reference, `position` is exit 3 — never a fabricated comparison.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:astropy` with the install hint.
- Env provisioned but astropy unimportable → FAIL `engine_failed:astropy:astropy import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:astropy` before spawn; an unknown
  op → FAIL `engine_unknown_op:astropy:<op>`.

## Tests

`server/tests/conkay/engines/astropy.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-astropy.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_ASTROPY_BIN`, and fails if any test skips.
