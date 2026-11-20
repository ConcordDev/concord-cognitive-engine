# Engine: openbabel — Open Babel · SXE-26

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/openbabel.js` — id `openbabel`,
version pin **3.1.1**, licence **GPL-2.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_OPENBABEL_BIN` (default
`/opt/concord-engines/openbabel/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `convert`. Kernel:
`server/lib/conkay/engines/kernels/kernel-openbabel.py`.

## Install (host provisioning, H2)

Provision the obabel CLI (distribution package of Open Babel 3.1.1) on PATH and a driver venv at `/opt/concord-engines/openbabel`. Footprint: ~256 MB disk, 256 MB memory, 1 thread.

## Health

`health`: ethanol (CCO) — obabel's report must name formula C2H6O and a mass matching the kernel's own formula-weight computation (46.069); band **0.01**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:openbabel` with the install hint.
- Env provisioned but obabel missing → FAIL `engine_failed:openbabel:obabel executable not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:openbabel` before spawn; an unknown
  op → FAIL `engine_unknown_op:openbabel:<op>`.

## Tests

`server/tests/conkay/engines/openbabel.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-openbabel.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_OPENBABEL_BIN`, and fails if any test skips.
