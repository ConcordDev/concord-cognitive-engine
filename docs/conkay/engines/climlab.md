# Engine: climlab — climlab · SXE-35

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/climlab.js` — id `climlab`,
version pin **0.10.1**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_CLIMLAB_BIN` (default
`/opt/concord-engines/climlab/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `ebm`. Kernel:
`server/lib/conkay/engines/kernels/kernel-climlab.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/climlab` (climlab 0.10.1, pip pin). Footprint: ~512 MB disk, 512 MB memory, 1 thread.

## Health

`health`: climlab's energy-balance model stepped to equilibrium. The pass conditions are the model's own invariants: the state must stop moving (max |dTs| over one further step **< 0.01 K** — the budget is closed) and the global-mean Ts must sit in the physical band **270-300 K**. No stored temperature is asserted.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:climlab` with the install hint.
- Env provisioned but climlab unimportable → FAIL `engine_failed:climlab:climlab import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:climlab` before spawn; an unknown
  op → FAIL `engine_unknown_op:climlab:<op>`.

## Tests

`server/tests/conkay/engines/climlab.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-climlab.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_CLIMLAB_BIN`, and fails if any test skips.
