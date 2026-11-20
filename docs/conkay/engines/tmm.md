# Engine: tmm — tmm · SXE-33

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/tmm.js` — id `tmm`,
version pin **0.2.0**, licence **MIT**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_TMM_BIN` (default
`/opt/concord-engines/tmm/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `reflectance`. Kernel:
`server/lib/conkay/engines/kernels/kernel-tmm.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/tmm` (tmm 0.2.0, pip pin). Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health`: the reflectance of a single 100 nm SiO2 film (n = 1.46) on glass (n = 1.52) at 550 nm, normal incidence, vs the closed-form Airy (characteristic-matrix) result computed in-kernel — a different code path to the same published mathematics; band **1e-6** absolute.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:tmm` with the install hint.
- Env provisioned but tmm unimportable → FAIL `engine_failed:tmm:tmm import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:tmm` before spawn; an unknown
  op → FAIL `engine_unknown_op:tmm:<op>`.

## Tests

`server/tests/conkay/engines/tmm.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-tmm.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_TMM_BIN`, and fails if any test skips.
