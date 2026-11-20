# Engine: radiance — Radiance · SXE-33

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/radiance.js` — id `radiance`,
version pin **5.4**, licence **Radiance License**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_RADIANCE_BIN` (default
`/opt/concord-engines/radiance/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `trace`. Kernel:
`server/lib/conkay/engines/kernels/kernel-radiance.py`.

## Install (host provisioning, H2)

Provision the Radiance 5.4 binaries (oconv, rtrace) on PATH from the pinned LBNL source release and a driver venv at `/opt/concord-engines/radiance`. Footprint: ~256 MB disk, 512 MB memory, 1 thread. The source tag and build recipe are verified at the lane's first dispatch.

## Health

`health`: a one-object scene — a glow sphere of radiance 1.0 — compiled with oconv and traced with rtrace (-ab 0). A ray striking a glow source returns exactly the source's radiance, so this is a value check, not a completion check; band **1%**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:radiance` with the install hint.
- Env provisioned but the oconv/rtrace binaries missing → FAIL `engine_failed:radiance:radiance binaries (oconv/rtrace) not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:radiance` before spawn; an unknown
  op → FAIL `engine_unknown_op:radiance:<op>`.

## Tests

`server/tests/conkay/engines/radiance.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-radiance.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_RADIANCE_BIN`, and fails if any test skips.
