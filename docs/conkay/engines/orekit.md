# Engine: orekit — Orekit · SXE-36

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/orekit.js` — id `orekit`,
version pin **13.1.0**, licence **Apache-2.0**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_OREKIT_BIN` (default
`/opt/concord-engines/orekit/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `orbit`. Kernel:
`server/lib/conkay/engines/kernels/kernel-orekit.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/orekit` (orekit 13.1.0, pip pin; needs a JRE on the host) and the orekit-data set at `/opt/concord-engines/orekit-data` (OREKIT_DATA overrides; that path is the kernel's default; the archive layout is verified at first dispatch). Footprint: ~1 GB disk, 2 GB memory, 2 threads.

## Health

`health`: a Keplerian orbit (a = 7000 km) built in Orekit; its period vs Kepler's third law computed in-kernel (band **1e-6**), and one full period under Orekit's analytic Keplerian propagator must close within **1 m** (the analytic propagator closes to numerical precision).

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:orekit` with the install hint.
- Env provisioned but the orekit wrapper or its data set missing → FAIL (kernel exit 3, named).
- A request that fails the op schema → FAIL
  `engine_request_invalid:orekit` before spawn; an unknown
  op → FAIL `engine_unknown_op:orekit:<op>`.

## Tests

`server/tests/conkay/engines/orekit.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-orekit.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_OREKIT_BIN`, and fails if any test skips.
