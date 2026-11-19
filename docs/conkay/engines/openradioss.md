# Engine: openradioss — OpenRadioss explicit dynamics · SXE-13

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/openradioss.js` — id `openradioss`,
version pin **2025.09**, licence **AGPL-3.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_OPENRADIOSS_BIN` (default
`/opt/concord-engines/openradioss/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `bar-impact`. Kernel:
`server/lib/conkay/engines/kernels/kernel-openradioss.py`.

## Install (host provisioning, H2)

Provision the UNMODIFIED OpenRadioss 2025.09 distribution (binaries + QA set) at the path `CONKAY_OPENRADIOSS_HOME` names, and a driver venv at `/opt/concord-engines/openradioss`. Footprint: ~2 GB disk, 4 GB memory, 8 threads.

## Health

`health` runs the distribution's OWN shipped QA bar-impact deck through its starter + engine and checks the energy balance: final TOTAL ENERGY vs the starter's initial TOTAL ENERGY, drift band **10%**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:openradioss` with the install hint.
- Env provisioned but the distribution home, binaries, or QA deck missing → FAIL `engine_failed:openradioss:…` naming the missing piece.
- A request that fails the op schema → FAIL
  `engine_request_invalid:openradioss` before spawn; an unknown
  op → FAIL `engine_unknown_op:openradioss:<op>`.

## Tests

`server/tests/conkay/engines/openradioss.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-openradioss.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_OPENRADIOSS_BIN`, and fails if any test skips.
