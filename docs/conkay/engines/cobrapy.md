# Engine: cobrapy — COBRApy · SXE-28

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/cobrapy.js` — id `cobrapy`,
version pin **0.29.1**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_COBRAPY_BIN` (default
`/opt/concord-engines/cobrapy/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `fba`. Kernel:
`server/lib/conkay/engines/kernels/kernel-cobrapy.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/cobrapy` (COBRApy 0.29.1, pip pin). Footprint: ~512 MB disk, 512 MB memory, 1 thread.

## Health

`health` is two-tier (the pycalphad shape). Default: a toy core network built in the kernel whose FBA optimum is the closed form 4.0 exactly (band **1e-6**) — deterministic offline. If the lane provisions a real model (`CONKAY_COBRA_MODEL`, e.g. e_coli_core JSON) and its published growth reference (`CONKAY_COBRA_REF_GROWTH`, 0.873922 for e_coli_core under the documentation's default bounds), health runs that model instead with a **1%** band against the stored reference.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:cobrapy` with the install hint.
- Env provisioned but cobra unimportable → FAIL `engine_failed:cobrapy:cobra import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:cobrapy` before spawn; an unknown
  op → FAIL `engine_unknown_op:cobrapy:<op>`.

## Tests

`server/tests/conkay/engines/cobrapy.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-cobrapy.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_COBRAPY_BIN`, and fails if any test skips.
