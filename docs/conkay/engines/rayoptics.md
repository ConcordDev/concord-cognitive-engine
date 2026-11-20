# Engine: rayoptics — rayoptics · SXE-33

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/rayoptics.js` — id `rayoptics`,
version pin **0.9.3**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_RAYOPTICS_BIN` (default
`/opt/concord-engines/rayoptics/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `focal-length`. Kernel:
`server/lib/conkay/engines/kernels/kernel-rayoptics.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/rayoptics` (rayoptics 0.9.3, pip pin). Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health` is the plan's case: a **singlet focal length vs the lensmaker's equation**. The kernel builds a symmetric biconvex singlet (R = +/-100 mm, 5 mm thick, n = 1.5168 — the N-BK7 d-line index as tabulated by refractiveindex.info, this row's data source) through rayoptics' paraxial model and compares its EFL against the thick-lens lensmaker equation computed in-kernel from the same curvatures; band **1%**. The rayoptics paraxial API surface is verified at the lane's first dispatch.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:rayoptics` with the install hint.
- Env provisioned but rayoptics unimportable → FAIL `engine_failed:rayoptics:rayoptics import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:rayoptics` before spawn; an unknown
  op → FAIL `engine_unknown_op:rayoptics:<op>`.

## Tests

`server/tests/conkay/engines/rayoptics.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-rayoptics.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_RAYOPTICS_BIN`, and fails if any test skips.
