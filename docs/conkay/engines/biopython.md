# Engine: biopython — Biopython · SXE-28

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/biopython.js` — id `biopython`,
version pin **1.85**, licence **BSD-3-Clause (Biopython License Agreement)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_BIOPYTHON_BIN` (default
`/opt/concord-engines/biopython/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `analyze`. Kernel:
`server/lib/conkay/engines/kernels/kernel-biopython.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/biopython` (Biopython 1.85, pip pin). Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health`: a bundled 60 nt sequence — Biopython's GC fraction and translation must match the kernel's own direct count and standard-code translation (fraction band **1e-9**, protein exact).

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:biopython` with the install hint.
- Env provisioned but biopython unimportable → FAIL `engine_failed:biopython:biopython import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:biopython` before spawn; an unknown
  op → FAIL `engine_unknown_op:biopython:<op>`.

## Tests

`server/tests/conkay/engines/biopython.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-biopython.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_BIOPYTHON_BIN`, and fails if any test skips.
