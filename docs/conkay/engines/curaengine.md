# Engine: curaengine — CuraEngine additive slicer · SXE-38

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/curaengine.js` — id `curaengine`,
version pin **5.9.0**, licence **AGPL-3.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_CURAENGINE_BIN` (default
`/opt/concord-engines/curaengine/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `slice`. Kernel:
`server/lib/conkay/engines/kernels/kernel-curaengine.py`.

## Install (host provisioning, H2)

Install the UNMODIFIED CuraEngine 5.9.0 release so `CuraEngine` is on PATH, place its `fdmprinter.def.json` where `CONKAY_CURAENGINE_DEFJSON` points, and provision a driver venv at `/opt/concord-engines/curaengine`. Footprint: ~512 MB disk, 1 GB memory, 4 threads.

## Health

`health` slices a 20 mm cube and serves the G-code `;TIME:` print time. The plan's acceptance is a stored reference (±10%): the CI lane records the reference on its first verified run into `CONKAY_CURAENGINE_REFERENCE_S`; until then the health run is a completion leg (positive time, layers > 0) — no reference is invented.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:curaengine` with the install hint.
- Env provisioned but the binary or the definition JSON missing → FAIL `engine_failed:curaengine:…` naming which.
- A request that fails the op schema → FAIL
  `engine_request_invalid:curaengine` before spawn; an unknown
  op → FAIL `engine_unknown_op:curaengine:<op>`.

## Tests

`server/tests/conkay/engines/curaengine.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-curaengine.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_CURAENGINE_BIN`, and fails if any test skips.
